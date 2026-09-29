"""
Servidor web del Bote Inteligente.

Uso:
    1. Copiar .env.example a .env y poner los datos del proyecto de Supabase
    2. python app.py
Luego abrir http://localhost:5000
"""

import json
import os
import secrets
import time
import urllib.error
import urllib.request
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, render_template, request

from camara_web import camara

load_dotenv()

app = Flask(__name__)

# Solo se mandan al navegador la URL y la llave pública (anon).
# La llave service_role nunca debe llegar a la página.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    print("AVISO: faltan SUPABASE_URL o SUPABASE_ANON_KEY en el archivo .env")


@app.context_processor
def datos_supabase():
    # Disponibles en todas las plantillas (las usan base.html y base_app.html)
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
        # El modo demostración (?demo=1) solo existe con Flask en debug, nunca en producción
        "demo_permitido": app.debug,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/registro")
def registro():
    return render_template("registro.html")


# ---------- Pantallas con la sesión iniciada ----------
# Todas extienden base_app.html. La sesión la revisa static/js/app.js (sin sesión manda a /login);
# los datos los protege Supabase con RLS. Cada pantalla tiene su plantilla y su JS con lo que le toca.

@app.route("/home")
def home():
    return render_template("home.html")


@app.route("/mapa")
def mapa():
    return render_template("mapa.html")


@app.route("/escanear")
def escanear():
    return render_template("escanear.html")


@app.route("/v/<int:bote_id>")
def escanear_bote(bote_id):
    # Destino del QR que muestra la pantalla de cada bote: /v/<id>?t=<token>
    return render_template("escanear.html", bote_id=bote_id)


@app.route("/premios")
def premios():
    return render_template("premios.html")


@app.route("/panel")
def panel():
    # Solo administradores (usuarios.rol = 1). Ojo: la plantilla lo revisa en el navegador; lo que
    # muestre de verdad (video, listados) debe protegerse también en la API y en Supabase.
    return render_template("panel.html")


@app.route("/perfil")
def perfil():
    return render_template("perfil.html")


# ---------- API del panel: cámara con visión artificial ----------
# El navegador manda el token de Supabase (Authorization: Bearer ...) y aquí se pregunta a Supabase si esa
# cuenta es administradora (función es_admin). Ocultar el botón en la página no basta.

_ADMINS_CACHE = {}   # token -> (es_admin, vence) para no consultar Supabase en cada sondeo
_TOKENS_VIDEO = {}   # token corto del <img> del video -> vence
DURACION_TOKEN_VIDEO = 60


def _es_admin(token):
    ahora = time.time()
    guardado = _ADMINS_CACHE.get(token)
    if guardado and guardado[1] > ahora:
        return guardado[0]

    peticion = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/es_admin", data=b"{}", method="POST",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(peticion, timeout=5) as r:
            es_admin = json.load(r) is True
    except (urllib.error.URLError, ValueError):
        es_admin = False

    if len(_ADMINS_CACHE) > 100:
        _ADMINS_CACHE.clear()
    _ADMINS_CACHE[token] = (es_admin, ahora + 60)
    return es_admin


def _demo_local():
    # Modo demostración (?demo=1&admin=1): solo con Flask en debug y desde esta misma computadora
    return app.debug and request.headers.get("X-Basurin-Demo") == "1" and request.remote_addr in ("127.0.0.1", "::1")


def solo_admin(vista):
    @wraps(vista)
    def envuelta(*args, **kwargs):
        encabezado = request.headers.get("Authorization", "")
        token = encabezado[7:] if encabezado.startswith("Bearer ") else ""
        if not (_demo_local() or (token and SUPABASE_URL and _es_admin(token))):
            return jsonify(error="Solo administradores"), 403
        return vista(*args, **kwargs)
    return envuelta


# La cámara arranca sola con la app (ver abajo); este endpoint es el "Reintentar" del panel si falló.
@app.post("/api/admin/camara/iniciar")
@solo_admin
def camara_iniciar():
    datos = request.get_json(silent=True) or {}
    indice = datos.get("camara", int(os.getenv("CAMARA", "0")))
    if not isinstance(indice, int) or not 0 <= indice <= 9:
        return jsonify(error="Cámara inválida"), 400
    if not camara.iniciar(camara=indice):
        return jsonify(error="La cámara ya está encendida"), 409
    return jsonify(camara.resumen())


@app.get("/api/admin/camara/estado")
@solo_admin
def camara_estado():
    return jsonify(camara.resumen())


@app.post("/api/admin/camara/token-video")
@solo_admin
def camara_token_video():
    # Un <img> no puede mandar Authorization: se le da un token corto para la URL del video
    ahora = time.time()
    for t, vence in list(_TOKENS_VIDEO.items()):
        if vence < ahora:
            del _TOKENS_VIDEO[t]
    token = secrets.token_urlsafe(24)
    _TOKENS_VIDEO[token] = ahora + DURACION_TOKEN_VIDEO
    return jsonify(token=token)


@app.get("/api/admin/camara/video")
def camara_video():
    vence = _TOKENS_VIDEO.pop(request.args.get("t", ""), 0)  # de un solo uso
    if vence < time.time():
        abort(403)
    return Response(camara.mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame",
                    headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    DEBUG = True

    # El modelo y la cámara arrancan con la app, sin esperar a que entre nadie al panel: el bote clasifica y
    # guarda transacciones siempre. INICIAR_CAMARA=0 en el .env lo desactiva (por ejemplo en Render, sin cámara).
    # Con debug, Flask corre dos procesos (el vigilante que recarga y el que atiende); la cámara va solo en el segundo.
    if os.getenv("INICIAR_CAMARA", "1") != "0" and (not DEBUG or os.getenv("WERKZEUG_RUN_MAIN") == "true"):
        camara.iniciar(camara=int(os.getenv("CAMARA", "0")))

    # debug=True recarga el servidor solo al guardar cambios en los archivos (y reinicia la cámara con él).
    # threaded=True: el video en vivo ocupa una conexión mientras se ve, las demás peticiones siguen atendiéndose.
    app.run(host="0.0.0.0", port=5000, debug=DEBUG, threaded=True)
