"""
Servidor web del Bote Inteligente.

Uso:
    1. Copiar .env.example a .env y poner los datos del proyecto de Supabase
    2. python app.py
Luego abrir http://localhost:5000
"""

import os

from dotenv import load_dotenv
from flask import Flask, render_template

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


if __name__ == "__main__":
    # debug=True recarga el servidor solo al guardar cambios en los archivos
    app.run(host="0.0.0.0", port=5000, debug=True)
