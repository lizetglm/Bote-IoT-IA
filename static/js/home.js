// Pantalla Home (/home): bienvenida, puntos, resumen de reciclaje y actividad reciente.
// Los datos salen de las tablas del propio usuario (RLS) y se actualizan en vivo con Realtime.
// Con ?demo=1 (solo Flask en debug) usa datos de ejemplo y no toca Supabase.

(async () => {
  const { db, demo, listo, aviso, material, numero, hace, pintarMenu } = Basurin;
  const $ = (id) => document.getElementById(id);

  const VIVO_ENTRE_CARGAS = 20000; // ms entre recargas si Realtime no conecta
  const REFRESCO_SESION = 10000;   // ms entre revisiones de "conectado a un bote"

  const estado = { perfil: null, tx: [], canjes: [], premios: [], botes: new Map(), sesion: null };

  const el = (etiqueta, clases, texto) => {
    const nodo = document.createElement(etiqueta);
    if (clases) nodo.className = clases;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };
  const plural = (n, uno, varios) => (n === 1 ? uno : varios);
  const suma = (lista, campo) => lista.reduce((total, f) => total + (f[campo] ?? 0), 0);

  // ---------- Pintar ----------
  function saludoPorHora() {
    const h = new Date().getHours();
    return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  }

  function pintarBienvenida() {
    const primerNombre = (estado.perfil.nombre || "").trim().split(/\s+/)[0] || "reciclador";
    $("saludo").textContent = saludoPorHora();
    $("titulo-bienvenida").textContent = `¡Hola, ${primerNombre}!`;
  }

  function pintarPuntos() {
    const depositos = estado.tx.length;
    $("puntos-saldo").textContent = numero(estado.perfil.puntos);
    $("puntos-resumen").textContent = depositos
      ? `Has reciclado ${numero(depositos)} ${plural(depositos, "residuo", "residuos")}. ¡Sigue así!`
      : "Escanea el QR de un bote para empezar a sumar puntos.";
    pintarMenu(estado.perfil);
  }

  function pintarStats() {
    const canjeados = suma(estado.canjes.filter((c) => c.estado !== "cancelado"), "costo");
    $("stat-obtenidos").textContent = numero(suma(estado.tx, "puntos"));
    $("stat-canjeados").textContent = numero(canjeados);
    $("stat-depositos").textContent = numero(estado.tx.length);
  }

  function pintarPremio() {
    const saldo = estado.perfil.puntos;
    const progreso = $("premio-progreso");
    const siguiente = estado.premios.find((p) => p.costo > saldo);

    if (!estado.premios.length) {
      progreso.classList.add("hidden");
      $("premio-texto").textContent = "Pronto habrá premios para canjear tus puntos.";
      return;
    }
    const porcentaje = siguiente ? Math.min(100, Math.round((saldo / siguiente.costo) * 100)) : 100;
    progreso.classList.remove("hidden");
    progreso.setAttribute("aria-valuenow", porcentaje);
    $("premio-barra").style.width = `${porcentaje}%`;
    $("premio-texto").textContent = siguiente
      ? `Te faltan ${numero(siguiente.costo - saldo)} puntos para «${siguiente.nombre}».`
      : "¡Ya puedes canjear cualquiera de los premios disponibles!";
  }

  function pintarMateriales() {
    const grupos = new Map();
    for (const t of estado.tx) {
      const m = material(t.material);
      const g = grupos.get(m.clave) ?? { m, n: 0, puntos: 0 };
      g.n += 1;
      g.puntos += t.puntos ?? 0;
      grupos.set(m.clave, g);
    }
    const filas = [...grupos.values()].sort((a, b) => b.n - a.n);
    const maximo = filas[0]?.n ?? 1;

    $("materiales-vacio").classList.toggle("hidden", filas.length > 0);
    $("lista-materiales").replaceChildren(
      ...filas.map(({ m, n, puntos }) => {
        const nombre = el("span", "flex items-center gap-2 font-semibold text-gray-800");
        nombre.append(el("span", `h-3 w-3 rounded-full ${m.punto}`), m.etiqueta);
        nombre.firstChild.setAttribute("aria-hidden", "true");

        const cabecera = el("div", "flex items-center justify-between gap-3 text-sm");
        cabecera.append(nombre, el("span", "text-right tabular-nums text-gray-500", `${numero(n)} ${plural(n, "depósito", "depósitos")} · ${numero(puntos)} pts`));

        const barra = el("div", `h-full rounded-full ${m.punto}`);
        barra.style.width = `${(n / maximo) * 100}%`;
        const pista = el("div", "mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100");
        pista.setAttribute("aria-hidden", "true");
        pista.append(barra);

        const fila = el("li");
        fila.append(cabecera, pista);
        return fila;
      })
    );
  }

  function pintarActividad() {
    const recientes = estado.tx.slice(0, 5);
    $("actividad-vacia").classList.toggle("hidden", recientes.length > 0);
    $("lista-actividad").replaceChildren(
      ...recientes.map((t) => {
        const m = material(t.material);
        const lugar = estado.botes.get(t.bote_id) ?? `Bote #${t.bote_id}`;

        const punto = el("span", `h-3 w-3 shrink-0 rounded-full ${m.punto}`);
        punto.setAttribute("aria-hidden", "true");
        const textos = el("div", "min-w-0 flex-1");
        textos.append(el("p", "truncate text-sm font-semibold text-gray-800", m.etiqueta), el("p", "truncate text-xs text-gray-500", `${hace(t.fecha)} · ${lugar}`));

        const fila = el("li", "flex items-center gap-3 py-3");
        fila.append(punto, textos, el("span", "shrink-0 text-sm font-bold tabular-nums text-eco-700", `+${numero(t.puntos)} pts`));
        return fila;
      })
    );
  }

  function pintarSesion() {
    const banner = $("banner-sesion");
    banner.classList.toggle("hidden", !estado.sesion);
    banner.classList.toggle("flex", Boolean(estado.sesion));
    if (estado.sesion) {
      $("sesion-bote").textContent = estado.botes.get(estado.sesion.bote_id) ?? `#${estado.sesion.bote_id}`;
    }
  }

  function pintarTodo() {
    pintarBienvenida();
    pintarPuntos();
    pintarStats();
    pintarPremio();
    pintarMateriales();
    pintarActividad();
    pintarSesion();
  }

  function mostrarError(texto) {
    $("home-error-texto").textContent = texto;
    $("home-error").classList.remove("hidden");
    $("home-error").classList.add("flex");
  }

  function ocultarError() {
    $("home-error").classList.add("hidden");
    $("home-error").classList.remove("flex");
  }

  // ---------- Datos ----------
  // Si una consulta falla se pinta lo demás; solo el perfil es imprescindible.
  const dato = (respuesta, porDefecto) => {
    if (respuesta.error) {
      console.warn("Consulta fallida:", respuesta.error);
      return porDefecto;
    }
    return respuesta.data ?? porDefecto;
  };

  async function nombresDeBotes(ids) {
    const faltan = [...new Set(ids)].filter((id) => id != null && !estado.botes.has(id));
    if (!faltan.length) return;
    const { data } = await db.from("botes").select("id, ubicacion").in("id", faltan);
    for (const b of data ?? []) estado.botes.set(b.id, b.ubicacion);
  }

  async function cargar(uid) {
    // OJO: el .eq("usuario_id", uid) es obligatorio; un administrador vería las filas de todos.
    const [perfil, tx, canjes, premios, sesion] = await Promise.all([
      db.from("usuarios").select("nombre, correo, puntos, rol, creado_en").eq("id", uid).single(),
      db.from("transacciones").select("id, material, puntos, fecha, bote_id").eq("usuario_id", uid).order("fecha", { ascending: false }).limit(1000),
      db.from("canjes").select("costo, estado").eq("usuario_id", uid),
      db.from("premios").select("id, nombre, costo, tipo").eq("activo", true).order("costo"),
      db.from("sesiones_activas").select("bote_id, iniciada_en").eq("usuario_id", uid).maybeSingle(),
    ]);
    if (perfil.error) throw perfil.error;

    estado.perfil = perfil.data;
    estado.tx = dato(tx, []); // TODO: con >1000 depósitos por usuario, calcular los totales con una vista o RPC
    estado.canjes = dato(canjes, []);
    estado.premios = dato(premios, []);
    estado.sesion = dato(sesion, null);
    await nombresDeBotes([...estado.tx.slice(0, 5).map((t) => t.bote_id), estado.sesion?.bote_id]);
  }

  function datosDemo() {
    const minuto = 60000, hora = 3600000, dia = 86400000;
    const catalogo = [["Plastico", 8], ["Metal", 12], ["Vidrio", 10], ["Papel_Carton", 6], ["Organico", 5]];
    const atras = [12 * minuto, 3 * hora, 26 * hora, 27 * hora, 2 * dia, 3 * dia, 3 * dia + hora, 5 * dia, 6 * dia, 6 * dia + 2 * hora, 8 * dia, 9 * dia, 11 * dia, 12 * dia];
    estado.tx = atras.map((ms, i) => {
      const [nombre, puntos] = catalogo[(i * 3) % catalogo.length];
      return { id: i + 1, material: nombre, puntos, fecha: new Date(Date.now() - ms).toISOString(), bote_id: (i % 3) + 1 };
    });
    estado.canjes = [{ costo: 50, estado: "entregado" }];
    estado.premios = [
      { id: 1, nombre: "Donar a una cooperativa", costo: 100, tipo: "donacion" },
      { id: 2, nombre: "Café gratis", costo: 200, tipo: "cupon" },
      { id: 3, nombre: "Botella reutilizable", costo: 400, tipo: "cupon" },
    ];
    estado.botes = new Map([[1, "Cafetería central"], [2, "Biblioteca"], [3, "Gimnasio"]]);
    estado.sesion = new URLSearchParams(location.search).get("sesion") === "1" ? { bote_id: 1, iniciada_en: new Date().toISOString() } : null;
    // El saldo cuadra con lo obtenido y lo canjeado
    estado.perfil.puntos = suma(estado.tx, "puntos") - suma(estado.canjes, "costo");
  }

  // ---------- En vivo ----------
  let temporizadorReconexion = null;
  let temporizadorSaldo = null;

  function resaltarPuntos() {
    const tarjeta = $("tarjeta-puntos");
    tarjeta.classList.add("ring-4", "ring-eco-300");
    setTimeout(() => tarjeta.classList.remove("ring-4", "ring-eco-300"), 1200);
  }

  async function refrescarSaldo(uid) {
    try {
      const { data } = await db.from("usuarios").select("puntos").eq("id", uid).single();
      if (data && data.puntos !== estado.perfil.puntos) {
        estado.perfil.puntos = data.puntos;
        pintarPuntos();
        pintarPremio();
        resaltarPuntos();
      }
    } catch (e) {
      console.warn("No se pudo refrescar el saldo:", e);
    }
  }

  function agregarDeposito(fila, uid) {
    if (estado.tx.some((t) => t.id === fila.id)) return;
    estado.tx.unshift(fila);
    nombresDeBotes([fila.bote_id]).then(() => {
      pintarPuntos();
      pintarStats();
      pintarMateriales();
      pintarActividad();
    });
    aviso(`+${numero(fila.puntos)} puntos · ${material(fila.material).etiqueta}`, "exito");
    // El saldo llega por su propio evento; si no llegara, lo pedimos
    clearTimeout(temporizadorSaldo);
    temporizadorSaldo = setTimeout(() => refrescarSaldo(uid), 1500);
  }

  function suscribir(uid) {
    db.channel(`home-${uid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "usuarios", filter: `id=eq.${uid}` }, ({ new: fila }) => {
        estado.perfil.puntos = fila.puntos;
        pintarPuntos();
        pintarPremio();
        resaltarPuntos();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transacciones", filter: `usuario_id=eq.${uid}` }, ({ new: fila }) => agregarDeposito(fila, uid))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sesiones_activas", filter: `usuario_id=eq.${uid}` }, () => refrescarSesion(uid))
      .subscribe((situacion) => {
        if (situacion === "SUBSCRIBED") {
          clearInterval(temporizadorReconexion);
          temporizadorReconexion = null;
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(situacion) && !temporizadorReconexion) {
          // Sin Realtime, recargamos cada tanto para no quedarnos desactualizados
          temporizadorReconexion = setInterval(() => !document.hidden && recargar(uid, true), VIVO_ENTRE_CARGAS);
        }
      });
  }

  async function refrescarSesion(uid) {
    try {
      const { data } = await db.from("sesiones_activas").select("bote_id, iniciada_en").eq("usuario_id", uid).maybeSingle();
      estado.sesion = data ?? null;
      await nombresDeBotes([estado.sesion?.bote_id]);
      pintarSesion();
    } catch (e) {
      console.warn("No se pudo revisar la sesión con el bote:", e);
    }
  }

  // ---------- Arranque ----------
  async function recargar(uid, silencioso = false) {
    try {
      await cargar(uid);
      ocultarError();
      pintarTodo();
    } catch (e) {
      console.error("No se pudo cargar la home:", e);
      if (!silencioso) mostrarError("No pudimos cargar tus datos. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      $("home").setAttribute("aria-busy", "false");
    }
  }

  try {
    const { sesion, perfil } = await listo;
    estado.perfil = perfil;
    pintarBienvenida();

    if (demo) {
      datosDemo();
      pintarTodo();
      $("home").setAttribute("aria-busy", "false");
      return;
    }

    const uid = sesion.user.id;
    $("btn-reintentar").addEventListener("click", () => recargar(uid));
    await recargar(uid);
    suscribir(uid);
    setInterval(() => !document.hidden && refrescarSesion(uid), REFRESCO_SESION);
  } catch (e) {
    console.error(e);
    mostrarError("No pudimos iniciar la pantalla. Revisa tu conexión e inténtalo de nuevo.");
    $("home").setAttribute("aria-busy", "false");
  }
})();
