// PANTALLA: Ubicaciones de botes (/mapa)                                  ESTADO: por hacer
// Plantilla: templates/mapa.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// QUÉ DEBE HACER
//  - Mapa con todos los botes y su estatus, para encontrar el más cercano.
//  - Librería: Leaflet + OpenStreetMap (https://leafletjs.com, por CDN). No hace falta API key ni tarjeta.
//  - Un pin por bote, con color según `estatus`: activo = verde, lleno = rojo, mantenimiento = ámbar,
//    inactivo = gris. El color no puede ser lo único que lo diga: el popup y la lista llevan el texto.
//  - Popup: ubicación, estatus, distancia al usuario, botón "Cómo llegar"
//    (https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>, sin API key) y botón "Escanear aquí" (/escanear).
//  - Botón "Cerca de mí": navigator.geolocation (pedir permiso solo al pulsarlo), marcar al usuario y ordenar
//    la lista por distancia (fórmula de Haversine). Si niega el permiso, la pantalla sigue funcionando.
//  - Filtro "Solo disponibles" (estatus = 'activo'), activado por defecto, con opción de ver todos.
//  - Refrescar los botes cada ~15 s (la tabla botes no está en Realtime: usa polling).
//  - Estado vacío ("Aún no hay botes registrados"): hoy la tabla botes está vacía.
//
// DATOS (Supabase, con Basurin.db; la lectura de botes es pública por la política "todos ven los botes")
//    db.from("botes").select("id, ubicacion, latitud, longitud, estatus")
//
// RESPONSIVE
//  - Móvil (375 px): mapa a pantalla completa (h-[calc(100dvh-3.5rem)]) y la lista en un panel desplegable abajo.
//  - lg (>=1024 px): dos columnas: lista de botes (~24rem) + mapa.
//  - Para que el mapa ocupe todo el ancho, cambia las clases del contenedor con {% block main_clases %} (ver la plantilla).
//
// ACCESIBILIDAD: el mapa no lo puede usar un lector de pantalla; la lista de botes es la versión accesible
// (navegable con teclado, con la misma información). Botones de icono con aria-label.
//
// LISTO CUANDO: los pines salen de Supabase con su color, "Cerca de mí" ordena por distancia y se ve bien
// en 375 px y en escritorio. Prueba sin cuenta: /mapa?demo=1 (solo con Flask en debug; ahí usa datos de ejemplo).

(async () => {
  const { db, demo, listo } = Basurin;
  const { sesion, perfil, esAdmin } = await listo;

  // TODO: implementar la pantalla
})();
