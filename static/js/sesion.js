// Se carga en todas las páginas: crea el cliente de Supabase y pinta el nav.

// Se llama "db" porque la librería ya ocupa la variable global "supabase".
const { url, anonKey } = window.SUPABASE_CONFIG;
const db = window.supabase.createClient(url, anonKey);

const $ = (id) => document.getElementById(id);

// ---------- Utilidades para los formularios de login y registro ----------
function mostrarMensaje(texto, tipo = "") {
  const mensaje = $("mensaje");
  mensaje.textContent = texto;
  mensaje.className = "mensaje " + tipo;
}

// Deshabilita el botón mientras se espera a Supabase
async function conBotonOcupado(form, tarea) {
  const boton = form.querySelector("button[type=submit]");
  boton.disabled = true;
  try {
    await tarea();
  } finally {
    boton.disabled = false;
  }
}

// ---------- Nav ----------
$("btn-salir").addEventListener("click", async () => {
  await db.auth.signOut();
  window.location.href = "/";
});

async function pintarUsuario(sesion) {
  const conSesion = Boolean(sesion);
  $("nav-invitado").classList.toggle("oculto", conSesion);
  $("nav-usuario").classList.toggle("oculto", !conSesion);
  if (!conSesion) return;

  const { data: usuario } = await db
    .from("usuarios")
    .select("nombre, puntos")
    .eq("id", sesion.user.id)
    .single();

  $("usuario-nombre").textContent = usuario?.nombre ?? sesion.user.email;
  $("usuario-puntos").textContent = usuario?.puntos ?? 0;
}

// Se dispara al cargar la página (sesión guardada), al ingresar y al salir.
// El setTimeout evita consultar Supabase dentro del callback de auth,
// que puede bloquear el cliente.
db.auth.onAuthStateChange((_evento, sesion) => {
  setTimeout(() => pintarUsuario(sesion), 0);
});
