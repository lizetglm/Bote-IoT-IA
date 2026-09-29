// PANTALLA: Mi perfil (/perfil), se abre desde el icono de usuario del encabezado   ESTADO: por hacer
// Plantilla: templates/perfil.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// QUÉ DEBE HACER
//  - Mostrar los datos de la cuenta: nombre, correo, puntos, fecha de registro (perfil.creado_en) y, si es
//    administrador, una etiqueta "Administrador".
//  - Editar el nombre (con botón Guardar, validación de 1 a 60 caracteres y estados guardando / éxito / error con
//    Basurin.aviso). Al guardar, actualizar el menú: Basurin.pintarMenu({ ...perfil, nombre }).
//  - El correo es solo lectura. (Cambiarlo es cosa de Supabase Auth: db.auth.updateUser; opcional, no urgente.)
//  - Historial de depósitos del usuario, con paginación o "Ver más".
//  - Cerrar sesión ya está en el menú; no hace falta repetirlo.
//
// DATOS (Supabase, con Basurin.db)
//    Editar nombre:  db.from("usuarios").update({ nombre }).eq("id", uid)
//                    OJO: la base solo permite cambiar la columna `nombre`. Intentar cambiar puntos, rol o correo
//                    da error de permisos, y así debe ser (nadie puede sumarse puntos ni hacerse administrador).
//    Historial:      db.from("transacciones").select("id, material, puntos, fecha, bote_id").eq("usuario_id", uid)
//                      .order("fecha", { ascending: false }).range(0, 19)
//                    OJO: .eq("usuario_id", uid) es obligatorio (un administrador vería los de todos).
//    Material bonito: Basurin.material(nombre) -> { etiqueta, punto, chip }
//
// SEGURIDAD: el nombre lo escribe el usuario; al pintarlo usa textContent, nunca innerHTML.
//
// RESPONSIVE: móvil en una columna; en lg, datos de la cuenta a la izquierda e historial a la derecha.
//
// LISTO CUANDO: editar el nombre se refleja en el menú y en la Home tras recargar, y el historial se pagina.
// Prueba sin cuenta: /perfil?demo=1 (solo con Flask en debug).

(async () => {
  const { db, demo, listo, aviso } = Basurin;
  const { sesion, perfil, esAdmin } = await listo;
  const uid = sesion.user.id;

  // TODO: implementar la pantalla
})();
