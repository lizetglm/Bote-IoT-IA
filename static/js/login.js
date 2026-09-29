const formIngresar = $("form-ingresar");

// Si ya hay sesión no tiene caso mostrar el login
db.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "/";
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
    window.location.href = "/";
  });
});
