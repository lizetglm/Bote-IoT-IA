// PANTALLA: Panel de control (/panel), solo administradores                ESTADO: en progreso (1 y 2 hechos)
// Plantilla: templates/panel.html (extiende base_app.html: menú, sesión y avisos ya vienen resueltos).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.
//
// ACCESO: un administrador es usuarios.rol = 1. Esta pantalla empieza con `await Basurin.exigirAdmin()`, que manda
// a /home a quien no lo sea. Eso solo es comodidad: la protección real está en Supabase (RLS y funciones) y, para
// el video, en la API de Flask (que debe comprobar el rol en el servidor). Nunca confíes en ocultar un botón.
//
// QUÉ DEBE HACER
//  1. Cámara con visión artificial: el video del bote con lo que detecta el modelo (como la imagen 2 del boceto).
//     HECHO (versión local): el detector de bote_inteligente.py arranca solo al iniciar Flask en la laptop del bote
//     (camara_web.py), entre o no un administrador. Aquí solo se ve: "Ver video" pide el MJPEG a un <img>.
//     El select de botes es ilustrativo (hay una sola cámara, la del BOTE_ID del .env).
//     API (Flask comprueba es_admin en Supabase): GET /api/admin/camara/estado, POST /api/admin/camara/token-video,
//     GET /api/admin/camara/video?t=<token corto de un uso>, POST /api/admin/camara/iniciar (Reintentar si falló).
//     PENDIENTE para Render: Render no puede ver la cámara de la laptop, así que ahí irá por relay (el script del
//     bote sube fotogramas anotados a Flask con la clave del bote y Flask los reparte a los administradores).
//  2. Últimas detecciones y contadores por material. HECHO: salen de transacciones (hoy, del bote de la cámara) y
//     se actualizan con Realtime. Cada clasificación de la cámara la guarda el servidor como transacción del
//     usuario vinculado al bote (camara_web.py); sin nadie vinculado se guarda sin usuario y con 0 puntos, y cuenta igual.
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
// Prueba sin cuenta: /panel?demo=1&admin=1 (solo con Flask en debug; la cámara solo desde localhost).

