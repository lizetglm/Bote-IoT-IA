"""
Bote Inteligente - Detección de basura en tiempo real + envío de comandos al ESP32.

Uso:
    python bote_inteligente.py                          # autodetecta el puerto del ESP32
    python bote_inteligente.py --puerto COM3            # puerto fijo
    python bote_inteligente.py --modelo ruta/best.pt --camara 1 --conf 0.65
    python bote_inteligente.py --dispositivo cpu        # forzar CPU aunque haya GPU

Al iniciar detecta si hay GPU (CUDA) y la usa; si no, trabaja con el CPU.

Si no hay ESP32 conectado, el programa sigue funcionando en "modo simulación":
muestra en consola lo que detecta la cámara y el comando que se habría enviado.

Protocolo serial (una línea por comando, terminada en '\n'):
    O -> Organico | P -> Plastico | C -> Papel_Carton | M -> Metal | V -> Vidrio
"""

import argparse
import shutil
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import cv2
import torch

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    serial = None

from ultralytics import YOLO

# ==========================================
# CONFIGURACIÓN
# ==========================================
MODELO_POR_DEFECTO = Path(__file__).parent / "modelo" / "best.pt"
BAUDIOS = 115200

# Comando que se envía al ESP32 según la clase detectada.
# Las claves están en minúsculas para no depender de cómo se escribió en data.yaml.
COMANDOS = {
    "organico": "O",
    "plastico": "P",
    "papel_carton": "C",
    "metal": "M",
    "vidrio": "V",
}

# Si el data.yaml usó nombres genéricos ('0', '1', ...), se mapea por ID
# siguiendo el orden del unificador: 0 Organico | 1 Plastico | 2 Papel_Carton | 3 Metal | 4 Vidrio
COMANDOS_POR_ID = {0: "O", 1: "P", 2: "C", 3: "M", 4: "V"}

FRAMES_PARA_CONFIRMAR = 8   # frames seguidos con la misma clase antes de enviar
ESPERA_ENTRE_ENVIOS = 3.0   # segundos que se deja al servo moverse antes del siguiente envío
REINTENTO_SERIAL = 5.0      # segundos entre intentos de reconexión del ESP32

# Palabras que suelen aparecer en la descripción de un ESP32 en Windows
PISTAS_ESP32 = ("CP210", "CH340", "CH910", "USB-SERIAL", "USB SERIAL", "UART", "ESP32", "SILICON LABS")


def log(mensaje):
    print(f"[{datetime.now():%H:%M:%S}] {mensaje}", flush=True)


# ==========================================
# SELECCIÓN DE DISPOSITIVO (GPU o CPU)
# ==========================================
def elegir_dispositivo(forzado=None):
    """Usa la GPU NVIDIA si existe y funciona; si no, Apple MPS; si no, CPU."""
    if forzado:
        log(f"Dispositivo forzado por argumento: {forzado}")
        return forzado

    if torch.cuda.is_available():
        try:
            torch.zeros(1, device="cuda")  # confirma que la GPU realmente responde
            nombre = torch.cuda.get_device_name(0)
            memoria = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
            log(f"GPU detectada: {nombre} ({memoria:.1f} GB). Se usará CUDA.")
            return "cuda:0"
        except Exception as e:
            log(f"AVISO: Hay CUDA pero la GPU falló al iniciar ({e}). Se usará CPU.")
            return "cpu"

    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        log("GPU Apple (MPS) detectada. Se usará MPS.")
        return "mps"

    # Hay tarjeta NVIDIA pero se instaló la versión de torch solo para CPU
    if shutil.which("nvidia-smi") and "+cpu" in torch.__version__:
        log("AVISO: Se detectó una tarjeta NVIDIA, pero torch está instalado sin CUDA. "
            "Para usarla: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128 --force-reinstall")

    log("No hay GPU disponible. Se usará CPU.")
    return "cpu"


