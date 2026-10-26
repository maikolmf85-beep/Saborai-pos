-- REINICIO MANUAL CONFIRMADO: opción 1
-- Cuenta: matamoros.maikol85@gmail.com
-- Elimina configuración operativa; conserva facturas, órdenes, pagos,
-- movimientos históricos, turnos y auditoría.
-- Ejecutar manualmente en Supabase SQL Editor. No es una migración automática.

begin;

do $$
declare
  v_user_id uuid;
  v_tenant_id uuid;
begin
  select id into strict v_user_id
  from public.users
  where lower(email) = lower('matamoros.maikol85@gmail.com');

  select id into strict v_tenant_id
  from public.tenants
  where user_id = v_user_id;

  -- Configuración de mesas. Las órdenes históricas se conservan y su table_id
  -- queda nulo por la FK ON DELETE SET NULL.
  if to_regclass('public.pos_tables') is not null then
    delete from public.pos_tables
    where tenant_id = v_tenant_id;
  end if;

  -- Recetas dependen de ingredientes y productos.
  if to_regclass('public.pos_recipes') is not null then
    delete from public.pos_recipes
    where tenant_id = v_tenant_id;
  end if;

  if to_regclass('public.pos_menu_items') is not null then
    delete from public.pos_menu_items
    where tenant_id = v_tenant_id;
  end if;

  if to_regclass('public.pos_menu_categories') is not null then
    delete from public.pos_menu_categories
    where tenant_id = v_tenant_id;
  end if;

  if to_regclass('public.pos_ingredients') is not null then
    delete from public.pos_ingredients
    where tenant_id = v_tenant_id;
  end if;

  -- Los salones viven en el perfil del tenant. Se conserva el tenant y su cuenta.
  update public.tenants
  set zones = '[]'::jsonb
  where id = v_tenant_id;

  raise notice 'Configuración reiniciada para tenant % (usuario %).', v_tenant_id, v_user_id;
exception
  when no_data_found then
    raise exception 'No se encontró exactamente el usuario o tenant de matamoros.maikol85@gmail.com.';
end $$;

commit;

-- Verificación: las tablas existentes deben quedar en 0; las ausentes se omiten.
do $$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_table text;
  v_count bigint;
begin
  select id into strict v_user_id
  from public.users
  where lower(email) = lower('matamoros.maikol85@gmail.com');

  select id into strict v_tenant_id
  from public.tenants
  where user_id = v_user_id;

  foreach v_table in array array['pos_tables', 'pos_menu_items', 'pos_menu_categories', 'pos_ingredients']
  loop
    if to_regclass('public.' || v_table) is null then
      raise notice '%: tabla ausente, omitida.', v_table;
    else
      execute format('select count(*) from public.%I where tenant_id = $1', v_table)
        into v_count using v_tenant_id;
      raise notice '%: % registros restantes.', v_table, v_count;
    end if;
  end loop;
end $$;

select id, zones
from public.tenants
where user_id = (
  select id from public.users
  where lower(email) = lower('matamoros.maikol85@gmail.com')
);
