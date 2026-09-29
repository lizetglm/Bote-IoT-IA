// PANTALLA: Premios (/premios)                                            ESTADO: por hacer
// Plantilla: templates/premios.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// QUÉ DEBE HACER
//  - Mostrar el catálogo de premios y el saldo del usuario (perfil.puntos) fijo arriba.
//  - Cada premio: nombre, descripción, imagen (imagen_url, opcional), costo y, si stock no es null, cuántos quedan.
//    tipo = 'cupon' o 'donacion' (donar a una cooperativa de recicladores): destaca las donaciones, son el eje
//    de Impacto Social del proyecto.
//  - Botón "Canjear": deshabilitado si perfil.puntos < costo o stock === 0. Al pulsarlo, pedir confirmación.
//  - Al canjear: mostrar el código (BAS-XXXXXXXXXX) grande, con la instrucción de mostrárselo al personal, y
//    actualizar el saldo (Basurin.pintarMenu({ ...perfil, puntos: nuevoSaldo })).
//  - Historial de canjes del usuario con su estado: pendiente (aún no lo recoge), entregado o cancelado.
//
// DATOS (Supabase, con Basurin.db)
//    Catálogo:   db.from("premios").select("id, nombre, descripcion, tipo, costo, stock, imagen_url").eq("activo", true).order("costo")
//    Canjear:    const { data: canje, error } = await db.rpc("canjear_premio", { p_premio_id: id })
//                Todo el trabajo (saldo, stock, código) lo hace la función en la base, en una sola transacción.
//                Los errores llegan en español en error.message: "No tienes puntos suficientes (necesitas X, tienes Y)",
//                "El premio está agotado", "El premio no está disponible". Muéstralos tal cual con Basurin.aviso.
//    Historial:  db.from("canjes").select("codigo, costo, estado, creado_en, premios(nombre)").eq("usuario_id", uid).order("creado_en", { ascending: false })
//                OJO: .eq("usuario_id", uid) es obligatorio (un administrador vería los de todos). Si un premio ya
//                no está activo, premios(nombre) llega null: muestra un texto por defecto.
//
// RESPONSIVE: grid de 1 columna en móvil, 2 en md y 3-4 en lg. Tarjetas con el botón siempre visible.
//
// LISTO CUANDO: canjear descuenta los puntos, muestra el código y el canje aparece en el historial; los errores
// se entienden. Prueba sin cuenta: /premios?demo=1 (solo con Flask en debug).

(async () => {
  const { db, demo, listo, aviso } = Basurin;
  const { sesion, perfil } = await listo;

  // TODO: implementar la pantalla
})();
