// Contexto compartido de las pantallas de la app (las que extienden base_app.html).
// Cada pantalla solo escribe su lógica y usa esto:
//
//   const { db, listo, aviso } = Basurin;
//   const { sesion, perfil, esAdmin } = await listo;
//
//   Basurin.db                  cliente de Supabase (llave anon: los datos los protege RLS)
//   Basurin.listo               Promise -> { sesion, perfil, esAdmin }. Sin sesión manda a /login
//   Basurin.exigirAdmin()       igual que listo, pero manda a /home si la cuenta no es administradora
//   Basurin.demo                true con ?demo=1 (solo con Flask en debug): datos de ejemplo, sin Supabase
//   Basurin.pintarMenu(perfil)  actualiza nombre y puntos del menú (úsalo si cambian en vivo)
//   Basurin.aviso(texto, tipo)  mensaje flotante: "exito" | "error" | "info"
//   Basurin.material(nombre)    { clave, etiqueta, punto, chip } para pintar un material
//   Basurin.numero(n), Basurin.hace(iso)   números y fechas en español
//
// OJO (administradores): las políticas les dejan leer TODAS las filas de transacciones, canjes y
// sesiones. Toda consulta "de mi cuenta" debe llevar .eq("usuario_id", uid) o mostrará datos ajenos.
// OJO (seguridad): nunca uses innerHTML con datos de la base (el nombre lo escribe el usuario);
// usa textContent o crea los nodos con document.createElement.

