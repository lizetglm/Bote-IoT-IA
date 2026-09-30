-- Migración: las sesiones con el bote vencen solas.
-- Una sesión dura 5 minutos desde que se escanea el QR o desde el último residuo depositado
-- (cada depósito reinicia el tiempo). actividad_en guarda ese último momento; el servidor la
-- actualiza en cada transacción y cierra las sesiones que llevan más de 5 minutos sin actividad.
-- Para bases creadas antes de este cambio (schema.sql ya lo incluye).
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > Run. Se puede ejecutar varias veces.

alter table public.sesiones_activas
  add column if not exists actividad_en timestamptz not null default now();

comment on column public.sesiones_activas.actividad_en is
  'Último escaneo o depósito; la sesión vence 5 minutos después (MINUTOS_SESION en camara_web.py)';

-- Para que la web vea el cambio sin esperar
notify pgrst, 'reload schema';
