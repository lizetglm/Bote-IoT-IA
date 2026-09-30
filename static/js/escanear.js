// Pantalla Escanear QR (/escanear y /v/<id>): vincula la cuenta con un bote y muestra la sesión activa.
//
// FLUJO
//  1. El QR del bote lleva su id: el número solo ("12") o una URL /v/12 (así también lo abre la cámara del celular,
//     que llega a /v/<id> con window.BOTE_ID). El botón "Abrir cámara" abre la app de cámara del celular
//     (<input capture>) y la foto se lee aquí: funciona sin https. Con https o en localhost también se ofrece
//     escanear en vivo dentro de la página. Sin cámara se puede escribir el número (accesibilidad).
//  2. POST /api/vincular { bote_id } con el token de Supabase. El servidor comprueba que el bote esté activo, cierra
//     la sesión que tuviera ese bote (el último que escanea se queda con él) y crea la del usuario.
//  3. Sesión activa: bote, ubicación, cuenta regresiva y depósitos de esta sesión en vivo. Termina:
//      - con el botón "Terminar sesión" (RLS deja al usuario borrar su propia fila de sesiones_activas),
//      - si otra persona escanea el mismo bote (la fila desaparece: se detecta revisando cada pocos segundos),
//      - a los MINUTOS_SESION sin actividad; cada depósito reinicia el tiempo (actividad_en; el servidor lo
//        actualiza y lo hace cumplir en camara_web.py, aquí solo se muestra y se cierra al llegar a cero).
//
// El escáner en vivo (getUserMedia) solo funciona con HTTPS o en localhost (python app.py ya arranca con https);
// la foto funciona siempre. Con ?demo=1 (solo Flask en debug) no toca Supabase.

