-- Esquema de base de datos del Bote Inteligente (Basurin).
-- Ejecutar completo en Supabase: Dashboard > SQL Editor > New query > Run.
-- Se puede ejecutar varias veces: no borra datos.
--
-- Roles de la app: usuarios.rol = 0 (usuario) | 1 (administrador).
-- El navegador (llave anon) solo puede leer sus propios datos y editar su nombre.
-- Todo lo que suma o gasta puntos (transacciones, sesiones, canjes) lo escribe el
-- servidor con la llave service_role o las funciones de este archivo.

-- ============================================================
-- USUARIOS
-- Supabase Auth guarda correo y contraseña en auth.users.
-- Esta tabla guarda los datos extra de cada usuario (nombre, puntos y rol).
-- rol: 0 = usuario, 1 = administrador. Solo se cambia desde el SQL Editor
-- o con la llave service_role; desde el navegador nadie puede modificarlo.
-- ============================================================
create table if not exists public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null,
  correo     text not null unique,
  puntos     integer not null default 0 check (puntos >= 0),
  rol        smallint not null default 0 constraint usuarios_rol_check check (rol in (0, 1)),
  creado_en  timestamptz not null default now()
);

-- Para bases creadas antes de existir el rol (el create de arriba solo aplica a tablas nuevas)
alter table public.usuarios
  add column if not exists rol smallint not null default 0 constraint usuarios_rol_check check (rol in (0, 1));

comment on column public.usuarios.rol is '0 = usuario, 1 = administrador';

-- Al registrarse en Auth se crea su fila en usuarios automáticamente,
-- tomando el nombre que manda el formulario de registro.
-- OJO: aquí NO se lee el rol del formulario; todos nacen como usuario (rol 0).
create or replace function public.crear_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.usuarios (id, nombre, correo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_usuario();

-- ============================================================
-- BOTES
-- ============================================================
create table if not exists public.botes (
  id         bigint generated always as identity primary key,
  ubicacion  text not null,
  latitud    double precision not null check (latitud between -90 and 90),
  longitud   double precision not null check (longitud between -180 and 180),
  estatus    text not null default 'activo'
             check (estatus in ('activo', 'inactivo', 'lleno', 'mantenimiento')),
  creado_en  timestamptz not null default now()
);

-- ============================================================
-- SESIONES ACTIVAS
-- Qué usuario está conectado a qué bote en este momento.
-- Un bote solo atiende a un usuario a la vez y viceversa.
-- Las sesiones las crea el servidor (service_role) al validar el QR del bote.
-- ============================================================
create table if not exists public.sesiones_activas (
  id          bigint generated always as identity primary key,
  usuario_id  uuid   not null unique references public.usuarios (id) on delete cascade,
  bote_id     bigint not null unique references public.botes (id) on delete cascade,
  iniciada_en timestamptz not null default now()
);

-- ============================================================
-- TRANSACCIONES
-- Cada residuo depositado: en qué bote, qué material, cuántos puntos y cuándo.
-- ============================================================
create table if not exists public.transacciones (
  id          bigint generated always as identity primary key,
  usuario_id  uuid   not null references public.usuarios (id) on delete cascade,
  bote_id     bigint not null references public.botes (id) on delete restrict,
  material    text   not null,
  puntos      integer not null check (puntos >= 0),
  fecha       timestamptz not null default now()
);

create index if not exists transacciones_usuario_idx on public.transacciones (usuario_id, fecha desc);
create index if not exists transacciones_bote_idx    on public.transacciones (bote_id, fecha desc);

-- Cada transacción suma sus puntos al usuario.
create or replace function public.sumar_puntos()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.usuarios
     set puntos = puntos + new.puntos
   where id = new.usuario_id;
  return new;
end;
$$;

drop trigger if exists al_registrar_transaccion on public.transacciones;
create trigger al_registrar_transaccion
  after insert on public.transacciones
  for each row execute function public.sumar_puntos();

-- ============================================================
-- ES_ADMIN
-- true si quien consulta es administrador. La usan las políticas de abajo.
-- Es security definer para leer usuarios sin caer en recursión de RLS.
-- ============================================================
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and rol = 1);
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- ============================================================
-- PREMIOS
-- Catálogo canjeable con puntos. tipo: 'cupon' o 'donacion' (a una cooperativa).
-- stock null = ilimitado.
-- sector: dónde se implementa el bote ('gobierno', 'industria', 'educativo' o 'propio' = Basurin).
-- ============================================================
create table if not exists public.premios (
  id           bigint generated always as identity primary key,
  nombre       text    not null,
  descripcion  text,
  tipo         text    not null default 'cupon' check (tipo in ('cupon', 'donacion')),
  costo        integer not null check (costo > 0),
  stock        integer check (stock >= 0),
  imagen_url   text,
  activo       boolean not null default true,
  sector       text    not null default 'propio'
               constraint premios_sector_check check (sector in ('gobierno', 'industria', 'educativo', 'propio')),
  creado_en    timestamptz not null default now()
);

