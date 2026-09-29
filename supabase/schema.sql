-- Esquema de base de datos del Bote Inteligente.
-- Ejecutar completo en Supabase: Dashboard > SQL Editor > New query > Run.

-- ============================================================
-- USUARIOS
-- Supabase Auth guarda correo y contraseña en auth.users.
-- Esta tabla guarda los datos extra de cada usuario (nombre y puntos).
-- ============================================================
create table if not exists public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null,
  correo     text not null unique,
  puntos     integer not null default 0 check (puntos >= 0),
  creado_en  timestamptz not null default now()
);

-- Al registrarse en Auth se crea su fila en usuarios automáticamente,
-- tomando el nombre que manda el formulario de registro.
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
-- SEGURIDAD (Row Level Security)
-- La página usa la llave pública (anon), así que cada usuario solo
-- puede leer sus propios datos. Las transacciones y los cambios de
-- puntos los escribe el servidor/bote con la llave service_role,
-- que ignora estas reglas, para que nadie se sume puntos a mano.
-- ============================================================
alter table public.usuarios         enable row level security;
alter table public.botes            enable row level security;
alter table public.sesiones_activas enable row level security;
alter table public.transacciones    enable row level security;

drop policy if exists "usuario ve su perfil" on public.usuarios;
create policy "usuario ve su perfil" on public.usuarios
  for select using (auth.uid() = id);

drop policy if exists "todos ven los botes" on public.botes;
create policy "todos ven los botes" on public.botes
  for select using (true);

drop policy if exists "usuario ve su sesion" on public.sesiones_activas;
create policy "usuario ve su sesion" on public.sesiones_activas
  for select using (auth.uid() = usuario_id);

drop policy if exists "usuario abre su sesion" on public.sesiones_activas;
create policy "usuario abre su sesion" on public.sesiones_activas
  for insert with check (auth.uid() = usuario_id);

drop policy if exists "usuario cierra su sesion" on public.sesiones_activas;
create policy "usuario cierra su sesion" on public.sesiones_activas
  for delete using (auth.uid() = usuario_id);

drop policy if exists "usuario ve sus transacciones" on public.transacciones;
create policy "usuario ve sus transacciones" on public.transacciones
  for select using (auth.uid() = usuario_id);
