// PANTALLA: Escanear QR (/escanear y /v/<id>)                             ESTADO: por hacer
// Plantilla: templates/escanear.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// FLUJO COMPLETO
//  1. La pantalla del bote (una página web en modo kiosco, aparte) muestra un QR con la URL
//     /v/<bote_id>?t=<token> y, debajo, un código corto de 6 caracteres. El token es de un solo uso y rota ~cada 45 s.
//  2. El usuario lo abre de dos formas: con la cámara de su celular (llega a /v/<id>?t=..., con window.BOTE_ID y el
//     token en la URL) o desde esta pantalla (/escanear) escaneando con la cámara del navegador.
//  3. Se manda al servidor para vincular la cuenta con el bote. Si sale bien, el bote saluda al usuario en su pantalla
//     y la Home muestra "Estás conectado al bote ...".
//
// QUÉ DEBE HACER
//  - Escáner con la cámara: librería html5-qrcode (por CDN). OJO: getUserMedia solo funciona con HTTPS o en
//    localhost; en http://192.168.x.x del celular NO abrirá la cámara.
//  - Marco guía, mensajes claros y estas etapas: pidiendo permiso de cámara -> escaneando -> validando ->
//    vinculado (cuenta regresiva de 90 s y "Tira tu residuo") -> error (token vencido, bote ocupado, bote no
//    disponible, sin cámara o permiso negado).
//  - Alternativa sin cámara (obligatoria: es accesibilidad): campo para escribir el código de 6 caracteres.
//  - Si llega por /v/<id>?t=<token>, vincular automáticamente al cargar (con un botón "Reintentar" si falla).
//  - Terminar antes de tiempo: db.from("sesiones_activas").delete().eq("usuario_id", uid) (RLS deja borrar la propia).
//
// VINCULAR (API de Flask, POR HACER: la hace quien tenga el backend)
//    POST /api/vincular   Authorization: Bearer <sesion.access_token>   cuerpo { bote_id, token }
//    El servidor valida el JWT con GET {SUPABASE_URL}/auth/v1/user, valida el token, comprueba que el bote esté
//    en estatus 'activo' y crea la fila de sesiones_activas con la llave service_role.
//    NO insertes en sesiones_activas desde el navegador: ya no hay permiso (y no debe haberlo).
//
// RESPONSIVE
//  - Móvil: cámara a pantalla completa con marco guía y el campo de código debajo.
//  - Escritorio: tarjeta centrada (max-w-md). Si no hay cámara, sugerir abrir esta página en el celular.
//
// LISTO CUANDO: escanear un QR válido vincula la cuenta, el error de cada caso se explica con palabras
// y todo se puede hacer sin cámara. Prueba sin cuenta: /escanear?demo=1 (solo con Flask en debug).

(async () => {
  const { db, demo, listo, aviso } = Basurin;
  const { sesion, perfil } = await listo;
  const boteId = window.BOTE_ID;                                  // null en /escanear
  const token = new URLSearchParams(location.search).get("t");   // solo en /v/<id>?t=...

  // TODO: implementar la pantalla
})();