(async () => {
  const { db, demo, listo, aviso, material, numero, hace } = Basurin;
  const $ = (id) => document.getElementById(id);

  const MINUTOS_SESION = 5;                  // igual que MINUTOS_SESION en camara_web.py
  const DURACION = MINUTOS_SESION * 60000;
  const LADO_FOTO = 1280;                    // px: las fotos del celular se achican antes de buscar el QR
  const REVISION = 5000;                     // ms entre revisiones de que la sesión sigue siendo nuestra

  const TEXTOS_FIN = {
    usuario: "Terminaste la sesión. Escanea otro bote cuando quieras volver a reciclar.",
    tiempo: `La sesión se cerró porque pasaron ${MINUTOS_SESION} minutos sin depósitos.`,
    reemplazada: "Tu sesión terminó: alguien más escaneó el bote o se cerró desde otro dispositivo.",
  };

  const BOTES_DEMO = {
    1: { id: 1, ubicacion: "Edificio Central", latitud: 20.6596, longitud: -103.3496, estatus: "activo" },
    2: { id: 2, ubicacion: "Cafetería Norte", latitud: 20.6605, longitud: -103.351, estatus: "lleno" },
    3: { id: 3, ubicacion: "Biblioteca", latitud: 20.658, longitud: -103.348, estatus: "mantenimiento" },
  };

  const estado = {
    uid: null,
    sesion: null,      // { id, bote_id, iniciada_en, actividad_en }
    bote: null,        // { id, ubicacion, latitud, longitud, estatus }
    depositos: [],
    desfase: 0,        // ms que el reloj del servidor va por delante del de este dispositivo
    lector: null,      // escáner en vivo
    lectorFoto: null,  // lee el QR de una foto
    ocupado: false,    // vinculando: no leer otro QR mientras tanto
    ultimoInvalido: null,
    reloj: null,
    revision: null,
    terminando: false,
  };

  const el = (etiqueta, clases, texto) => {
    const nodo = document.createElement(etiqueta);
    if (clases) nodo.className = clases;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  // Mostrar/ocultar un nodo que usa flex cuando se ve
  function ver(nodo, visible, display = "flex") {
    nodo.classList.toggle("hidden", !visible);
    nodo.classList.toggle(display, visible);
  }

  const ahora = () => Date.now() + estado.desfase;

  // "12", "/v/12", "https://.../v/12?t=...", "...?bote=12" o "bote:12" -> 12
  function idDeCodigo(texto) {
    const t = String(texto ?? "").normalize("NFKC").trim();
    // En una URL /v/<id> o ?bote=<id> manda ese número (la IP y el puerto también son números)
    const m = t.match(/\/v\/(\d{1,9})(?:[/?#]|$)/) || t.match(/[?&]bote(?:_id)?=(\d{1,9})(?:&|#|$)/i);
    if (m) return Number(m[1]) || null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null; // otra URL: sus números no son de un bote
    // Cualquier otro texto: el último número que traiga ("7", "Bote 7", "ID: 7", {"bote_id": 7}…)
    const numeros = t.match(/\d{1,9}/g);
    return numeros ? Number(numeros[numeros.length - 1]) || null : null;
  }

  // ---------- Mensajes de la vista del escáner ----------
  function mostrarError(texto, reintentar) {
    $("escaner-error-texto").textContent = texto;
    ver($("escaner-error"), true);
    $("btn-reintentar").classList.toggle("hidden", !reintentar);
    $("btn-reintentar").onclick = reintentar ?? null;
  }

  function ocultarError() {
    ver($("escaner-error"), false);
  }

  function mostrarFin(texto) {
    $("aviso-fin-texto").textContent = texto;
    ver($("aviso-fin"), Boolean(texto));
  }

  // ---------- Cámara ----------
  const puedeEnVivo = () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  const TEXTO_INICIAL = puedeEnVivo()
    ? "Apunta la cámara al código QR del bote."
    : "Toma una foto del código QR del bote. Para escanearlo en vivo abre la página con https://";
  // BarcodeDetector del navegador (Android/Chrome) cuando existe: lee QR mucho mejor que la librería sola
  const CONFIG_LECTOR = { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };

  // texto null = escaneando en vivo (se ve el video con el marco guía).
  // Con https el botón principal es el escáner en vivo y la foto queda como alternativa; sin https, solo la foto.
  function estadoCamara(texto = TEXTO_INICIAL) {
    const escaneando = texto === null;
    const enVivo = puedeEnVivo();
    ver($("camara-estado"), !escaneando);
    ver($("marco-guia"), escaneando);
    if (!escaneando) $("camara-estado-texto").textContent = texto;
    ver($("btn-camara"), !escaneando && enVivo, "inline-flex");
    ver($("btn-foto-alt"), !escaneando && enVivo, "inline-flex");
    ver($("btn-foto"), !escaneando && !enVivo, "inline-flex");
  }

  function motivoSinCamara(e) {
    const texto = String(e?.name ?? e ?? "");
    if (/NotAllowed|Permission/i.test(texto)) {
      return "No diste permiso para usar la cámara en vivo. Dale permiso en los ajustes del navegador o toma una foto del QR.";
    }
    if (/NotFound|Overconstrained|DevicesNotFound/i.test(texto)) {
      return "No encontramos una cámara en este dispositivo. Abre esta página en tu celular o escribe el número del bote abajo.";
    }
    if (/NotReadable|TrackStart|in use/i.test(texto)) {
      return "La cámara está ocupada por otra aplicación. Ciérrala o toma una foto del QR.";
    }
    return "No pudimos abrir la cámara en vivo. Toma una foto del QR o escribe el número del bote abajo.";
  }

  async function encenderCamara() {
    if (estado.sesion || estado.lector?.isScanning || !puedeEnVivo()) return;
    if (!window.Html5Qrcode) {
      mostrarError("No se pudo cargar el lector de códigos QR. Revisa tu conexión y recarga la página.");
      return;
    }

    estadoCamara("Pidiendo permiso para usar la cámara…");
    estado.lector ??= new Html5Qrcode("lector", CONFIG_LECTOR);
    try {
      await estado.lector.start({ facingMode: "environment" }, { fps: 10, aspectRatio: 1 }, (texto) => alLeerQR(texto), () => {});
      estadoCamara(null);
    } catch (e) {
      console.warn("No se pudo abrir la cámara:", e);
      estadoCamara(motivoSinCamara(e));
    }
  }

  async function apagarCamara(texto) {
    if (estado.lector?.isScanning) {
      try {
        await estado.lector.stop();
      } catch (e) {
        console.warn("No se pudo apagar la cámara:", e);
      }
    }
    estadoCamara(texto);
  }

  // Las fotos del celular pesan varios MB: se achican para que el lector sea rápido y no se quede sin memoria
  async function achicar(archivo) {
    const imagen = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_FOTO / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    imagen.close();
    const blob = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.9));
    return new File([blob], "qr.jpg", { type: "image/jpeg" });
  }

  async function leerFoto(archivo) {
    if (!archivo || estado.ocupado || estado.sesion) return;
    if (!window.Html5Qrcode) {
      mostrarError("No se pudo cargar el lector de códigos QR. Revisa tu conexión y recarga la página.");
      return;
    }
    ocultarError();
    mostrarFin(null);
    await apagarCamara("Buscando el código en la foto…");

    let texto;
    try {
      estado.lectorFoto ??= new Html5Qrcode("lector-foto", CONFIG_LECTOR);
      texto = await estado.lectorFoto.scanFile(await achicar(archivo).catch(() => archivo), false);
    } catch (e) {
      console.warn("No se encontró un QR en la foto:", e);
      estadoCamara();
      mostrarError("No encontramos un código QR en la foto. Acércate, que el QR se vea completo y con buena luz, y vuelve a intentarlo.");
      return;
    }
    estadoCamara();
    alLeerQR(texto, true);
  }

  function alLeerQR(texto, deFoto = false) {
    if (estado.ocupado || estado.sesion) return;
    const boteId = idDeCodigo(texto);
    if (!boteId) {
      // En vivo se lee el mismo QR muchas veces por segundo: avisar solo una vez por código
      if (deFoto || estado.ultimoInvalido !== texto) {
        estado.ultimoInvalido = texto;
        const leido = String(texto ?? "").trim();
        console.warn("QR sin número de bote:", leido);
        mostrarError(`El QR dice «${leido.length > 80 ? `${leido.slice(0, 80)}…` : leido}», pero no trae el número de un bote.`);
      }
      return;
    }
    vincular(boteId);
  }

  // ---------- Vincular ----------
  async function pedirVinculo(boteId) {
    if (demo) {
      await new Promise((r) => setTimeout(r, 700));
      const bote = BOTES_DEMO[boteId];
      if (!bote) throw new Error(`No existe el bote número ${boteId}. Revisa el código.`);
      if (bote.estatus !== "activo") throw new Error(`Este bote está ${bote.estatus === "lleno" ? "lleno" : "en mantenimiento"}. Busca otro cercano en el mapa.`);
      const iso = new Date().toISOString();
      return { sesion: { id: Date.now(), bote_id: boteId, iniciada_en: iso, actividad_en: iso }, bote };
    }

    // getSession renueva el token si ya venció
    const { data } = await db.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Tu sesión venció. Vuelve a iniciar sesión.");

    let respuesta;
    try {
      respuesta = await fetch("/api/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bote_id: boteId }),
      });
    } catch {
      throw new Error("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
    }
    medirDesfase(respuesta);
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(cuerpo.error || "No pudimos conectar con el bote. Inténtalo de nuevo.");
    return cuerpo;
  }

  async function vincular(boteId) {
    if (estado.ocupado) return;
    estado.ocupado = true;
    ocultarError();
    mostrarFin(null);
    ver($("validando"), true);
    await apagarCamara("Conectando con el bote…");

    try {
      const { sesion, bote } = await pedirVinculo(boteId);
      activar(sesion, bote);
      aviso(`¡Listo! Estás conectado al bote de ${bote.ubicacion}.`, "exito");
    } catch (e) {
      console.warn("No se pudo vincular:", e);
      mostrarError(e.message, () => vincular(boteId));
      estadoCamara();
    } finally {
      estado.ocupado = false;
      estado.ultimoInvalido = null;
      ver($("validando"), false);
    }
  }

  // ---------- Sesión activa ----------
  function activar(sesion, bote) {
    estado.sesion = sesion;
    estado.bote = bote;
    estado.depositos = [];

    $("bote-numero").textContent = `Bote #${bote.id}`;
    $("bote-nombre").textContent = bote.ubicacion;
    if (bote.latitud != null && bote.longitud != null) {
      $("bote-mapa").href = `https://www.google.com/maps?q=${bote.latitud},${bote.longitud}`;
    }

    pintarDepositos();
    pintarReloj();
    ver($("vista-escaner"), false, "block");
    ver($("vista-activa"), true, "block");

    clearInterval(estado.reloj);
    estado.reloj = setInterval(pintarReloj, 1000);
    clearInterval(estado.revision);
    if (!demo) {
      estado.revision = setInterval(() => !document.hidden && revisar(), REVISION);
      cargarDepositos();
    }
  }

  function volverAlEscaner(motivo) {
    clearInterval(estado.reloj);
    clearInterval(estado.revision);
    estado.sesion = null;
    estado.bote = null;
    ver($("vista-activa"), false, "block");
    ver($("vista-escaner"), true, "block");
    mostrarFin(TEXTOS_FIN[motivo] ?? null);
    estadoCamara();
    $(puedeEnVivo() ? "btn-camara" : "btn-foto").focus();
  }

  async function terminar(motivo) {
    const sesion = estado.sesion;
    if (!sesion || estado.terminando) return;
    estado.terminando = true;
    $("btn-terminar").disabled = true;

    try {
      if (motivo !== "reemplazada" && !demo) {
        // Por id: si en otra pestaña ya se abrió otra sesión, esa no se toca
        const { error } = await db.from("sesiones_activas").delete().eq("id", sesion.id).eq("usuario_id", estado.uid);
        if (error) {
          console.warn("No se pudo cerrar la sesión:", error);
          if (motivo === "usuario") {
            aviso("No pudimos terminar la sesión. Revisa tu conexión e inténtalo de nuevo.", "error");
            return;
          }
        }
      }
      if (estado.sesion === sesion) volverAlEscaner(motivo);
    } finally {
      estado.terminando = false;
      $("btn-terminar").disabled = false;
    }
  }

  function restanteMs() {
    return new Date(estado.sesion.actividad_en).getTime() + DURACION - ahora();
  }

  function pintarReloj() {
    if (!estado.sesion) return;
    const restante = Math.max(0, restanteMs());
    const segundos = Math.ceil(restante / 1000);
    const porcentaje = Math.round((restante / DURACION) * 100);

    $("contador").textContent = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
    $("contador").classList.toggle("text-red-700", segundos <= 60);
    $("contador-progreso").setAttribute("aria-valuenow", porcentaje);
    $("contador-barra").style.width = `${porcentaje}%`;
    $("contador-barra").classList.toggle("bg-red-600", segundos <= 60);
    $("contador-barra").classList.toggle("bg-eco-600", segundos > 60);
    if (segundos === 60 || segundos === 15) {
      $("contador-aviso").textContent = `Quedan ${segundos} segundos de sesión.`;
    }

    if (restante <= 0) terminar("tiempo");
  }

  // ---------- Depósitos de la sesión ----------
  function pintarDepositos() {
    const lista = estado.depositos;
    $("depositos-vacio").classList.toggle("hidden", lista.length > 0);
    $("sesion-puntos").textContent = numero(lista.reduce((t, d) => t + (d.puntos ?? 0), 0));
    $("lista-depositos").replaceChildren(
      ...lista.map((d) => {
        const m = material(d.material);
        const punto = el("span", `h-3 w-3 shrink-0 rounded-full ${m.punto}`);
        punto.setAttribute("aria-hidden", "true");
        const textos = el("div", "min-w-0 flex-1");
        textos.append(el("p", "truncate text-sm font-semibold text-gray-800", m.etiqueta), el("p", "text-xs text-gray-500", hace(d.fecha)));
        const fila = el("li", "flex items-center gap-3 py-3");
        fila.append(punto, textos, el("span", "shrink-0 text-sm font-bold tabular-nums text-eco-700", `+${numero(d.puntos)} pts`));
        return fila;
      })
    );
  }

  async function cargarDepositos() {
    const sesion = estado.sesion;
    // OJO: el .eq("usuario_id") es obligatorio; un administrador vería los depósitos de todos
    const { data, error } = await db
      .from("transacciones")
      .select("id, material, puntos, fecha, bote_id")
      .eq("usuario_id", estado.uid)
      .eq("bote_id", sesion.bote_id)
      .gte("fecha", sesion.iniciada_en)
      .order("fecha", { ascending: false });
    if (error) return console.warn("No se pudieron leer los depósitos:", error);
    if (estado.sesion !== sesion) return;
    estado.depositos = data ?? [];
    pintarDepositos();
  }

  function agregarDeposito(fila) {
    const sesion = estado.sesion;
    if (!sesion || fila.bote_id !== sesion.bote_id || estado.depositos.some((d) => d.id === fila.id)) return;
    estado.depositos.unshift(fila);
    // El servidor reinicia actividad_en con cada depósito; aquí se adelanta para no esperar a la revisión
    if (new Date(fila.fecha) > new Date(sesion.actividad_en)) sesion.actividad_en = fila.fecha;
    pintarDepositos();
    pintarReloj();
    aviso(`+${numero(fila.puntos)} puntos · ${material(fila.material).etiqueta}`, "exito");
  }

  // ---------- Revisar que la sesión siga siendo nuestra ----------
  async function leerSesion() {
    const { data, error } = await db
      .from("sesiones_activas")
      .select("id, bote_id, iniciada_en, actividad_en")
      .eq("usuario_id", estado.uid)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function leerBote(id) {
    const { data, error } = await db.from("botes").select("id, ubicacion, latitud, longitud, estatus").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  async function revisar() {
    const sesion = estado.sesion;
    if (!sesion || estado.terminando) return;
    try {
      const actual = await leerSesion();
      if (estado.sesion !== sesion) return;
      if (!actual) return terminar("reemplazada");
      if (actual.id !== sesion.id) {
        // Se vinculó a otro bote desde otra pestaña o dispositivo: mostrar ese
        activar(actual, await leerBote(actual.bote_id));
        return;
      }
      sesion.actividad_en = actual.actividad_en;
      pintarReloj();
      cargarDepositos();
    } catch (e) {
      console.warn("No se pudo revisar la sesión:", e);
    }
  }

  function suscribir() {
    db.channel(`escanear-${estado.uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transacciones", filter: `usuario_id=eq.${estado.uid}` },
        ({ new: fila }) => agregarDeposito(fila))
      .subscribe();
  }

  // El reloj del celular puede ir adelantado o atrasado: se compara con la hora del servidor (cabecera Date)
  function medirDesfase(respuesta) {
    const fecha = Date.parse(respuesta?.headers.get("Date") ?? "");
    if (!Number.isNaN(fecha)) estado.desfase = fecha - Date.now() + 500; // Date viene en segundos enteros
  }

  // ---------- Arranque ----------
  $("btn-camara").addEventListener("click", () => {
    mostrarFin(null);
    ocultarError();
    encenderCamara();
  });

  $("foto-qr").addEventListener("change", (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // para poder elegir la misma foto otra vez
    leerFoto(archivo);
  });

  // Los <label> hacen de botón: también con Enter y Espacio desde el teclado
  for (const id of ["btn-foto", "btn-foto-alt"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("foto-qr").click();
      }
    });
  }

  $("form-codigo").addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = $("codigo-bote");
    const boteId = idDeCodigo(campo.value);
    if (!boteId) {
      mostrarError("Escribe el número del bote (solo dígitos, está debajo del QR).");
      campo.focus();
      return;
    }
    campo.value = "";
    vincular(boteId);
  });

  $("btn-terminar").addEventListener("click", () => terminar("usuario"));

  document.addEventListener("visibilitychange", () => !document.hidden && revisar());
  window.addEventListener("pagehide", () => estado.lector?.isScanning && estado.lector.stop().catch(() => {}));

  try {
    const { sesion } = await listo;
    estado.uid = sesion.user.id;
    const boteId = window.BOTE_ID;

    // Tras llegar por /v/<id> la URL pasa a /escanear: recargar la página no vuelve a vincular
    if (boteId) {
      const params = new URLSearchParams(location.search);
      params.delete("t");
      history.replaceState(null, "", `/escanear${params.size ? `?${params}` : ""}`);
    }

    if (demo) {
      $("btn-demo-deposito").classList.remove("hidden");
      $("btn-demo-deposito").addEventListener("click", () => {
        const [nombre, puntos] = [["Plastico", 8], ["Metal", 12], ["Vidrio", 10], ["Papel_Carton", 6], ["Organico", 5]][Math.floor(Math.random() * 5)];
        agregarDeposito({ id: Date.now(), material: nombre, puntos, fecha: new Date().toISOString(), bote_id: estado.sesion?.bote_id });
      });
    } else {
      medirDesfase(await fetch(location.pathname, { method: "HEAD" }).catch(() => null));
      suscribir();
    }

    if (boteId) {
      vincular(boteId);
    } else {
      const actual = demo ? null : await leerSesion().catch(() => null);
      if (actual && new Date(actual.actividad_en).getTime() + DURACION > ahora()) {
        activar(actual, await leerBote(actual.bote_id));
      } else {
        // Una sesión vencida que nadie cerró: se borra para no dejarla colgada
        if (actual) await db.from("sesiones_activas").delete().eq("id", actual.id).eq("usuario_id", estado.uid);
        puedeEnVivo() ? encenderCamara() : estadoCamara();
      }
    }
  } catch (e) {
    console.error(e);
    mostrarError("No pudimos iniciar la pantalla. Revisa tu conexión e inténtalo de nuevo.", () => location.reload());
  } finally {
    $("escanear").setAttribute("aria-busy", "false");
  }
})();