-- Para bases creadas antes de existir el sector
alter table public.premios
  add column if not exists sector text not null default 'propio'
  constraint premios_sector_check check (sector in ('gobierno', 'industria', 'educativo', 'propio'));

create index if not exists premios_activo_idx on public.premios (activo, costo);

-- Premios de ejemplo por sector (solo se insertan los que aún no existen con ese nombre)
insert into public.premios (nombre, descripcion, tipo, costo, stock, sector)
select v.nombre, v.descripcion, v.tipo, v.costo, v.stock, v.sector
  from (values
    ('Pase de transporte público',     '10 viajes en el transporte público de la ciudad.',                 'cupon',    300, null::integer, 'gobierno'),
    ('Descuento en el predial',        '5% de descuento en el pago anual del impuesto predial.',           'cupon',    800, null,          'gobierno'),
    ('Entrada a museos municipales',   'Acceso gratuito a los museos y centros culturales del municipio.', 'cupon',    200, null,          'gobierno'),
    ('Un árbol plantado a tu nombre',  'El municipio planta un árbol en un parque de tu colonia.',         'donacion', 150, null,          'gobierno'),
    ('Vale de despensa',               'Vale de $100 para usar en la tienda de la empresa.',               'cupon',    400, 50,            'industria'),
    ('Comida en el comedor',           'Una comida completa gratis en el comedor de la planta.',           'cupon',    120, null,          'industria'),
    ('Medio día libre',                'Salida temprano un viernes, coordinada con tu supervisor.',        'cupon',   1500, 10,            'industria'),
    ('Donación a recicladores',        'La empresa dona tus puntos a una cooperativa de recicladores.',    'donacion', 100, null,          'industria'),
    ('Impresiones gratis',             '20 hojas de impresión en el centro de cómputo.',                   'cupon',     80, null,          'educativo'),
    ('Café en la cafetería',           'Un café o bebida caliente en la cafetería escolar.',               'cupon',    100, null,          'educativo'),
    ('Kit escolar reciclado',          'Cuaderno y lápices hechos con material reciclado.',                'cupon',    250, 40,            'educativo'),
    ('Préstamo extendido',             'Una semana extra en tu próximo préstamo de biblioteca.',           'cupon',     60, null,          'educativo'),
    ('Botella reutilizable Basurin',   'Botella de acero inoxidable de 600 ml con el logo de Basurin.',    'cupon',    400, 30,            'propio'),
    ('Bolsa de tela Basurin',          'Bolsa resistente para dejar las de plástico.',                     'cupon',    250, 50,            'propio'),
    ('Playera Basurin',                'Playera de algodón orgánico.',                                     'cupon',    600, 20,            'propio'),
    ('Donar a una cooperativa',        'Tus puntos se convierten en apoyo para recicladores de la ciudad.', 'donacion', 100, null,         'propio')
  ) as v(nombre, descripcion, tipo, costo, stock, sector)
 where not exists (select 1 from public.premios p where p.nombre = v.nombre);

-- ============================================================
-- CANJES
-- Cada premio canjeado. El costo se guarda tal como estaba al canjear.
-- El usuario muestra su código y el administrador lo marca como entregado.
-- ============================================================
create table if not exists public.canjes (
  id            bigint generated always as identity primary key,
  usuario_id    uuid    not null references public.usuarios (id) on delete cascade,
  premio_id     bigint  not null references public.premios (id) on delete restrict,
  costo         integer not null check (costo > 0),
  codigo        text    not null unique,
  estado        text    not null default 'pendiente'
                check (estado in ('pendiente', 'entregado', 'cancelado')),
  creado_en     timestamptz not null default now(),
  entregado_en  timestamptz
);

