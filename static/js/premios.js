// Pantalla Premios (/premios): catálogo agrupado por sector (gobierno, industria, educativo y Basurin) para mostrar
// dónde se puede implementar el bote. Cada sector es un carrusel: con botones en pantallas md+ y deslizando con el
// dedo en móvil.
//   Usuario:        ve su saldo y canjea (db.rpc("canjear_premio"): saldo, stock y código en una sola transacción).
//   Administrador:  además crea, edita, pausa y borra premios, y ve los pausados. Ocultar botones es solo comodidad:
//                   la protección real son las políticas de premios en supabase/schema.sql.
// Con ?demo=1 (solo Flask en debug) usa datos de ejemplo; con &admin=1 también el modo administrador.
//
// PENDIENTE: historial de canjes del usuario (pendiente, entregado o cancelado):
//   db.from("canjes").select("codigo, costo, estado, creado_en, premios(nombre)").eq("usuario_id", uid).order("creado_en", { ascending: false })

(async () => {
  const { db, demo, listo, aviso, numero, pintarMenu } = Basurin;
  const $ = (id) => document.getElementById(id);

  // Iconos (trazos de Heroicons, 24x24)
  const ICONOS = {
    gobierno: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z",
    industria: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
    educativo: "M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5",
    propio: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z",
    anterior: "M15.75 19.5L8.25 12l7.5-7.5",
    siguiente: "M8.25 4.5l7.5 7.5-7.5 7.5",
    editar: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125",
    borrar: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.94-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0",
    agregar: "M12 4.5v15m7.5-7.5h-15",
  };

  const SECTORES = [
    { clave: "gobierno",  nombre: "Gobierno",  descripcion: "Municipios y dependencias que premian a la ciudadanía por reciclar.", color: "bg-sky-100 text-sky-800",       chip: "hover:bg-sky-50" },
    { clave: "industria", nombre: "Industria", descripcion: "Empresas y plantas que motivan a su personal a separar residuos.",    color: "bg-amber-100 text-amber-800",   chip: "hover:bg-amber-50" },
    { clave: "educativo", nombre: "Educativo", descripcion: "Escuelas y universidades que forman hábitos en su comunidad.",        color: "bg-violet-100 text-violet-800", chip: "hover:bg-violet-50" },
    { clave: "propio",    nombre: "Basurin",   descripcion: "Nuestros propios premios, disponibles en cualquier bote.",            color: "bg-eco-100 text-eco-800",       chip: "hover:bg-eco-50" },
  ];

  const estado = { uid: null, perfil: null, esAdmin: false, premios: [] };

  // ---------- Utilidades ----------
  const el = (etiqueta, clases, texto) => {
    const nodo = document.createElement(etiqueta);
    if (clases) nodo.className = clases;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  function icono(clave, clases = "h-5 w-5") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", clases);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const trazo = document.createElementNS(ns, "path");
    trazo.setAttribute("stroke-linecap", "round");
    trazo.setAttribute("stroke-linejoin", "round");
    trazo.setAttribute("d", ICONOS[clave]);
    svg.append(trazo);
    return svg;
  }

  function botonIcono(clave, etiqueta, clases) {
    const boton = el("button", `flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${clases}`);
    boton.type = "button";
    boton.setAttribute("aria-label", etiqueta);
    boton.append(icono(clave));
    return boton;
  }

  // Solo se muestran imágenes http(s); cualquier otra cosa (javascript:, data:) se ignora
  const urlSegura = (url) => (/^https?:\/\//i.test(url ?? "") ? url : null);
  const reducirMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Pintar ----------
  function pintarSaldo() {
    $("saldo").textContent = numero(estado.perfil.puntos);
    pintarMenu(estado.perfil);
  }

  function pintarNav() {
    $("nav-sectores").replaceChildren(
      ...SECTORES.map((s) => {
        const cuantos = estado.premios.filter((p) => p.sector === s.clave).length;
        const enlace = el("a", `flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-800 shadow-sm ring-1 ring-gray-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${s.chip}`);
        enlace.href = `#sector-${s.clave}`;
        const insignia = el("span", `flex h-7 w-7 items-center justify-center rounded-full ${s.color}`);
        insignia.append(icono(s.clave, "h-4 w-4"));
        enlace.append(insignia, s.nombre, el("span", "tabular-nums text-gray-500", String(cuantos)));
        const li = el("li");
        li.append(enlace);
        return li;
      })
    );
  }

  function tarjeta(premio, sector) {
    const saldo = estado.perfil.puntos;
    const agotado = premio.stock === 0;
    const donacion = premio.tipo === "donacion";

    const li = el("li", `relative flex w-[82%] shrink-0 snap-start flex-col overflow-hidden rounded-3xl bg-white shadow-sm transition hover:shadow-md sm:w-[calc((100%_-_1rem)/2)] lg:w-[calc((100%_-_2rem)/3)] ${donacion ? "ring-2 ring-eco-300" : "ring-1 ring-gray-100"} ${premio.activo ? "" : "opacity-60"}`);

    // Imagen o, si no hay, el icono del sector
    const portada = el("div", `relative flex h-36 items-center justify-center ${sector.color}`);
    const imagen = urlSegura(premio.imagen_url);
    if (imagen) {
      const img = el("img", "h-full w-full object-cover");
      img.src = imagen;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(icono(sector.clave, "h-14 w-14 opacity-70")));
      portada.append(img);
    } else {
      portada.append(icono(sector.clave, "h-14 w-14 opacity-70"));
    }

    const insignias = el("div", "absolute left-3 top-3 flex flex-wrap gap-1.5");
    if (donacion) insignias.append(el("span", "rounded-full bg-eco-700 px-2.5 py-1 text-xs font-bold text-white shadow", "Donación · impacto social"));
    if (!premio.activo) insignias.append(el("span", "rounded-full bg-gray-900 px-2.5 py-1 text-xs font-bold text-white shadow", "Pausado"));
    portada.append(insignias);

    if (estado.esAdmin) {
      const acciones = el("div", "absolute right-2 top-2 flex gap-1");
      const editar = botonIcono("editar", `Editar ${premio.nombre}`, "bg-white/90 text-gray-700 shadow hover:bg-white");
      const borrar = botonIcono("borrar", `Borrar ${premio.nombre}`, "bg-white/90 text-red-700 shadow hover:bg-white");
      editar.addEventListener("click", () => abrirFormulario(premio));
      borrar.addEventListener("click", () => borrarPremio(premio));
      acciones.append(editar, borrar);
      portada.append(acciones);
    }

    // Texto
    const cuerpo = el("div", "flex flex-1 flex-col p-5");
    cuerpo.append(el("h3", "text-lg font-bold leading-snug text-gray-900", premio.nombre));
    if (premio.descripcion) cuerpo.append(el("p", "mt-1 line-clamp-3 text-sm text-gray-500", premio.descripcion));

    const pie = el("div", "mt-auto flex items-baseline justify-between gap-2 pt-4");
    const costo = el("p", "text-2xl font-extrabold tabular-nums text-gray-900", numero(premio.costo));
    costo.append(el("span", "ml-1 text-sm font-semibold text-gray-500", "pts"));
    pie.append(costo);
    if (premio.stock != null) {
      pie.append(el("p", `text-sm font-semibold ${agotado ? "text-red-700" : "text-gray-500"}`, agotado ? "Agotado" : `Quedan ${numero(premio.stock)}`));
    }
    cuerpo.append(pie);

    const falta = premio.costo - saldo;
    const boton = el("button", "mt-4 min-h-[44px] w-full rounded-xl bg-eco-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-eco-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2 disabled:bg-gray-200 disabled:text-gray-600 disabled:shadow-none",
      !premio.activo ? "No disponible" : agotado ? "Agotado" : falta > 0 ? `Te faltan ${numero(falta)} pts` : donacion ? "Donar" : "Canjear");
    boton.type = "button";
    boton.disabled = !premio.activo || agotado || falta > 0;
    boton.addEventListener("click", () => canjear(premio, boton));
    cuerpo.append(boton);

    li.append(portada, cuerpo);
    return li;
  }

  // Botones anterior/siguiente: avanzan una "página" y se desactivan en los extremos
  function conectarCarrusel(pista, controles, anterior, siguiente) {
    const actualizar = () => {
      const maximo = pista.scrollWidth - pista.clientWidth;
      anterior.disabled = pista.scrollLeft <= 1;
      siguiente.disabled = pista.scrollLeft >= maximo - 1;
      controles.classList.toggle("md:flex", maximo > 1);
    };
    const mover = (direccion) => pista.scrollBy({ left: direccion * pista.clientWidth, behavior: reducirMovimiento() ? "auto" : "smooth" });

    anterior.addEventListener("click", () => mover(-1));
    siguiente.addEventListener("click", () => mover(1));
    pista.addEventListener("scroll", actualizar, { passive: true });
    new ResizeObserver(actualizar).observe(pista);
  }

  function seccion(sector) {
    const premios = estado.premios.filter((p) => p.sector === sector.clave).sort((a, b) => a.costo - b.costo);

    const nodo = el("section", "scroll-mt-20");
    nodo.id = `sector-${sector.clave}`;
    nodo.setAttribute("aria-labelledby", `titulo-${sector.clave}`);

    // Encabezado: nombre del sector y controles
    const cabecera = el("div", "mb-4 flex items-end justify-between gap-3");
    const titulo = el("div", "flex min-w-0 items-center gap-3");
    const insignia = el("span", `flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${sector.color}`);
    insignia.append(icono(sector.clave, "h-6 w-6"));
    const textos = el("div", "min-w-0");
    const h2 = el("h2", "text-2xl font-extrabold tracking-tight text-gray-900", sector.nombre);
    h2.id = `titulo-${sector.clave}`;
    textos.append(h2, el("p", "text-sm text-gray-500", sector.descripcion));
    titulo.append(insignia, textos);

    const derecha = el("div", "flex shrink-0 items-center gap-2");
    if (estado.esAdmin) {
      const agregar = botonIcono("agregar", `Agregar premio a ${sector.nombre}`, "bg-eco-600 text-white shadow-md hover:bg-eco-700");
      agregar.addEventListener("click", () => abrirFormulario(null, sector.clave));
      derecha.append(agregar);
    }
    const controles = el("div", "hidden gap-2");
    const anterior = botonIcono("anterior", `Premios anteriores de ${sector.nombre}`, "bg-white text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50");
    const siguiente = botonIcono("siguiente", `Más premios de ${sector.nombre}`, "bg-white text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50");
    controles.append(anterior, siguiente);
    derecha.append(controles);
    cabecera.append(titulo, derecha);
    nodo.append(cabecera);

    if (!premios.length) {
      nodo.append(el("p", "rounded-3xl border-2 border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500",
        estado.esAdmin ? "Aún no hay premios en este sector. Agrega el primero con el botón +." : "Pronto habrá premios en este sector."));
      return nodo;
    }

    // Pista del carrusel: en móvil ocupa todo el ancho y deja ver un pedazo de la siguiente tarjeta
    const pista = el("ul", "sin-barra -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0");
    pista.dataset.sector = sector.clave;
    pista.setAttribute("aria-label", `Premios de ${sector.nombre}`);
    pista.append(...premios.map((p) => tarjeta(p, sector)));
    nodo.append(pista);

    conectarCarrusel(pista, controles, anterior, siguiente);
    return nodo;
  }

  function pintarSectores() {
    // Conserva en qué parte de cada carrusel estaba el usuario
    const posiciones = new Map([...document.querySelectorAll("[data-sector]")].map((p) => [p.dataset.sector, p.scrollLeft]));
    $("sectores").replaceChildren(...SECTORES.map(seccion));
    for (const pista of document.querySelectorAll("[data-sector]")) {
      pista.scrollLeft = posiciones.get(pista.dataset.sector) ?? 0;
    }
    pintarNav();
  }

  // ---------- Diálogos ----------
  function confirmar({ titulo, texto, boton, peligro = false }) {
    const dialogo = $("dialog-confirmar");
    $("confirmar-titulo").textContent = titulo;
    $("confirmar-texto").textContent = texto;
    const aceptar = $("confirmar-boton");
    aceptar.textContent = boton;
    aceptar.className = `min-h-[44px] rounded-xl px-5 py-2.5 font-bold text-white shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${peligro ? "bg-red-700 hover:bg-red-800 focus-visible:ring-red-700" : "bg-eco-600 hover:bg-eco-700 focus-visible:ring-eco-600"}`;
    dialogo.returnValue = "";
    dialogo.showModal();
    return new Promise((resolver) => dialogo.addEventListener("close", () => resolver(dialogo.returnValue === "si"), { once: true }));
  }

  function mostrarCodigo(codigo, nombre) {
    $("codigo-premio").textContent = nombre;
    $("codigo-valor").textContent = codigo;
    $("dialog-codigo").showModal();
  }

  // ---------- Canjear ----------
  async function canjear(premio, boton) {
    const saldo = estado.perfil.puntos;
    const ok = await confirmar({
      titulo: premio.tipo === "donacion" ? "¿Donar tus puntos?" : "¿Canjear este premio?",
      texto: `«${premio.nombre}» cuesta ${numero(premio.costo)} puntos. Te quedarán ${numero(saldo - premio.costo)}.`,
      boton: premio.tipo === "donacion" ? "Donar" : "Canjear",
    });
    if (!ok) return;

    boton.disabled = true;
    let codigo;
    if (demo) {
      codigo = "BAS-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
      estado.perfil.puntos -= premio.costo;
    } else {
      const { data, error } = await db.rpc("canjear_premio", { p_premio_id: premio.id });
      if (error) {
        aviso(error.message, "error"); // la función manda los errores en español
        boton.disabled = false;
        return;
      }
      codigo = data.codigo;
      const { data: perfil } = await db.from("usuarios").select("puntos").eq("id", estado.uid).single();
      estado.perfil.puntos = perfil?.puntos ?? saldo - premio.costo;
    }
    if (premio.stock != null) premio.stock -= 1;

    pintarSaldo();
    pintarSectores();
    mostrarCodigo(codigo, premio.nombre);
  }

  // ---------- Administrar (crear, editar, borrar) ----------
  const formulario = $("form-premio");
  let editando = null; // premio que se edita, o null si es nuevo

  function errorFormulario(texto) {
    $("form-error").textContent = texto;
    $("form-error").classList.toggle("hidden", !texto);
  }

  function abrirFormulario(premio, sector = "propio") {
    editando = premio;
    formulario.reset();
    errorFormulario("");
    $("form-titulo").textContent = premio ? "Editar premio" : "Nuevo premio";
    const campos = formulario.elements;
    campos.nombre.value = premio?.nombre ?? "";
    campos.descripcion.value = premio?.descripcion ?? "";
    campos.sector.value = premio?.sector ?? sector;
    campos.tipo.value = premio?.tipo ?? "cupon";
    campos.costo.value = premio?.costo ?? "";
    campos.stock.value = premio?.stock ?? "";
    campos.imagen_url.value = premio?.imagen_url ?? "";
    campos.activo.checked = premio?.activo ?? true;
    $("dialog-premio").showModal();
    campos.nombre.focus();
  }

  // Devuelve la fila para Supabase o lanza un Error con el mensaje para el usuario
  function leerFormulario() {
    const campos = formulario.elements;
    const nombre = campos.nombre.value.trim();
    const costo = Number(campos.costo.value);
    const stock = campos.stock.value.trim() === "" ? null : Number(campos.stock.value);
    const imagen = campos.imagen_url.value.trim();

    if (!nombre) throw new Error("Escribe el nombre del premio.");
    if (!Number.isInteger(costo) || costo <= 0) throw new Error("El costo debe ser un número entero mayor que 0.");
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) throw new Error("El stock debe ser un número entero (0 o más) o quedar vacío para ilimitado.");
    if (imagen && !urlSegura(imagen)) throw new Error("La URL de la imagen debe empezar con http:// o https://.");

    return {
      nombre,
      descripcion: campos.descripcion.value.trim() || null,
      sector: campos.sector.value,
      tipo: campos.tipo.value,
      costo,
      stock,
      imagen_url: imagen || null,
      activo: campos.activo.checked,
    };
  }

  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();
    let fila;
    try {
      fila = leerFormulario();
    } catch (error) {
      errorFormulario(error.message);
      return;
    }

    const guardar = formulario.querySelector("button[type=submit]");
    guardar.disabled = true;
    try {
      let guardado;
      if (demo) {
        guardado = { ...(editando ?? { id: Date.now() }), ...fila };
      } else {
        // .select().single() confirma que la fila se escribió (si RLS lo impide, no llega ninguna)
        const consulta = editando ? db.from("premios").update(fila).eq("id", editando.id) : db.from("premios").insert(fila);
        const { data, error } = await consulta.select("*").single();
        if (error) {
          console.error("No se pudo guardar el premio:", error);
          errorFormulario("No se pudo guardar el premio. Revisa tu conexión y que tu cuenta sea de administrador.");
          return;
        }
        guardado = data;
      }

      const i = estado.premios.findIndex((p) => p.id === guardado.id);
      if (i >= 0) estado.premios[i] = guardado;
      else estado.premios.push(guardado);

      $("dialog-premio").close();
      pintarSectores();
      aviso(editando ? "Premio actualizado." : "Premio creado.", "exito");
    } finally {
      guardar.disabled = false;
    }
  });

  formulario.querySelector("[data-cerrar]").addEventListener("click", () => $("dialog-premio").close());

  async function borrarPremio(premio) {
    const ok = await confirmar({
      titulo: "¿Borrar este premio?",
      texto: `«${premio.nombre}» dejará de aparecer. Si alguien ya lo canjeó, se pausará en lugar de borrarse para conservar su historial.`,
      boton: "Borrar",
      peligro: true,
    });
    if (!ok) return;

    if (demo) {
      estado.premios = estado.premios.filter((p) => p.id !== premio.id);
      pintarSectores();
      aviso("Premio borrado.", "exito");
      return;
    }

    const { data, error } = await db.from("premios").delete().eq("id", premio.id).select("id");
    if (error?.code === "23503") {
      // Tiene canjes (on delete restrict): se pausa
      const { data: pausado, error: errorPausa } = await db.from("premios").update({ activo: false }).eq("id", premio.id).select("*").single();
      if (errorPausa) {
        console.error("No se pudo pausar el premio:", errorPausa);
        aviso("No se pudo borrar ni pausar el premio.", "error");
        return;
      }
      Object.assign(premio, pausado);
      pintarSectores();
      aviso("El premio ya tiene canjes: se pausó en lugar de borrarse.", "info");
      return;
    }
    if (error || !data?.length) {
      console.error("No se pudo borrar el premio:", error);
      aviso("No se pudo borrar el premio. Revisa tu conexión y que tu cuenta sea de administrador.", "error");
      return;
    }
    estado.premios = estado.premios.filter((p) => p.id !== premio.id);
    pintarSectores();
    aviso("Premio borrado.", "exito");
  }

  // ---------- Datos ----------
  async function cargar() {
    // Las políticas ya filtran: el usuario solo recibe los activos y el administrador todos
    let consulta = db.from("premios").select("id, nombre, descripcion, tipo, costo, stock, imagen_url, activo, sector").order("costo");
    if (!estado.esAdmin) consulta = consulta.eq("activo", true);
    const { data, error } = await consulta;
    if (error) throw error;
    estado.premios = data ?? [];
  }

  function datosDemo() {
    const filas = [
      ["Pase de transporte público", "10 viajes en el transporte público de la ciudad.", "cupon", 300, null, "gobierno"],
      ["Descuento en el predial", "5% de descuento en el pago anual del impuesto predial.", "cupon", 800, null, "gobierno"],
      ["Entrada a museos municipales", "Acceso gratuito a los museos y centros culturales del municipio.", "cupon", 200, null, "gobierno"],
      ["Un árbol plantado a tu nombre", "El municipio planta un árbol en un parque de tu colonia.", "donacion", 150, null, "gobierno"],
      ["Vale de despensa", "Vale de $100 para usar en la tienda de la empresa.", "cupon", 400, 50, "industria"],
      ["Comida en el comedor", "Una comida completa gratis en el comedor de la planta.", "cupon", 120, null, "industria"],
      ["Medio día libre", "Salida temprano un viernes, coordinada con tu supervisor.", "cupon", 1500, 10, "industria"],
      ["Donación a recicladores", "La empresa dona tus puntos a una cooperativa de recicladores.", "donacion", 100, null, "industria"],
      ["Impresiones gratis", "20 hojas de impresión en el centro de cómputo.", "cupon", 80, null, "educativo"],
      ["Café en la cafetería", "Un café o bebida caliente en la cafetería escolar.", "cupon", 100, null, "educativo"],
      ["Kit escolar reciclado", "Cuaderno y lápices hechos con material reciclado.", "cupon", 250, 0, "educativo"],
      ["Préstamo extendido", "Una semana extra en tu próximo préstamo de biblioteca.", "cupon", 60, null, "educativo"],
      ["Botella reutilizable Basurin", "Botella de acero inoxidable de 600 ml con el logo de Basurin.", "cupon", 400, 30, "propio"],
      ["Bolsa de tela Basurin", "Bolsa resistente para dejar las de plástico.", "cupon", 250, 50, "propio"],
      ["Playera Basurin", "Playera de algodón orgánico.", "cupon", 600, 20, "propio"],
      ["Donar a una cooperativa", "Tus puntos se convierten en apoyo para recicladores de la ciudad.", "donacion", 100, null, "propio"],
    ];
    estado.premios = filas.map(([nombre, descripcion, tipo, costo, stock, sector], i) => ({
      id: i + 1, nombre, descripcion, tipo, costo, stock, sector, imagen_url: null, activo: true,
    }));
  }

  // ---------- Arranque ----------
  $("form-premio").elements.sector.append(...SECTORES.map((s) => {
    const opcion = el("option", "", s.nombre);
    opcion.value = s.clave;
    return opcion;
  }));

  async function recargar() {
    try {
      await cargar();
      $("premios-error").classList.add("hidden");
      $("premios-error").classList.remove("flex");
      pintarSectores();
    } catch (e) {
      console.error("No se pudieron cargar los premios:", e);
      // 42703 = columna inexistente: la base es anterior a premios.sector
      $("premios-error-texto").textContent = e?.code === "42703"
        ? "A la tabla de premios le falta la columna «sector». Ejecuta supabase/premios_sectores.sql en el SQL Editor de Supabase."
        : "No pudimos cargar los premios. Revisa tu conexión e inténtalo de nuevo.";
      $("premios-error").classList.remove("hidden");
      $("premios-error").classList.add("flex");
      $("sectores").replaceChildren();
    } finally {
      $("premios").setAttribute("aria-busy", "false");
    }
  }

  const { sesion, perfil, esAdmin } = await listo;
  estado.uid = sesion.user.id;
  estado.perfil = perfil;
  estado.esAdmin = esAdmin;
  pintarSaldo();

  if (esAdmin) {
    $("barra-admin").classList.remove("hidden");
    $("barra-admin").classList.add("flex");
    $("btn-nuevo").addEventListener("click", () => abrirFormulario(null));
  }

  if (demo) {
    datosDemo();
    pintarSectores();
    $("premios").setAttribute("aria-busy", "false");
    return;
  }

  $("btn-reintentar").addEventListener("click", recargar);
  await recargar();
})();
