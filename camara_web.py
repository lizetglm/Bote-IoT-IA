"""
Cámara del bote controlada desde el panel web.

Corre el mismo detector de bote_inteligente.py (YOLO + ESP32) en un hilo dentro de Flask, sin ventana de OpenCV:
el último fotograma anotado se guarda en memoria y el panel lo ve como MJPEG. Solo funciona cuando Flask corre en
la misma computadora que tiene la cámara (la laptop del bote), no en Render.

Cada clasificación se guarda en Supabase como una fila de transacciones y el panel cuenta desde ahí: una sola fuente
de datos, sin conteos duplicados en memoria. Si hay una sesión viva (sesiones_activas) la fila toma su usuario y su
bote y le da puntos; si hay varias, la más nueva. Si no hay ninguna se guarda sin usuario, con 0 puntos (cuenta para
las estadísticas) y en el BOTE_ID del .env. La sesión vence a los MINUTOS_SESION del escaneo o del último depósito:
cada depósito reinicia el tiempo. Tras cada clasificación la cámara espera ESPERA_DEPOSITO segundos (el bote rota y
abre la compuerta) antes de contar el siguiente residuo.

Las librerías pesadas (torch, ultralytics, cv2) se importan al pulsar "Iniciar cámara", no al arrancar Flask.
"""

import json
import os
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CALIDAD_JPEG = 70
FPS_VIDEO = 12  # fotogramas por segundo que se mandan al navegador

# Minutos sin actividad (escaneo o depósito) tras los que se cierra la sesión con el bote.
# Igual que MINUTOS_SESION en static/js/escanear.js.
MINUTOS_SESION = 5

# Puntos que gana el usuario por cada pieza, según el material (clave sin acentos ni símbolos)
PUNTOS_POR_MATERIAL = {"organico": 5, "plastico": 8, "papelcarton": 6, "metal": 12, "vidrio": 10}


def clave_material(nombre):
    """'Papel_Carton', 'papel cartón' -> 'papelcarton' (igual que Basurin.material en static/js/app.js)."""
    sin_acentos = unicodedata.normalize("NFD", nombre).encode("ascii", "ignore").decode()
    return "".join(c for c in sin_acentos.lower() if c.isalpha())


