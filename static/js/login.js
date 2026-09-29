const formIngresar = $("form-ingresar");

// Adónde ir al ingresar: la pantalla que se quiso abrir (?next=/premios) o la home.
// Solo se aceptan rutas internas, para que nadie pueda mandar al usuario a otro sitio.
function destino() {
  const next = new URLSearchParams(location.search).get("next");
  const interna = next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\");
  return interna ? next : "/home";
}

// Si ya hay sesión no tiene caso mostrar el login
db.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = destino();
});

formIngresar.addEventListener("submit", (e) => {
  e.preventDefault();
  const datos = new FormData(formIngresar);

  conBotonOcupado(formIngresar, async () => {
    const { error } = await db.auth.signInWithPassword({
      email: datos.get("correo"),
      password: datos.get("contrasena"),
    });
    if (error) {
      mostrarMensaje("Correo o contraseña incorrectos.", "error");
      return;
    }
    window.location.href = destino();
  });
});