(async () => {
  const { db, demo, aviso, material, numero } = Basurin;
  const { sesion } = await Basurin.exigirAdmin();
  const $ = (id) => document.getElementById(id);

  // Orden fijo de los materiales (el mismo del modelo y del ESP32)
  const MATERIALES = ["organico", "plastico", "papelcarton", "metal", "vidrio"];
  const MINUTOS_RITMO = 15;

  let transacciones = []; // las de hoy, más nuevas primero
  let boteId;             // el de la cámara (BOTE_ID en el .env de Flask); null = todos los botes

  // ---------- API de la cámara (Flask comprueba en el servidor que la cuenta sea administradora) ----------
  async function api(ruta, metodo = "GET", cuerpo) {
    const headers = { "Content-Type": "application/json" };
    if (demo) {
      headers["X-Basurin-Demo"] = "1";
    } else {
      const { data } = await db.auth.getSession(); // token vigente (Supabase lo renueva solo)
      headers.Authorization = `Bearer ${(data.session ?? sesion).access_token}`;
    }
    const r = await fetch(`/api/admin/camara/${ruta}`, { method: metodo, headers, body: cuerpo && JSON.stringify(cuerpo) });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
    return datos;
  }

  // ---------- Estado de la cámara y video ----------
  const ESTADOS = {
    apagada:   { texto: "Apagada",    punto: "bg-gray-400",  mensaje: "La cámara está apagada (INICIAR_CAMARA=0 en el servidor)." },
    iniciando: { texto: "Iniciando…", punto: "bg-amber-500 animate-pulse motion-reduce:animate-none", mensaje: "Cargando el modelo y abriendo la cámara…" },
    activa:    { texto: "En vivo",    punto: "bg-eco-500",   mensaje: "Pulsa «Ver video» para ver la cámara." },
    error:     { texto: "Error",      punto: "bg-red-600",   mensaje: "La cámara se detuvo." },
  };

  const video = $("camara-video");
  let videoConectado = false;
  let viendo = false;        // el administrador pulsó "Ver video"
  let estadoAnterior = null;

  async function conectarVideo() {
    videoConectado = true;
    try {
      const { token } = await api("token-video", "POST");
      video.src = `/api/admin/camara/video?t=${encodeURIComponent(token)}`;
    } catch (e) {
      videoConectado = false;
    }
  }

  function desconectarVideo() {
    videoConectado = false;
    video.removeAttribute("src");
    video.classList.add("hidden");
    $("camara-sin-senal").classList.remove("hidden");
  }

  video.addEventListener("load", () => {
    video.classList.remove("hidden");
    $("camara-sin-senal").classList.add("hidden");
  });
  // El stream se cortó (Flask se reinició, la red falló...): el siguiente sondeo lo vuelve a pedir
  video.addEventListener("error", desconectarVideo);

  function pintarEstado(resumen) {
    const info = ESTADOS[resumen.estado] ?? ESTADOS.apagada;
    $("camara-estado-texto").textContent = info.texto;
    $("camara-punto").className = `h-2.5 w-2.5 rounded-full ${info.punto}`;
    $("camara-mensaje").textContent = resumen.estado === "error" && resumen.error ? `Error: ${resumen.error}` : info.mensaje;
    $("camara-esp32").textContent = resumen.estado === "activa"
      ? `ESP32: ${resumen.esp32 ?? "sin conexión (simulación)"}`
      : "ESP32: –";

    const dispositivo = resumen.estado === "activa" ? resumen.dispositivo : null;
    $("camara-dispositivo").textContent = dispositivo ? `Modelo en ${dispositivo.startsWith("cuda") ? "GPU" : dispositivo.toUpperCase()}` : "";
    $("camara-dispositivo").classList.toggle("hidden", !dispositivo);

    const activa = resumen.estado === "activa";
    const encendida = activa || resumen.estado === "iniciando";
    $("btn-ver-video").disabled = !activa;
    $("btn-reintentar-camara").classList.toggle("hidden", encendida);
    if (activa && viendo && !videoConectado) {
      $("camara-mensaje").textContent = "Conectando con el video…";
      conectarVideo();
    }
    if ((!activa || !viendo) && videoConectado) desconectarVideo();

    // Qué pasó con la última clasificación al guardarla en transacciones
    const registro = $("camara-registro");
    const ultimo = resumen.ultimo_registro;
    const encendidaSinRegistro = encendida && !resumen.registro_activo;
    registro.classList.toggle("hidden", !ultimo && !encendidaSinRegistro);
    if (encendidaSinRegistro) {
      registro.className = "mt-3 text-sm font-semibold text-red-700";
      registro.textContent = "Las clasificaciones no se están guardando: falta SUPABASE_SERVICE_ROLE_KEY en el .env del servidor.";
    } else if (ultimo) {
      registro.className = `mt-3 text-sm ${ultimo.ok ? "text-gray-600" : "font-semibold text-amber-800"}`;
      registro.textContent = `Último registro (${Basurin.hace(new Date(ultimo.hora * 1000).toISOString())}): ${ultimo.texto}`;
    }

    if (estadoAnterior === "iniciando" && resumen.estado === "activa") aviso("Cámara encendida", "exito");
    if (estadoAnterior && estadoAnterior !== "error" && resumen.estado === "error") aviso(resumen.error || "La cámara se detuvo", "error");
    estadoAnterior = resumen.estado;
  }

  // ---------- Transacciones de hoy (Supabase) ----------
  function inicioDeHoy() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return hoy;
  }

  function datosDemo() {
    const catalogo = [["Plastico", 8], ["Metal", 12], ["Vidrio", 10], ["Papel_Carton", 6], ["Organico", 5]];
    const nombres = ["Ana Demo", "Luis Pérez", "María G."];
    return Array.from({ length: 23 }, (_, i) => {
      const [nombre, puntos] = catalogo[(i * 3 + (i >> 2)) % 5];
      const ms = i < 9 ? i * 95000 : i * 1500000; // unas en los últimos 15 min, otras más temprano
      return { id: i + 1, material: nombre, puntos, fecha: new Date(Date.now() - ms).toISOString(), usuarios: i % 4 === 3 ? null : { nombre: nombres[i % 3] } };
    }).filter((t) => new Date(t.fecha) >= inicioDeHoy());
  }

  async function cargarTransacciones() {
    if (demo) {
      transacciones = datosDemo();
      pintarDatos();
      return;
    }
    // Sin .eq("usuario_id"): como administrador se ven las de todos los usuarios (es lo que queremos aquí)
    let consulta = db.from("transacciones")
      .select("id, material, puntos, fecha, usuarios(nombre)")
      .gte("fecha", inicioDeHoy().toISOString())
      .order("fecha", { ascending: false })
      .limit(5000);
    if (boteId != null) consulta = consulta.eq("bote_id", boteId);
    const { data, error } = await consulta;
    if (error) {
      console.error("No se pudieron leer las transacciones:", error);
      aviso("No se pudieron leer las transacciones", "error");
      return;
    }
    transacciones = data;
    pintarDatos();
  }

  // Realtime: cada transacción nueva vuelve a pedir la lista (así trae también el nombre del usuario)
  let recargaPendiente = null;
  function escucharTransacciones() {
    if (demo || !db) return;
    const filtro = boteId != null ? { filter: `bote_id=eq.${boteId}` } : {};
    db.channel("panel-transacciones")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transacciones", ...filtro }, () => {
        clearTimeout(recargaPendiente);
        recargaPendiente = setTimeout(cargarTransacciones, 400);
      })
      .subscribe();
  }

  // ---------- Conteo por material ----------
  // El modelo manda "Papel_Carton", "Organico"...; material() los junta en la misma clave que usa toda la app
  function contarPorMaterial(filas) {
    const porClave = Object.fromEntries(MATERIALES.map((clave) => [clave, 0]));
    for (const t of filas) {
      const { clave } = material(t.material);
      porClave[clave] = (porClave[clave] ?? 0) + 1;
    }
    return porClave;
  }

  function punto(clase) {
    const nodo = document.createElement("span");
    nodo.className = `h-2.5 w-2.5 shrink-0 rounded-full ${clase}`;
    nodo.setAttribute("aria-hidden", "true");
    return nodo;
  }

  function tarjeta(etiqueta, valor, clasePunto) {
    const li = document.createElement("li");
    li.className = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100";
    const titulo = document.createElement("p");
    titulo.className = "flex items-center gap-2 text-sm font-semibold text-gray-600";
    if (clasePunto) titulo.append(punto(clasePunto));
    titulo.append(etiqueta);
    const cifra = document.createElement("p");
    cifra.className = "mt-1 text-3xl font-extrabold tabular-nums text-gray-900";
    cifra.textContent = numero(valor);
    li.append(titulo, cifra);
    return li;
  }

  function pintarConteo(porClave, total) {
    $("conteo-materiales").replaceChildren(
      tarjeta("Total", total),
      ...Object.entries(porClave).map(([clave, n]) => {
        const m = material(clave);
        return tarjeta(m.etiqueta, n, m.punto);
      }),
    );
  }

  // ---------- Gráfica: clasificaciones por material (barras horizontales, un solo color) ----------
  function pintarGraficaMateriales(porClave, total) {
    const maximo = Math.max(1, ...Object.values(porClave));
    $("grafica-materiales").replaceChildren(...Object.entries(porClave).map(([clave, n]) => {
      const m = material(clave);
      const porcentaje = total ? Math.round((n / total) * 100) : 0;

      const fila = document.createElement("div");
      fila.setAttribute("role", "listitem");
      fila.tabIndex = 0;
      fila.dataset.tooltip = `${m.etiqueta}: ${numero(n)} (${porcentaje}%)`;
      fila.setAttribute("aria-label", fila.dataset.tooltip);
      fila.className = "grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600";

      const etiqueta = document.createElement("span");
      etiqueta.className = "flex items-center gap-2 truncate text-sm text-gray-700";
      etiqueta.append(punto(m.punto), m.etiqueta);

      const pista = document.createElement("span");
      pista.className = "h-4 rounded-r bg-gray-100";
      const barra = document.createElement("span");
      barra.className = "block h-4 rounded-r bg-eco-600 transition-[width] duration-500 motion-reduce:transition-none";
      barra.style.width = n ? `${(n / maximo) * 100}%` : "0";
      pista.append(barra);

      const valor = document.createElement("span");
      valor.className = "text-right text-sm font-bold tabular-nums text-gray-900";
      valor.textContent = numero(n);

      fila.append(etiqueta, pista, valor);
      return fila;
    }));
  }

  // ---------- Gráfica: clasificaciones por minuto (columnas) ----------
  function pintarGraficaRitmo(filas) {
    const ahora = Date.now();
    const cubetas = Array(MINUTOS_RITMO).fill(0);
    for (const { fecha } of filas) {
      const indice = MINUTOS_RITMO - 1 - Math.floor((ahora - new Date(fecha).getTime()) / 60000);
      if (indice >= 0 && indice < MINUTOS_RITMO) cubetas[indice] += 1;
    }
    const maximo = Math.max(1, ...cubetas);
    $("ritmo-max").textContent = numero(maximo);

    $("grafica-ritmo").replaceChildren(...cubetas.map((n, i) => {
      const minutos = MINUTOS_RITMO - 1 - i;
      const columna = document.createElement("div");
      columna.setAttribute("role", "listitem");
      columna.tabIndex = 0;
      columna.dataset.tooltip = `${minutos === 0 ? "Este minuto" : `Hace ${minutos} min`}: ${numero(n)} clasificaciones`;
      columna.setAttribute("aria-label", columna.dataset.tooltip);
      columna.className = "flex h-full flex-1 items-end justify-center rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600";
      const barra = document.createElement("span");
      barra.className = "block w-full max-w-[24px] rounded-t bg-eco-600";
      barra.style.height = n ? `${(n / maximo) * 100}%` : "0";
      columna.append(barra);
      return columna;
    }));
  }

  // ---------- Últimas clasificaciones ----------
  function pintarUltimas(filas) {
    const ultimas = filas.slice(0, 8);
    $("ultimas-vacio").classList.toggle("hidden", ultimas.length > 0);
    $("lista-ultimas").replaceChildren(...ultimas.map((t) => {
      const m = material(t.material);
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-3 py-2.5";
      const izquierda = document.createElement("span");
      izquierda.className = "flex min-w-0 items-center gap-2";
      const chip = document.createElement("span");
      chip.className = `shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${m.chip}`;
      chip.textContent = m.etiqueta;
      const usuario = document.createElement("span");
      usuario.className = `truncate text-sm ${t.usuarios ? "text-gray-700" : "italic text-gray-500"}`;
      usuario.textContent = t.usuarios?.nombre ?? "Sin registrar";
      izquierda.append(chip, usuario);
      const detalle = document.createElement("span");
      detalle.className = "shrink-0 text-right text-sm tabular-nums text-gray-500";
      const hora = new Date(t.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      detalle.textContent = `${t.usuarios ? `+${numero(t.puntos)} pts` : "sin puntos"} · ${hora}`;
      li.append(izquierda, detalle);
      return li;
    }));
  }

  function pintarDatos() {
    const porClave = contarPorMaterial(transacciones);
    pintarConteo(porClave, transacciones.length);
    pintarGraficaMateriales(porClave, transacciones.length);
    pintarGraficaRitmo(transacciones);
    pintarUltimas(transacciones);
  }

  // ---------- Tooltip de las gráficas (ratón y teclado) ----------
  const tooltip = $("grafica-tooltip");

  function mostrarTooltip(nodo, x, y) {
    tooltip.textContent = nodo.dataset.tooltip;
    tooltip.classList.remove("hidden");
    const { width, height } = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(8, x - width / 2), innerWidth - width - 8)}px`;
    tooltip.style.top = `${Math.max(8, y - height - 10)}px`;
  }

  for (const id of ["grafica-materiales", "grafica-ritmo"]) {
    const grafica = $(id);
    grafica.addEventListener("mousemove", (e) => {
      const nodo = e.target.closest("[data-tooltip]");
      if (nodo) mostrarTooltip(nodo, e.clientX, e.clientY);
      else tooltip.classList.add("hidden");
    });
    grafica.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
    grafica.addEventListener("focusin", (e) => {
      const nodo = e.target.closest("[data-tooltip]");
      if (!nodo) return;
      const caja = nodo.getBoundingClientRect();
      mostrarTooltip(nodo, caja.left + caja.width / 2, caja.top);
    });
    grafica.addEventListener("focusout", () => tooltip.classList.add("hidden"));
  }

  // ---------- Botones y sondeo ----------
  async function actualizar() {
    try {
      pintarEstado(await api("estado"));
    } catch (e) {
      $("camara-mensaje").textContent = `No se pudo consultar la cámara: ${e.message}`;
    }
  }

  $("btn-ver-video").addEventListener("click", async () => {
    viendo = !viendo;
    $("btn-ver-video").setAttribute("aria-pressed", String(viendo));
    $("btn-ver-video-texto").textContent = viendo ? "Ocultar video" : "Ver video";
    await actualizar();
  });

  // Solo aparece si la cámara falló al arrancar o se cayó (la cámara la enciende el servidor al iniciar)
  $("btn-reintentar-camara").addEventListener("click", async () => {
    $("btn-reintentar-camara").disabled = true;
    try {
      pintarEstado(await api("iniciar", "POST"));
    } catch (e) {
      aviso(e.message, "error");
    } finally {
      $("btn-reintentar-camara").disabled = false;
    }
  });

  // ---------- Select de botes (ilustrativo: hay una sola cámara) ----------
  async function cargarBotes() {
    let botes;
    if (demo) {
      botes = [
        { id: 1, ubicacion: "Plaza principal", estatus: "activo" },
        { id: 2, ubicacion: "Biblioteca central", estatus: "lleno" },
        { id: 3, ubicacion: "Parque de la colonia", estatus: "mantenimiento" },
      ];
    } else {
      const { data, error } = await db.from("botes").select("id, ubicacion, estatus").order("id");
      if (error) console.error("No se pudieron leer los botes:", error);
      botes = data ?? [];
    }
    const select = $("select-bote");
    if (!botes.length) {
      select.replaceChildren(new Option("Sin botes registrados", ""));
      select.disabled = true;
      return;
    }
    select.replaceChildren(...botes.map((b) => {
      const texto = `Bote ${b.id} · ${b.ubicacion}${b.estatus !== "activo" ? ` (${b.estatus})` : ""}`;
      return new Option(texto, b.id, false, b.id === boteId);
    }));
  }

  pintarEstado({ estado: "iniciando" });
  estadoAnterior = null; // el aviso "Cámara encendida" es solo para cambios reales, no para la carga de la página
  $("camara-mensaje").textContent = "Consultando la cámara…";
  pintarDatos();

  // El bote de la cámara lo dice el servidor; con él se filtran las transacciones
  try {
    const resumen = await api("estado");
    boteId = resumen.bote_id;
    pintarEstado(resumen);
  } catch (e) {
    boteId = null;
    $("camara-mensaje").textContent = `No se pudo consultar la cámara: ${e.message}`;
  }
  $("conteo-alcance").textContent = boteId != null ? `Hoy · bote ${boteId}` : "Hoy · todos los botes";
  await Promise.all([cargarTransacciones(), cargarBotes()]);
  escucharTransacciones();

  setInterval(() => {
    if (!document.hidden) actualizar();
  }, 2000);
  // La gráfica por minuto avanza con el reloj (y a medianoche empieza otro día)
  setInterval(() => {
    if (!document.hidden) cargarTransacciones();
  }, 60000);

  // TODO: botes, canjes pendientes y premios (puntos 3 a 5 de la cabecera)
})();