(() => {
  const { url, anonKey, demoPermitido } = window.BASURIN_CONFIG;
  const params = new URLSearchParams(location.search);
  const demo = Boolean(demoPermitido) && params.get("demo") === "1";
  const $ = (id) => document.getElementById(id);

  let db = null;
  try {
    db = window.supabase.createClient(url, anonKey);
  } catch (e) {
    console.error("Supabase no está configurado (revisa SUPABASE_URL y SUPABASE_ANON_KEY en .env)", e);
  }

  // ---------- Formato ----------
  const RTF = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const TRAMOS = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const NUMEROS = new Intl.NumberFormat("es-MX");

  const numero = (n) => NUMEROS.format(n ?? 0);

  function hace(iso) {
    const seg = (new Date(iso).getTime() - Date.now()) / 1000; // negativo = pasado
    for (const [unidad, s] of TRAMOS) {
      if (Math.abs(seg) >= s) return RTF.format(Math.round(seg / s), unidad);
    }
    return "hace un momento";
  }

  // Primera letra de las dos primeras palabras ("Ana López" -> "AL"); ignora símbolos y signos
  function iniciales(nombre) {
    const letras = (nombre || "").trim().split(/\s+/).map((palabra) => palabra.match(/\p{L}/u)?.[0]).filter(Boolean);
    return (letras.slice(0, 2).join("") || "?").toUpperCase();
  }

  // ---------- Materiales (los nombres que manda el bote en transacciones.material) ----------
  const MATERIALES = {
    organico:    { etiqueta: "Orgánico",       punto: "bg-lime-500",  chip: "bg-lime-100 text-lime-900" },
    plastico:    { etiqueta: "Plástico",       punto: "bg-amber-500", chip: "bg-amber-100 text-amber-900" },
    papelcarton: { etiqueta: "Papel y cartón", punto: "bg-sky-500",   chip: "bg-sky-100 text-sky-900" },
    metal:       { etiqueta: "Metal",          punto: "bg-slate-500", chip: "bg-slate-200 text-slate-900" },
    vidrio:      { etiqueta: "Vidrio",         punto: "bg-cyan-500",  chip: "bg-cyan-100 text-cyan-900" },
  };

  // "Papel_Carton", "papel carton" y "Papel-Cartón" son el mismo material
  function material(nombre) {
    const clave = String(nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    return { clave, ...(MATERIALES[clave] ?? { etiqueta: nombre || "Otro", punto: "bg-gray-400", chip: "bg-gray-100 text-gray-800" }) };
  }

  // ---------- Avisos flotantes ----------
  const ESTILOS_AVISO = {
    exito: "bg-eco-800 text-white",
    error: "bg-red-800 text-white",
    info: "bg-gray-900 text-white",
  };

  function aviso(texto, tipo = "info") {
    const nodo = document.createElement("div");
    nodo.className = `pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${ESTILOS_AVISO[tipo] ?? ESTILOS_AVISO.info}`;
    nodo.textContent = texto;
    $("avisos").append(nodo);
    setTimeout(() => nodo.remove(), 4500);
  }

  // ---------- Sesión y perfil ----------
  const PERFIL_DEMO = {
    nombre: "Ana Demo",
    correo: "ana@ejemplo.com",
    puntos: 145,
    rol: params.get("admin") === "1" ? 1 : 0,
    creado_en: new Date(Date.now() - 20 * 86400000).toISOString(),
  };

  async function leerPerfil(uid, correo) {
    const { data, error } = await db
      .from("usuarios")
      .select("nombre, correo, puntos, rol, creado_en")
      .eq("id", uid)
      .single();
    if (error) {
      console.error("No se pudo leer el perfil:", error);
      return { nombre: correo ?? "Usuario", correo, puntos: 0, rol: 0, creado_en: null, incompleto: true };
    }
    return data;
  }

  async function iniciar() {
    if (demo) {
      return { sesion: { user: { id: "demo", email: PERFIL_DEMO.correo } }, perfil: { ...PERFIL_DEMO }, esAdmin: PERFIL_DEMO.rol === 1 };
    }
    if (!db) throw new Error("Supabase no está configurado");

    const { data } = await db.auth.getSession();
    if (!data.session) {
      // Sin sesión: al login, y de ahí de vuelta a esta misma pantalla
      location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
      return new Promise(() => {}); // la página se está yendo: que nadie siga
    }
    const perfil = await leerPerfil(data.session.user.id, data.session.user.email);
    return { sesion: data.session, perfil, esAdmin: perfil.rol === 1 };
  }

  function pintarMenu(perfil) {
    $("menu-nombre").textContent = perfil.nombre;
    $("menu-puntos").textContent = numero(perfil.puntos);
    $("avatar-iniciales").replaceChildren(iniciales(perfil.nombre));
    $("menu-item-panel").classList.toggle("hidden", perfil.rol !== 1);
  }

  const listo = iniciar().then((contexto) => {
    pintarMenu(contexto.perfil);
    return contexto;
  });

  async function exigirAdmin() {
    const contexto = await listo;
    if (!contexto.esAdmin) {
      location.replace(demo ? "/home?demo=1" : "/home");
      return new Promise(() => {});
    }
    return contexto;
  }

  // ---------- Menú lateral ----------
  const menu = $("menu-lateral");
  const overlay = $("menu-overlay");
  const botonMenu = $("btn-menu");

  function abrirMenu() {
    menu.removeAttribute("inert");
    menu.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    botonMenu.setAttribute("aria-expanded", "true");
    $("btn-cerrar-menu").focus();
  }

  function cerrarMenu() {
    menu.setAttribute("inert", "");
    menu.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    botonMenu.setAttribute("aria-expanded", "false");
    botonMenu.focus();
  }

  botonMenu.addEventListener("click", abrirMenu);
  $("btn-cerrar-menu").addEventListener("click", cerrarMenu);
  overlay.addEventListener("click", cerrarMenu);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hasAttribute("inert")) cerrarMenu();
  });

  // El foco no se sale del menú mientras está abierto
  menu.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const foco = [...menu.querySelectorAll("a[href], button:not([disabled])")].filter((n) => !n.closest(".hidden"));
    const primero = foco[0];
    const ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  });

  // ---------- Cerrar sesión ----------
  let saliendo = false;

  $("btn-salir").addEventListener("click", async () => {
    saliendo = true;
    if (!demo && db) await db.auth.signOut();
    location.href = demo ? "/home?demo=1" : "/";
  });

  // Si la sesión se cierra en otra pestaña, esta también sale. El setTimeout evita consultar
  // Supabase dentro del callback de auth, que puede bloquear el cliente.
  if (!demo && db) {
    db.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT" && !saliendo) setTimeout(() => location.replace("/login"), 0);
    });
  }

  // ---------- Modo demostración: datos de ejemplo y navegación que no pierde el modo ----------
  if (demo) {
    const barra = document.createElement("div");
    barra.setAttribute("role", "status");
    barra.className = "bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900";
    barra.textContent = "Modo demostración: datos de ejemplo, sin conexión a Supabase.";
    document.querySelector("header").before(barra);

    document.querySelectorAll('a[href^="/"]').forEach((a) => {
      const destino = new URL(a.getAttribute("href"), location.origin);
      destino.searchParams.set("demo", "1");
      if (params.get("admin") === "1") destino.searchParams.set("admin", "1");
      a.setAttribute("href", destino.pathname + destino.search);
    });
  }

  window.Basurin = { db, demo, listo, exigirAdmin, pintarMenu, aviso, material, numero, hace };
})();