# ==========================================
# CONEXIÓN SERIAL (tolerante a fallos)
# ==========================================
class ConexionESP32:
    """Maneja el puerto serial. Nunca lanza excepciones: si falla, queda en modo simulación."""

    def __init__(self, puerto=None, baudios=BAUDIOS):
        self.puerto_pedido = puerto
        self.baudios = baudios
        self.ser = None
        self.ultimo_intento = 0.0

        if serial is None:
            log("AVISO: pyserial no está instalado (pip install pyserial). Modo simulación.")
            return
        self.conectar()

    @property
    def conectado(self):
        return self.ser is not None and self.ser.is_open

    @property
    def nombre_puerto(self):
        return self.ser.port if self.conectado else None

    def _buscar_puerto(self):
        puertos = list(serial.tools.list_ports.comports())
        if not puertos:
            return None
        for p in puertos:
            descripcion = f"{p.description} {p.manufacturer or ''}".upper()
            if any(pista in descripcion for pista in PISTAS_ESP32):
                return p.device
        return None

    def conectar(self):
        if serial is None:
            return False
        self.ultimo_intento = time.time()

        puerto = self.puerto_pedido or self._buscar_puerto()
        if puerto is None:
            disponibles = [p.device for p in serial.tools.list_ports.comports()]
            log(f"AVISO: No se encontró un ESP32. Puertos disponibles: {disponibles or 'ninguno'}. "
                "Modo simulación (usa --puerto COMx para forzar uno).")
            return False

        try:
            self.ser = serial.Serial(puerto, self.baudios, timeout=0, write_timeout=1)
            time.sleep(2)  # el ESP32 se reinicia al abrir el puerto
            self.ser.reset_input_buffer()
            log(f"ESP32 conectado en {puerto} @ {self.baudios} baudios.")
            return True
        except (serial.SerialException, OSError, ValueError) as e:
            self.ser = None
            log(f"AVISO: No se pudo abrir {puerto} ({e}). Modo simulación.")
            return False

    def reintentar_si_toca(self):
        """Intenta reconectar cada REINTENTO_SERIAL segundos si no hay conexión."""
        if serial is None or self.conectado:
            return
        if time.time() - self.ultimo_intento >= REINTENTO_SERIAL:
            self.conectar()

    def enviar(self, comando):
        """Envía el comando. Devuelve True si llegó al puerto, False si fue simulado."""
        if not self.conectado:
            return False
        try:
            self.ser.write(f"{comando}\n".encode("ascii"))
            return True
        except (serial.SerialException, OSError) as e:
            log(f"AVISO: Se perdió la conexión con el ESP32 ({e}). Modo simulación.")
            self.cerrar()
            return False

    def leer_respuestas(self):
        """Muestra en consola lo que responda el ESP32 (sin bloquear)."""
        if not self.conectado:
            return
        try:
            while self.ser.in_waiting:
                linea = self.ser.readline().decode("utf-8", errors="replace").strip()
                if linea:
                    log(f"ESP32 dice: {linea}")
        except (serial.SerialException, OSError) as e:
            log(f"AVISO: Se perdió la conexión con el ESP32 ({e}). Modo simulación.")
            self.cerrar()

    def cerrar(self):
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None