create index if not exists canjes_usuario_idx on public.canjes (usuario_id, creado_en desc);
create index if not exists canjes_estado_idx  on public.canjes (estado, creado_en desc);

-- ------------------------------------------------------------
-- canjear_premio(p_premio_id): la llama el usuario con su sesión.
-- Verifica premio, stock y saldo; descuenta puntos y stock; crea el canje con su código.
-- Todo en una sola transacción y con bloqueos, así no hay doble gasto ni stock negativo.
-- ------------------------------------------------------------
create or replace function public.canjear_premio(p_premio_id bigint)
returns public.canjes
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_premio public.premios%rowtype;
  v_saldo  integer;
  v_canje  public.canjes%rowtype;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para canjear premios' using errcode = '28000';
  end if;

  select * into v_premio from public.premios where id = p_premio_id and activo for update;
  if not found then
    raise exception 'El premio no está disponible';
  end if;
  if v_premio.stock is not null and v_premio.stock <= 0 then
    raise exception 'El premio está agotado';
  end if;

  select puntos into v_saldo from public.usuarios where id = v_uid for update;
  if v_saldo is null then
    raise exception 'No se encontró tu cuenta';
  end if;
  if v_saldo < v_premio.costo then
    raise exception 'No tienes puntos suficientes (necesitas %, tienes %)', v_premio.costo, v_saldo;
  end if;

  update public.usuarios set puntos = puntos - v_premio.costo where id = v_uid;
  if v_premio.stock is not null then
    update public.premios set stock = stock - 1 where id = v_premio.id;
  end if;

  insert into public.canjes (usuario_id, premio_id, costo, codigo)
  values (v_uid, v_premio.id, v_premio.costo,
          'BAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)))
  returning * into v_canje;

  return v_canje;
end;
$$;

-- ------------------------------------------------------------
-- entregar_canje(p_codigo): solo administradores. Marca un canje pendiente como entregado.
-- ------------------------------------------------------------
create or replace function public.entregar_canje(p_codigo text)
returns public.canjes
language plpgsql
security definer set search_path = public
as $$
declare
  v_canje public.canjes%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede entregar canjes' using errcode = '42501';
  end if;

  update public.canjes
     set estado = 'entregado', entregado_en = now()
   where codigo = upper(trim(p_codigo)) and estado = 'pendiente'
  returning * into v_canje;

  if not found then
    raise exception 'Código inválido o ya utilizado';
  end if;
  return v_canje;
end;
$$;

-- ------------------------------------------------------------
-- cancelar_canje(p_canje_id): solo administradores. Cancela un canje pendiente
-- y devuelve los puntos y el stock.
-- ------------------------------------------------------------
create or replace function public.cancelar_canje(p_canje_id bigint)
returns public.canjes
language plpgsql
security definer set search_path = public
as $$
declare
  v_canje public.canjes%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cancelar canjes' using errcode = '42501';
  end if;

  select * into v_canje from public.canjes where id = p_canje_id for update;
  if not found or v_canje.estado <> 'pendiente' then
    raise exception 'Solo se pueden cancelar canjes pendientes';
  end if;

  -- Mismo orden de bloqueo que canjear_premio (primero el premio, luego el usuario)
  perform 1 from public.premios where id = v_canje.premio_id for update;
  update public.premios  set stock  = stock + 1 where id = v_canje.premio_id and stock is not null;
  update public.usuarios set puntos = puntos + v_canje.costo where id = v_canje.usuario_id;
  update public.canjes   set estado = 'cancelado' where id = v_canje.id returning * into v_canje;

  return v_canje;
end;
$$;

revoke all on function public.canjear_premio(bigint) from public, anon;
grant execute on function public.canjear_premio(bigint) to authenticated;
revoke all on function public.entregar_canje(text) from public, anon;
grant execute on function public.entregar_canje(text) to authenticated;
revoke all on function public.cancelar_canje(bigint) from public, anon;
grant execute on function public.cancelar_canje(bigint) to authenticated;

-- ============================================================
-- SEGURIDAD (Row Level Security)
-- La página usa la llave pública (anon), así que cada usuario solo
-- puede leer sus propios datos. Las transacciones, sesiones y canjes los
-- escribe el servidor/bote con la llave service_role (que ignora estas reglas)
-- o las funciones de arriba, para que nadie se sume puntos a mano.
-- El administrador (usuarios.rol = 1) puede ver todo y gestionar botes y premios.
-- ============================================================
alter table public.usuarios         enable row level security;
alter table public.botes            enable row level security;
alter table public.sesiones_activas enable row level security;
alter table public.transacciones    enable row level security;
alter table public.premios          enable row level security;
alter table public.canjes           enable row level security;

-- usuarios
drop policy if exists "usuario ve su perfil" on public.usuarios;
create policy "usuario ve su perfil" on public.usuarios
  for select using (auth.uid() = id);

drop policy if exists "admin ve todos los usuarios" on public.usuarios;
create policy "admin ve todos los usuarios" on public.usuarios
  for select to authenticated using ((select public.es_admin()));

-- Solo puede editar su fila y, por los privilegios de más abajo, solo la columna nombre.
drop policy if exists "usuario edita su nombre" on public.usuarios;
create policy "usuario edita su nombre" on public.usuarios
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- botes
drop policy if exists "todos ven los botes" on public.botes;
create policy "todos ven los botes" on public.botes
  for select using (true);

drop policy if exists "admin gestiona botes" on public.botes;
create policy "admin gestiona botes" on public.botes
  for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- sesiones_activas (ya no se pueden crear desde el navegador: las crea el servidor)
drop policy if exists "usuario ve su sesion" on public.sesiones_activas;
create policy "usuario ve su sesion" on public.sesiones_activas
  for select using (auth.uid() = usuario_id);

drop policy if exists "usuario abre su sesion" on public.sesiones_activas;

drop policy if exists "usuario cierra su sesion" on public.sesiones_activas;
create policy "usuario cierra su sesion" on public.sesiones_activas
  for delete using (auth.uid() = usuario_id);

drop policy if exists "admin ve todas las sesiones" on public.sesiones_activas;
create policy "admin ve todas las sesiones" on public.sesiones_activas
  for select to authenticated using ((select public.es_admin()));

-- transacciones
drop policy if exists "usuario ve sus transacciones" on public.transacciones;
create policy "usuario ve sus transacciones" on public.transacciones
  for select using (auth.uid() = usuario_id);

drop policy if exists "admin ve todas las transacciones" on public.transacciones;
create policy "admin ve todas las transacciones" on public.transacciones
  for select to authenticated using ((select public.es_admin()));

-- premios
drop policy if exists "todos ven premios activos" on public.premios;
create policy "todos ven premios activos" on public.premios
  for select using (activo);

drop policy if exists "admin gestiona premios" on public.premios;
create policy "admin gestiona premios" on public.premios
  for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- canjes (se crean solo con canjear_premio; el administrador los entrega o cancela con sus funciones)
drop policy if exists "usuario ve sus canjes" on public.canjes;
create policy "usuario ve sus canjes" on public.canjes
  for select to authenticated using (auth.uid() = usuario_id);

drop policy if exists "admin ve todos los canjes" on public.canjes;
create policy "admin ve todos los canjes" on public.canjes
  for select to authenticated using ((select public.es_admin()));

-- ============================================================
-- PRIVILEGIOS
-- Segunda barrera además de RLS: aunque alguien agregara una política por error,
-- el navegador no podría escribir donde no debe.
-- ============================================================
-- usuarios: el navegador solo puede editar la columna nombre (nunca puntos, rol ni correo)
revoke insert, update, delete on public.usuarios from anon, authenticated;
grant update (nombre) on public.usuarios to authenticated;

-- sesiones: las crea y renueva el servidor; el usuario solo puede cerrar la suya
revoke insert, update on public.sesiones_activas from anon, authenticated;
revoke delete on public.sesiones_activas from anon;

-- transacciones y canjes: solo el servidor o las funciones escriben
revoke insert, update, delete on public.transacciones from anon, authenticated;
revoke insert, update, delete on public.canjes from anon, authenticated;

-- botes y premios: solo el administrador (por sus políticas) escribe
revoke insert, update, delete on public.botes from anon;
revoke insert, update, delete on public.premios from anon;

-- ============================================================
-- REALTIME
-- Para que la web reaccione al instante (puntos, sesión vinculada, nuevos depósitos).
-- Cada usuario solo recibe los cambios de las filas que sus políticas le permiten ver.
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['usuarios', 'sesiones_activas', 'transacciones'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
