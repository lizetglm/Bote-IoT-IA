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
    # Disponibles en todas las plantillas (las usa base.html)
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
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


if __name__ == "__main__":
    # debug=True recarga el servidor solo al guardar cambios en los archivos
    app.run(host="0.0.0.0", port=5000, debug=True)
