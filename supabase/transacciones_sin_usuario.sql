-- Migración: transacciones sin usuario (depósitos de gente que no escaneó el QR).
-- Cuentan para las estadísticas del panel pero no dan puntos (el servidor las guarda con puntos = 0).
-- Además, si un usuario borra su cuenta, sus depósitos se quedan sin usuario en vez de borrarse.
-- Para bases creadas antes de este cambio (schema.sql ya lo incluye).
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > Run. Se puede ejecutar varias veces.

alter table public.transacciones alter column usuario_id drop not null;

-- Borrar una cuenta ya no borra sus depósitos: quedan como "sin registrar"
alter table public.transacciones drop constraint if exists transacciones_usuario_id_fkey;
alter table public.transacciones
  add constraint transacciones_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios (id) on delete set null;

comment on column public.transacciones.usuario_id is 'Usuario vinculado al bote; vacío si nadie lo estaba (sin puntos)';

-- Para que la web vea el cambio sin esperar
notify pgrst, 'reload schema';
