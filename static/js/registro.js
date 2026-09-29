const formRegistro = $("form-registro");

// Si ya hay sesión no tiene caso mostrar el registro
db.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = "/home";
});

// Supabase responde en inglés; traducimos los errores más comunes
const ERRORES = {
  user_already_exists: "Ya existe una cuenta con ese correo.",
  weak_password: "La contraseña debe tener al menos 6 caracteres.",
  email_address_invalid: "El correo no es válido.",
  over_email_send_rate_limit: "Demasiados intentos. Espera unos minutos.",
  over_request_rate_limit: "Demasiados intentos. Espera unos minutos.",
};

formRegistro.addEventListener("submit", (e) => {
  e.preventDefault();
  const datos = new FormData(formRegistro);

  conBotonOcupado(formRegistro, async () => {
    const { data, error } = await db.auth.signUp({
      email: datos.get("correo"),
      password: datos.get("contrasena"),
      // El trigger crear_usuario() toma este nombre para la tabla usuarios
      options: { data: { nombre: datos.get("nombre").trim() } },
    });
    if (error) {
      mostrarMensaje(ERRORES[error.code] ?? "No se pudo crear la cuenta. Intenta de nuevo.", "error");
      return;
    }
    if (data.session) {
      window.location.href = "/home";
    } else {
      // Por si se vuelve a activar la confirmación por correo en Supabase
      formRegistro.reset();
      mostrarMensaje("Cuenta creada. Revisa tu correo para confirmarla.", "exito");
    }
  });
});