# ==========================================
# DETECTOR
# ==========================================
class BoteInteligente:
    """Procesa frames, decide la clasificación y manda el comando al ESP32.

    Está separado del bucle de la cámara para poder reutilizarlo después desde Flask.
    """

    def __init__(self, ruta_modelo, conexion, confianza=0.65, dispositivo="cpu"):
        self.model = YOLO(str(ruta_modelo))
        self.conexion = conexion
        self.confianza = confianza
        self.dispositivo = dispositivo

        self.candidato = None
        self.frames_candidato = 0
        self.ultimo_envio = 0.0
        self.ultima_vista = None
        self.ultimo_comando = "-"
        self.conteo = Counter()

        log(f"Modelo cargado: {ruta_modelo} (dispositivo: {dispositivo})")
        log(f"Clases del modelo: {self.model.names}")

    def comando_para(self, id_clase, nombre):
        clave = nombre.strip().lower().replace(" ", "_").replace("/", "_")
        clave = clave.replace("á", "a").replace("ó", "o").replace("í", "i")
        return COMANDOS.get(clave) or COMANDOS_POR_ID.get(id_clase)

    def procesar(self, frame):
        """Analiza un frame. Devuelve el frame anotado."""
        resultado = self.model(frame, conf=self.confianza, device=self.dispositivo, verbose=False)[0]

        # Nos quedamos con la detección de mayor confianza del frame
        mejor = None
        for caja in resultado.boxes:
            conf = float(caja.conf[0])
            if mejor is None or conf > mejor[2]:
                id_clase = int(caja.cls[0])
                mejor = (id_clase, self.model.names[id_clase], conf)

        self._reportar_vista(mejor, len(resultado.boxes))
        self._decidir_envio(mejor)

        anotado = resultado.plot()
        self._dibujar_estado(anotado)
        return anotado

    def _reportar_vista(self, mejor, total):
        """Imprime lo que ve la cámara solo cuando cambia, para no llenar la consola."""
        vista = mejor[1] if mejor else None
        if vista != self.ultima_vista:
            if mejor:
                log(f"Cámara: {mejor[1]} ({mejor[2] * 100:.1f}%) - {total} objeto(s) en escena")
            else:
                log("Cámara: sin objetos detectados")
            self.ultima_vista = vista

    def _decidir_envio(self, mejor):
        if mejor is None:
            self.candidato, self.frames_candidato = None, 0
            return

        id_clase, nombre, conf = mejor
        if nombre == self.candidato:
            self.frames_candidato += 1
        else:
            self.candidato, self.frames_candidato = nombre, 1

        listo = self.frames_candidato >= FRAMES_PARA_CONFIRMAR
        libre = time.time() - self.ultimo_envio >= ESPERA_ENTRE_ENVIOS
        if not (listo and libre):
            return

        comando = self.comando_para(id_clase, nombre)
        if comando is None:
            log(f"AVISO: La clase '{nombre}' no tiene comando asignado en COMANDOS.")
            self.frames_candidato = 0
            return

        enviado = self.conexion.enviar(comando)
        destino = f"enviado a {self.conexion.nombre_puerto}" if enviado else "SIMULADO (sin ESP32)"
        log(f">>> Clasificado: {nombre} ({conf * 100:.1f}%) -> comando '{comando}' {destino}")

        self.conteo[nombre] += 1
        self.ultimo_comando = f"{comando} ({nombre})"
        self.ultimo_envio = time.time()
        self.frames_candidato = 0

    def _dibujar_estado(self, frame):
        if self.conexion.conectado:
            estado, color = f"ESP32: {self.conexion.nombre_puerto}", (0, 200, 0)
        else:
            estado, color = "ESP32: SIN CONEXION (simulacion)", (0, 0, 255)

        lineas = [
            (estado, color),
            (f"Ultimo comando: {self.ultimo_comando}", (255, 255, 255)),
            ("Conteo: " + (", ".join(f"{k}={v}" for k, v in self.conteo.items()) or "-"), (255, 255, 255)),
        ]
        for i, (texto, col) in enumerate(lineas):
            y = 25 + i * 25
            cv2.putText(frame, texto, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(frame, texto, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2, cv2.LINE_AA)


# ==========================================
# PROGRAMA PRINCIPAL
# ==========================================
def main():
    parser = argparse.ArgumentParser(description="Bote inteligente: YOLO + ESP32 por serial")
    parser.add_argument("--modelo", default=str(MODELO_POR_DEFECTO), help="Ruta al best.pt entrenado")
    parser.add_argument("--puerto", default=None, help="Puerto del ESP32 (ej. COM3). Si se omite, se autodetecta")
    parser.add_argument("--baudios", type=int, default=BAUDIOS)
    parser.add_argument("--camara", type=int, default=0, help="Índice de la cámara (0 = principal, si falla usa la 1)")
    parser.add_argument("--conf", type=float, default=0.65, help="Confianza mínima (0-1)")
    parser.add_argument("--dispositivo", default=None,
                        help="Forzar dispositivo: cpu, cuda:0, mps. Si se omite, se detecta solo")
    args = parser.parse_args()

    ruta_modelo = Path(args.modelo)
    if not ruta_modelo.exists():
        log(f"ERROR: No se encontró el modelo en '{ruta_modelo}'.")
        log("Copia tu best.pt (runs/detect/train-X/weights/best.pt) a esa ruta o usa --modelo.")
        sys.exit(1)

    dispositivo = elegir_dispositivo(args.dispositivo)
    conexion = ConexionESP32(args.puerto, args.baudios)
    bote = BoteInteligente(ruta_modelo, conexion, args.conf, dispositivo)

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(args.camara, backend)
    if not cap.isOpened() and args.camara == 0:
        log("AVISO: No se detectó la cámara 0. Intentando con la cámara 1...")
        cap = cv2.VideoCapture(1, backend)
    if not cap.isOpened():
        log(f"ERROR: No se pudo abrir la cámara {args.camara}.")
        conexion.cerrar()
        sys.exit(1)

    log("Cámara encendida. Presiona 'q' en la ventana para salir.")
    try:
        while True:
            exito, frame = cap.read()
            if not exito:
                log("ERROR: Se perdió la señal de la cámara.")
                break

            anotado = bote.procesar(frame)
            conexion.leer_respuestas()
            conexion.reintentar_si_toca()

            cv2.imshow("Bote Inteligente", anotado)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    except KeyboardInterrupt:
        log("Interrumpido por el usuario.")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        conexion.cerrar()
        if bote.conteo:
            log("Resumen de clasificaciones: " + ", ".join(f"{k}={v}" for k, v in bote.conteo.items()))
        log("Programa terminado.")


if __name__ == "__main__":
    main()
