-- Migración: sector de los premios + premios de ejemplo.
-- Para bases creadas antes de que existiera premios.sector (schema.sql ya lo incluye).
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > Run. Se puede ejecutar varias veces.

alter table public.premios
  add column if not exists sector text not null default 'propio'
  constraint premios_sector_check check (sector in ('gobierno', 'industria', 'educativo', 'propio'));

comment on column public.premios.sector is 'gobierno | industria | educativo | propio (Basurin)';

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

-- Para que la web vea la columna nueva sin esperar
notify pgrst, 'reload schema';
