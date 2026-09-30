"""
Genera los códigos QR de los botes: cada QR contiene solo el número del bote ("1", "2", ...).

Uso:
    python generar_qrs.py            # del 1 al 10
    python generar_qrs.py 7 9        # del 7 al 9

Las imágenes quedan en qrs/bote_<n>.png, con el número escrito debajo del QR (es el que se escribe a mano
en la pantalla Escanear QR si la cámara no lo lee). El número debe ser el id del bote en la tabla botes.
"""

import sys
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

CARPETA = Path(__file__).parent / "qrs"
TAMANO_CUADRO = 20  # px por cada cuadrito del QR
ALTO_TEXTO = 110    # px de espacio debajo del QR para el número


def fuente(tamano):
    for nombre in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(nombre, tamano)
        except OSError:
            continue
    return ImageFont.load_default(size=tamano)


def generar(numero):
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,  # se sigue leyendo aunque esté un poco sucio o rayado
        box_size=TAMANO_CUADRO,
        border=4,                                            # margen blanco que los lectores necesitan
    )
    qr.add_data(str(numero))  # solo el número, sin texto extra
    qr.make(fit=True)
    imagen_qr = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # Lienzo con el QR arriba y "Bote <n>" debajo
    ancho, alto = imagen_qr.size
    lienzo = Image.new("RGB", (ancho, alto + ALTO_TEXTO), "white")
    lienzo.paste(imagen_qr, (0, 0))
    dibujo = ImageDraw.Draw(lienzo)
    texto = f"Bote {numero}"
    letra = fuente(72)
    caja = dibujo.textbbox((0, 0), texto, font=letra)
    x = (ancho - (caja[2] - caja[0])) // 2
    y = alto + (ALTO_TEXTO - (caja[3] - caja[1])) // 2 - caja[1] - 20
    dibujo.text((x, y), texto, fill="black", font=letra)

    ruta = CARPETA / f"bote_{numero}.png"
    lienzo.save(ruta)
    return ruta


def main():
    inicio, fin = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) == 3 else (1, 10)
    CARPETA.mkdir(exist_ok=True)
    for numero in range(inicio, fin + 1):
        print(f"Generado {generar(numero)}")


if __name__ == "__main__":
    main()
