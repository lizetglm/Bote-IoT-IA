// PANTALLA: Ubicaciones de botes (/mapa)                                  ESTADO: LISTO
// Plantilla: templates/mapa.html (extiende base_app.html).
// Contexto compartido y reglas de seguridad: lee la cabecera de static/js/app.js.

(async () => {
  const { db, demo, listo } = Basurin;
  const { sesion, perfil, esAdmin } = await listo;

  // Referencias al DOM
  const contenedorLista = document.getElementById('lista-botes');
  const btnCerca = document.getElementById('btn-cerca');
  const checkDisponibles = document.getElementById('filtro-disponibles');
  const divCargando = document.getElementById('estado-cargando');
  const divVacio = document.getElementById('estado-vacio');
  const divError = document.getElementById('mapa-error');
  const btnReintentar = document.getElementById('btn-reintentar');

  // Variables de estado
  let botes = [];
  let miUbicacion = null;
  let marcadores = L.layerGroup();
  let marcadorUsuario = null;

  // Configuración de UI según estatus (Heredando tu lenguaje de diseño)
  const COLORES_ESTATUS = {
    'activo': { color: 'text-green-700', bg: 'bg-green-100', ring: 'ring-green-600/20', fill: '#15803d', label: 'Disponible' },
    'lleno': { color: 'text-red-700', bg: 'bg-red-100', ring: 'ring-red-600/20', fill: '#b91c1c', label: 'Lleno' },
    'mantenimiento': { color: 'text-amber-700', bg: 'bg-amber-100', ring: 'ring-amber-600/20', fill: '#b45309', label: 'Mantenimiento' },
    'inactivo': { color: 'text-gray-700', bg: 'bg-gray-100', ring: 'ring-gray-500/20', fill: '#4b5563', label: 'Inactivo' }
  };

  // Inicializar Leaflet
  const mapa = L.map('mapa-leaflet', { zoomControl: false }).setView([23.6345, -102.5528], 5); // Centro de México por defecto
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapa);
  marcadores.addTo(mapa);

  // --- LÓGICA DE DATOS ---

  async function fetchBotes() {
    try {
      if (demo) {
        botes = [
          { id: '1', ubicacion: 'Edificio Central', latitud: 20.6596, longitud: -103.3496, estatus: 'activo' },
          { id: '2', ubicacion: 'Cafetería Norte', latitud: 20.6605, longitud: -103.3510, estatus: 'lleno' },
          { id: '3', ubicacion: 'Biblioteca', latitud: 20.6580, longitud: -103.3480, estatus: 'mantenimiento' }
        ];
      } else {
        const { data, error } = await db.from('botes').select('id, ubicacion, latitud, longitud, estatus');
        if (error) throw error;
        botes = data || [];
      }
      divError.classList.add('hidden');
      renderizarUI();
    } catch (e) {
      console.error(e);
      divError.classList.remove('hidden');
      divError.classList.add('flex');
    } finally {
      if (divCargando) divCargando.remove();
    }
  }

  // --- MATEMÁTICA Y GEOLOCALIZACIÓN ---

  // Fórmula de Haversine (retorna km)
  function getDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  // Activar geolocalización
  btnCerca.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    
    const txtOriginal = btnCerca.innerHTML;
    btnCerca.innerHTML = 'Buscando...';
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        miUbicacion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        
        // Dibujar usuario
        if (marcadorUsuario) mapa.removeLayer(marcadorUsuario);
        const userIcon = L.divIcon({
          className: 'bg-transparent',
          html: `<div class="h-4 w-4 rounded-full bg-blue-600 border-2 border-white shadow-[0_0_10px_rgba(37,99,235,0.8)] animate-pulse"></div>`,
          iconSize: [16, 16]
        });
        marcadorUsuario = L.marker([miUbicacion.lat, miUbicacion.lng], { icon: userIcon }).addTo(mapa);
        
        mapa.flyTo([miUbicacion.lat, miUbicacion.lng], 15);
        btnCerca.innerHTML = txtOriginal;
        renderizarUI(); // Reordena la lista por distancia
      },
      () => { btnCerca.innerHTML = txtOriginal; }
    );
  });

  // --- RENDERIZADO UI ---

  function renderizarUI() {
    marcadores.clearLayers();
    
    // Filtrar
    let botesVisibles = checkDisponibles.checked 
      ? botes.filter(b => b.estatus === 'activo') 
      : [...botes];

    // Ordenar si tenemos ubicación
    if (miUbicacion) {
      botesVisibles.forEach(b => { b.distancia = getDistancia(miUbicacion.lat, miUbicacion.lng, b.latitud, b.longitud); });
      botesVisibles.sort((a, b) => a.distancia - b.distancia);
    }

    // Limpiar lista preservando el mensaje vacío si existe
    Array.from(contenedorLista.children).forEach(el => {
      if (el.id !== 'estado-vacio' && el.id !== 'estado-cargando') el.remove();
    });

    if (botesVisibles.length === 0) {
      divVacio.classList.remove('hidden');
      return;
    }
    divVacio.classList.add('hidden');

    // Bounds para ajustar la cámara (si no hay ubicación de usuario)
    const limites = L.latLngBounds();

    botesVisibles.forEach(bote => {
      const estilo = COLORES_ESTATUS[bote.estatus] || COLORES_ESTATUS['inactivo'];
      const opacidad = bote.estatus === 'activo' ? '' : 'opacity-75';
      const textoDist = bote.distancia ? (bote.distancia < 1 ? `${Math.round(bote.distancia * 1000)}m` : `${bote.distancia.toFixed(1)}km`) : '';
      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${bote.latitud},${bote.longitud}`;

      // 1. DIBUJAR PIN (L.divIcon con colores dinámicos SVG)
      const pinHTML = `
        <svg class="drop-shadow-md" viewBox="0 0 24 24" fill="${estilo.fill}" stroke="white" stroke-width="1.5">
          <path d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      `;
      const marcador = L.marker([bote.latitud, bote.longitud], {
        icon: L.divIcon({ html: pinHTML, className: 'bg-transparent', iconSize: [36, 36], iconAnchor: [18, 36] })
      });
      
      // Popup HTML (hereda diseño botones home.html)
      marcador.bindPopup(`
        <div class="p-1 min-w-[100px] font-sans">
          <p class="font-bold text-gray-900 text-sm mb-1">${bote.ubicacion}</p>
          <p class="text-xs ${estilo.color} font-semibold mb-3">${estilo.label} ${textoDist ? '· A '+textoDist : ''}</p>
          <div class="flex flex-col gap-2 mt-2">
            <a href="${googleMapsUrl}" target="_blank" style="color: #374151 !important; text-decoration: none !important;" class="w-full text-center rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold hover:bg-gray-200">Cómo llegar</a>
            ${bote.estatus === 'activo' ? `<a href="/escanear?bote=${bote.id}" style="color: white !important; text-decoration: none !important;" class="w-full text-center rounded-lg bg-green-700 px-3 py-2 text-xs font-bold hover:bg-green-800">Escanear aquí</a>` : ''}
          </div>
        </div>
      `);
      marcadores.addLayer(marcador);
      limites.extend([bote.latitud, bote.longitud]);

      // 2. AÑADIR A LA LISTA (Accesible y con clases de Home)
      const itemHTML = `
        <div tabindex="0" role="button" aria-label="Bote en ${bote.ubicacion}, estatus ${estilo.label}" class="${opacidad} group flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 cursor-pointer">
          <span aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${estilo.bg} ${estilo.color}">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
          </span>
          <div class="flex-1">
            <span class="block text-sm font-bold text-gray-900">${bote.ubicacion}</span>
            <div class="mt-1 flex items-center justify-between">
              <span class="inline-flex items-center rounded-md ${estilo.bg} px-2 py-0.5 text-xs font-semibold ${estilo.color} ring-1 ring-inset ${estilo.ring}">${estilo.label}</span>
              ${textoDist ? `<span class="text-xs font-medium text-gray-500">${textoDist}</span>` : ''}
            </div>
          </div>
        </div>
      `;
      const doc = new DOMParser().parseFromString(itemHTML, 'text/html');
      const nodo = doc.body.firstChild;

      // Eventos de teclado y clic (Centrar mapa y abrir popup)
      const accionar = () => {
        mapa.flyTo([bote.latitud, bote.longitud], 18, { animate: true });
        marcador.openPopup();
        if (window.innerWidth < 1024) document.querySelector('aside').scrollTo({ top: 0, behavior: 'smooth' });
      };
      nodo.addEventListener('click', accionar);
      nodo.addEventListener('keydown', (e) => { if (e.key === 'Enter') accionar(); });
      
      contenedorLista.appendChild(nodo);
    });

    if (!miUbicacion && botesVisibles.length > 0) mapa.fitBounds(limites, { padding: [30, 30] });
  }

  // --- EVENTOS GLOBALES Y POLLING ---

  checkDisponibles.addEventListener('change', renderizarUI);
  btnReintentar.addEventListener('click', fetchBotes);

  // Primera carga y Polling (15s)
  await fetchBotes();
  setInterval(fetchBotes, 15000);

})();