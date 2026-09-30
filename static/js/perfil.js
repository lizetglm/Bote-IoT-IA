// PANTALLA: Mi perfil (/perfil)                                         ESTADO: LISTO
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.

(async () => {
  const { db, demo, listo, aviso, material } = Basurin;
  const { sesion, perfil, esAdmin } = await listo;
  const uid = sesion.user.id;

  // --- REFERENCIAS AL DOM ---
  const inputNombre = document.getElementById('input-nombre');
  const inputCorreo = document.getElementById('input-correo');
  const infoPuntos = document.getElementById('info-puntos');
  const infoRegistro = document.getElementById('info-registro');
  const badgeAdmin = document.getElementById('badge-admin');
  const formPerfil = document.getElementById('form-perfil');
  const btnGuardar = document.getElementById('btn-guardar');

  const listaHistorial = document.getElementById('lista-historial');
  const divCargando = document.getElementById('historial-cargando');
  const divVacio = document.getElementById('historial-vacio');
  const btnMas = document.getElementById('btn-mas');

  // Quitar el estado de carga general de la vista
  document.getElementById('perfil-vista').removeAttribute('aria-busy');

  // --- 1. LLENAR DATOS DEL PERFIL ---
  inputNombre.value = perfil.nombre || '';
  inputCorreo.value = sesion.user.email;
  infoPuntos.textContent = perfil.puntos || 0;
  
  if (esAdmin) badgeAdmin.classList.remove('hidden');

  // Formatear la fecha de registro (ej. "14 de oct, 2026")
  if (perfil.creado_en) {
    const fechaReg = new Date(perfil.creado_en);
    infoRegistro.textContent = fechaReg.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // --- 2. EDITAR NOMBRE ---
  formPerfil.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nuevoNombre = inputNombre.value.trim();

    if (nuevoNombre.length < 1 || nuevoNombre.length > 60) {
      aviso("El nombre debe tener entre 1 y 60 caracteres.", "error");
      return;
    }

    if (nuevoNombre === perfil.nombre) return; // No hay cambios reales

    btnGuardar.disabled = true;
    const txtOriginal = btnGuardar.textContent;
    btnGuardar.textContent = "Guardando...";

    try {
      if (!demo) {
        // Solo enviamos el campo `nombre`. Supabase rechazará otros campos.
        const { error } = await db.from("usuarios").update({ nombre: nuevoNombre }).eq("id", uid);
        if (error) throw error;
      }
      
      // Éxito: Actualizar memoria local y menú superior
      perfil.nombre = nuevoNombre;
      Basurin.pintarMenu({ ...perfil, nombre: nuevoNombre });
      
      aviso("Perfil actualizado correctamente.", "exito");
    } catch (err) {
      console.error(err);
      aviso("Error al guardar. Intenta de nuevo.", "error");
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = txtOriginal;
    }
  });

  // --- 3. HISTORIAL DE DEPÓSITOS (Paginado) ---
  let paginaActual = 0;
  const LIMITE = 20;

  async function cargarHistorial() {
    btnMas.classList.add('hidden');
    if (paginaActual === 0) divCargando.classList.remove('hidden');

    try {
      let datosHistorial = [];
      
      if (demo) {
        // Mock de datos para prueba
        datosHistorial = paginaActual === 0 ? [
          { id: '1', material: 'plastico', puntos: 10, fecha: new Date().toISOString(), bote_id: 'bote-001' },
          { id: '2', material: 'metal', puntos: 15, fecha: new Date(Date.now() - 86400000).toISOString(), bote_id: 'bote-002' }
        ] : [];
      } else {
        const rangoInicio = paginaActual * LIMITE;
        const rangoFin = rangoInicio + (LIMITE - 1);
        
        // REGLA: OJO: .eq("usuario_id", uid) es obligatorio.
        const { data, error } = await db.from("transacciones")
          .select("id, material, puntos, fecha, bote_id")
          .eq("usuario_id", uid)
          .order("fecha", { ascending: false })
          .range(rangoInicio, rangoFin);
        
        if (error) throw error;
        datosHistorial = data || [];
      }

      if (paginaActual === 0 && datosHistorial.length === 0) {
        divVacio.classList.remove('hidden');
      } else {
        renderizarHistorial(datosHistorial);
        // Si llegaron exactamente el número de límite, es probable que haya más páginas
        if (datosHistorial.length === LIMITE) {
          btnMas.classList.remove('hidden');
        }
      }
    } catch (err) {
      console.error(err);
      if (paginaActual === 0) aviso("No se pudo cargar el historial.", "error");
    } finally {
      divCargando.classList.add('hidden');
    }
  }

  // Creación segura del DOM para el Historial (Evitando XSS con textContent)
  function renderizarHistorial(items) {
    items.forEach(item => {
      const fechaFormat = new Date(item.fecha).toLocaleString('es-MX', { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
      });
      
      // Basurin.material() retorna { etiqueta, punto, chip }
      const matInfo = typeof material === 'function' ? material(item.material) : 
                      { etiqueta: item.material, chip: 'bg-gray-100 text-gray-700 border-gray-200' };

      const li = document.createElement('li');
      li.className = "flex items-center justify-between rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100 transition hover:bg-white hover:shadow-sm";
      
      // Contenedor izquierdo: Datos y Material
      const divIzq = document.createElement('div');
      
      const spanMaterial = document.createElement('span');
      // La clase chip ya trae los colores, agregamos algo de padding y bordes.
      spanMaterial.className = `inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${matInfo.chip}`;
      spanMaterial.textContent = matInfo.etiqueta || item.material;
      
      const pBote = document.createElement('p');
      pBote.className = "mt-1.5 text-xs font-medium text-gray-500";
      pBote.textContent = `Bote: ${item.bote_id} · ${fechaFormat}`;
      
      divIzq.appendChild(spanMaterial);
      divIzq.appendChild(pBote);

      // Contenedor derecho: Puntos
      const divDer = document.createElement('div');
      divDer.className = "text-right";
      
      const pPuntos = document.createElement('p');
      pPuntos.className = "text-lg font-extrabold text-eco-600";
      pPuntos.textContent = `+${item.puntos}`;
      
      divDer.appendChild(pPuntos);

      // Ensamblar
      li.appendChild(divIzq);
      li.appendChild(divDer);
      
      listaHistorial.appendChild(li);
    });
  }

  // Paginación manual
  btnMas.addEventListener('click', () => {
    paginaActual++;
    btnMas.textContent = "Cargando...";
    btnMas.disabled = true;
    cargarHistorial().finally(() => {
      btnMas.textContent = "Ver más";
      btnMas.disabled = false;
    });
  });

  // Ejecución inicial
  await cargarHistorial();

})();