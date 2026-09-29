"""
Cámara del bote controlada desde el panel web.

Corre el mismo detector de bote_inteligente.py (YOLO + ESP32) en un hilo dentro de Flask, sin ventana de OpenCV:
el último fotograma anotado se guarda en memoria y el panel lo ve como MJPEG. Solo funciona cuando Flask corre en
la misma computadora que tiene la cámara (la laptop del bote), no en Render.

Cada clasificación se guarda en Supabase como una fila de transacciones y el panel cuenta desde ahí: una sola fuente
de datos, sin conteos duplicados en memoria. Si hay un usuario vinculado al bote (sesiones_activas) la fila es suya y
le da puntos; si no, se guarda sin usuario y con 0 puntos (cuenta para las estadísticas).

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
from pathlib import Path

CALIDAD_JPEG = 70
FPS_VIDEO = 12  # fotogramas por segundo que se mandan al navegador

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
        # En otro hilo: la cámara no debe esperar a la red
        threading.Thread(target=self._registrar, args=(material,), daemon=True).start()

    def _registrar(self, material):
        puntos = PUNTOS_POR_MATERIAL.get(clave_material(material), 0)
        try:
            filtro = urllib.parse.urlencode({"bote_id": f"eq.{self.bote_id}", "select": "usuario_id"})
            sesiones = self._peticion("GET", f"sesiones_activas?{filtro}")
            # Sin nadie vinculado igual se guarda (cuenta para las estadísticas), pero sin usuario ni puntos
            usuario_id = sesiones[0]["usuario_id"] if sesiones else None
            if usuario_id is None:
                puntos = 0
            self._peticion("POST", "transacciones", {
                "usuario_id": usuario_id, "bote_id": self.bote_id,
                "material": material, "puntos": puntos,
            })
            self._anotar(f"{material}: registrado (+{puntos} pts)" if usuario_id
                         else f"{material}: registrado sin usuario (nadie vinculado al bote, sin puntos)", True)
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
        if not (url and llave and bote_id.isdigit()):
            print("AVISO: faltan SUPABASE_SERVICE_ROLE_KEY o BOTE_ID en .env; las clasificaciones no se guardarán.",
                  flush=True)
            return None
        return RegistroTransacciones(url, llave, int(bote_id))

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
            from bote_inteligente import (MODELO_POR_DEFECTO, BoteInteligente, ConexionESP32,
                                          abrir_camara, elegir_dispositivo, log)

            if not Path(MODELO_POR_DEFECTO).exists():
                raise RuntimeError(f"No se encontró el modelo en {MODELO_POR_DEFECTO}")

            self.dispositivo = elegir_dispositivo()
            self._conexion = ConexionESP32(puerto)
            bote = BoteInteligente(MODELO_POR_DEFECTO, self._conexion, confianza, self.dispositivo)
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
