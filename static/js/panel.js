// PANTALLA: Panel de control (/panel), solo administradores                ESTADO: por hacer
// Plantilla: templates/panel.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// ACCESO: un administrador es usuarios.rol = 1. Esta pantalla empieza con `await Basurin.exigirAdmin()`, que manda
// a /home a quien no lo sea. Eso solo es comodidad: la protección real está en Supabase (RLS y funciones) y, para
// el video, en la API de Flask (que debe comprobar el rol en el servidor). Nunca confíes en ocultar un botón.
//
// QUÉ DEBE HACER
//  1. Cámara con visión artificial: el video del bote con lo que detecta el modelo (como la imagen 2 del boceto).
//     Render no puede ver la cámara de la laptop del bote, así que va por relay: el script del bote sube 1-2
//     fotogramas por segundo ya anotados a Flask (POST /api/bote/<id>/frame, con la clave del bote) y Flask los sirve
//     a los administradores como MJPEG (GET /api/admin/stream/<id>?t=<token corto>). Una etiqueta <img> no puede
//     mandar el encabezado Authorization; por eso el token corto, que se pide con POST /api/admin/stream-token.
//     Esos endpoints están POR HACER (backend). Mientras tanto deja un recuadro "Sin señal".
//  2. Últimas detecciones y contadores por material. Como administrador, transacciones y usuarios se ven de todos.
//  3. Botes: lista con estatus y botones para cambiarlo (activo, lleno, mantenimiento, inactivo) y crear uno nuevo.
//  4. Canjes pendientes: entregar o cancelar.
//  5. Premios: crear, editar, pausar (activo) y ajustar stock.
//
// DATOS (Supabase, con Basurin.db; las políticas de administrador ya existen)
//    Botes:       db.from("botes").select("*")  /  .update({ estatus }).eq("id", id)  /  .insert({ ubicacion, latitud, longitud })
//    Canjes:      db.from("canjes").select("id, codigo, costo, estado, creado_en, premios(nombre), usuarios(nombre)").eq("estado", "pendiente")
//                 db.rpc("entregar_canje", { p_codigo })   db.rpc("cancelar_canje", { p_canje_id })   (cancelar devuelve puntos y stock)
//    Premios:     db.from("premios").select("*")  /  .insert(...)  /  .update(...)
//    Detecciones: db.from("transacciones").select("id, material, puntos, fecha, bote_id").order("fecha", { ascending: false }).limit(50)
//
// RESPONSIVE: lg: video grande a la izquierda y columna lateral con detecciones y contadores. Móvil: video arriba
// y pestañas (Detecciones, Botes, Canjes, Premios) debajo.
//
// PRIVACIDAD: la cámara apunta a la tolva, no a personas; no se guarda video. Dilo en la pantalla.
//
// LISTO CUANDO: un usuario normal no ve el enlace del menú ni entra; el administrador ve el video (o "Sin señal"),
// las detecciones y puede cambiar el estatus de un bote y entregar un canje.
// Prueba sin cuenta: /panel?demo=1&admin=1 (solo con Flask en debug).

(async () => {
  const { db, demo, aviso } = Basurin;
  const { sesion, perfil } = await Basurin.exigirAdmin();

  // TODO: implementar la pantalla
})();