class RegistroTransacciones:
    """Escribe en Supabase con la llave service_role (nunca sale del servidor)."""

    def __init__(self, url, llave_servicio, bote_id):
        self.url = url.rstrip("/")
        self.llave = llave_servicio
        self.bote_id = bote_id
        self.ultimo = None  # {"texto", "ok", "hora"} para mostrar en el panel

    def _peticion(self, metodo, ruta, cuerpo=None):
        peticion = urllib.request.Request(
            f"{self.url}/rest/v1/{ruta}", method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
            headers={"apikey": self.llave, "Authorization": f"Bearer {self.llave}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
        )
        with urllib.request.urlopen(peticion, timeout=8) as r:
            datos = r.read()
        return json.loads(datos) if datos else None

    def registrar(self, material):
        # La hora es la de la detección, no la de cuando responda la red: con ella se decide si la sesión seguía viva.
        # En otro hilo: la cámara no debe esperar a la red
        ahora = datetime.now(timezone.utc)
        threading.Thread(target=self._registrar, args=(material, ahora), daemon=True).start()

    def _registrar(self, material, ahora):
        puntos = PUNTOS_POR_MATERIAL.get(clave_material(material), 0)
        try:
            # La sesión que lleva más de MINUTOS_SESION sin actividad ya venció: se cierra antes de mirar quién está
            limite = (ahora - timedelta(minutes=MINUTOS_SESION)).isoformat()
            self._peticion("DELETE", "sesiones_activas?" + urllib.parse.urlencode({"actividad_en": f"lt.{limite}"}))

            # De las sesiones vivas manda la más nueva: el último en escanear es quien está frente al bote.
            # Sus datos (usuario y bote) son los de la transacción.
            filtro = urllib.parse.urlencode({
                "actividad_en": f"gte.{limite}", "select": "id,usuario_id,bote_id",
                "order": "iniciada_en.desc", "limit": 1,
            })
            sesiones = self._peticion("GET", f"sesiones_activas?{filtro}")
            if sesiones:
                sesion = sesiones[0]
                usuario_id, bote_id = sesion["usuario_id"], sesion["bote_id"]
            else:
                # Sin nadie vinculado igual se guarda (cuenta para las estadísticas), sin usuario ni puntos,
                # en el bote de esta cámara (BOTE_ID del .env). Es el único caso en que se usa.
                sesion, usuario_id, bote_id, puntos = None, None, self.bote_id, 0
                if bote_id is None:
                    self._anotar(f"{material}: no se guardó (nadie vinculado y falta BOTE_ID en .env)", False)
                    return

            self._peticion("POST", "transacciones", {
                "usuario_id": usuario_id, "bote_id": bote_id,
                "material": material, "puntos": puntos, "fecha": ahora.isoformat(),
            })
            if sesion:
                # Cada depósito reinicia el tiempo de la sesión
                self._peticion("PATCH", f"sesiones_activas?id=eq.{sesion['id']}", {"actividad_en": ahora.isoformat()})
            self._anotar(f"{material}: registrado en el bote {bote_id} (+{puntos} pts)" if sesion
                         else f"{material}: registrado sin usuario en el bote {bote_id} (nadie vinculado, sin puntos)",
                         True)
        except (urllib.error.URLError, ValueError, KeyError) as e:
            detalle = e.read().decode(errors="replace")[:200] if isinstance(e, urllib.error.HTTPError) else e
            self._anotar(f"{material}: no se pudo guardar en Supabase ({detalle})", False)

    def _anotar(self, texto, ok):
        print(f"[registro] {texto}", flush=True)
        self.ultimo = {"texto": texto, "ok": ok, "hora": time.time()}


class ServicioCamara:
    def __init__(self):
        self._candado = threading.Lock()
        self._hilo = None
        self._parar = threading.Event()
        self._jpeg = None
        self._conexion = None
        self.registro = None
        self.estado = "apagada"  # apagada | iniciando | activa | error
        self.error = None
        self.iniciada_en = None
        self.dispositivo = None

    # ---------- Control ----------
    def iniciar(self, camara=0, confianza=0.65, puerto=None):
        """Arranca el hilo. Devuelve False si ya estaba encendida o encendiéndose."""
        with self._candado:
            if self._hilo is not None and self._hilo.is_alive():
                return False
            self._parar.clear()
            self._jpeg = None
            self.registro = self._crear_registro()
            self.estado, self.error, self.iniciada_en = "iniciando", None, time.time()
            self._hilo = threading.Thread(target=self._bucle, args=(camara, confianza, puerto),
                                          name="camara-bote", daemon=True)
            self._hilo.start()
            return True

    @staticmethod
    def _crear_registro():
        url, llave = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        bote_id = os.getenv("BOTE_ID", "")
        if not (url and llave):
            print("AVISO: falta SUPABASE_SERVICE_ROLE_KEY en .env; las clasificaciones no se guardarán.", flush=True)
            return None
        if not bote_id.isdigit():
            print("AVISO: falta BOTE_ID en .env; solo se guardarán las clasificaciones con una sesión activa.",
                  flush=True)
        return RegistroTransacciones(url, llave, int(bote_id) if bote_id.isdigit() else None)

    # ---------- Lectura (desde las peticiones HTTP) ----------
    def resumen(self):
        conexion, registro = self._conexion, self.registro
        return {
            "estado": self.estado,
            "error": self.error,
            "iniciada_en": self.iniciada_en,
            "dispositivo": self.dispositivo,
            "esp32": conexion.nombre_puerto if conexion and conexion.conectado else None,
            "bote_id": int(os.getenv("BOTE_ID")) if os.getenv("BOTE_ID", "").isdigit() else None,
            "registro_activo": registro is not None,
            "ultimo_registro": registro.ultimo if registro else None,
        }

    # ---------- Hilo de la cámara ----------
    def _bucle(self, camara, confianza, puerto):
        cap = None
        try:
            import cv2
            from bote_inteligente import (ESPERA_DEPOSITO, MODELO_POR_DEFECTO, BoteInteligente, ConexionESP32,
                                          abrir_camara, elegir_dispositivo, log)

            if not Path(MODELO_POR_DEFECTO).exists():
                raise RuntimeError(f"No se encontró el modelo en {MODELO_POR_DEFECTO}")

            self.dispositivo = elegir_dispositivo()
            self._conexion = ConexionESP32(puerto)
            espera = float(os.getenv("ESPERA_DEPOSITO", ESPERA_DEPOSITO))
            bote = BoteInteligente(MODELO_POR_DEFECTO, self._conexion, confianza, self.dispositivo, espera)
            if self.registro is not None:
                bote.al_clasificar = self.registro.registrar

            cap = abrir_camara(camara)
            if not cap.isOpened():
                raise RuntimeError(f"No se pudo abrir la cámara {camara} (¿la está usando otro programa?)")

            self.estado = "activa"
            log("Cámara encendida (el video se ve en el panel de control).")
            while not self._parar.is_set():
                exito, frame = cap.read()
                if not exito:
                    raise RuntimeError("Se perdió la señal de la cámara")

                anotado = bote.procesar(frame)
                self._conexion.leer_respuestas()
                self._conexion.reintentar_si_toca()

                ok, buffer = cv2.imencode(".jpg", anotado, [cv2.IMWRITE_JPEG_QUALITY, CALIDAD_JPEG])
                if ok:
                    self._jpeg = buffer.tobytes()

            self.estado = "apagada"
        except Exception as e:
            print(f"ERROR en la cámara del panel: {e}", flush=True)
            self.estado, self.error = "error", str(e)
        finally:
            if cap is not None:
                cap.release()
            if self._conexion is not None:
                self._conexion.cerrar()
            self._jpeg = None

    # ---------- Video para el navegador ----------
    def mjpeg(self):
        """Generador multipart/x-mixed-replace. Termina cuando la cámara se apaga."""
        pausa = 1 / FPS_VIDEO
        enviado = None
        while self.estado in ("iniciando", "activa"):
            jpeg = self._jpeg
            if jpeg is not None and jpeg is not enviado:
                enviado = jpeg
                yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                       + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
            time.sleep(pausa)


camara = ServicioCamara()
