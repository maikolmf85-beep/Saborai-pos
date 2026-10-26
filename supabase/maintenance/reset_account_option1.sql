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
  set zones = '[]'::jsonb,
      updated_at = now()
  where id = v_tenant_id;

  raise notice 'Configuración reiniciada para tenant % (usuario %).', v_tenant_id, v_user_id;
exception
  when no_data_found then
    raise exception 'No se encontró exactamente el usuario o tenant de matamoros.maikol85@gmail.com.';
end $$;

commit;

-- Verificación: todas deben devolver 0; el tenant debe mostrar zones = [].
select 'tables' as object_name, count(*) as remaining
from public.pos_tables t
join public.tenants tn on tn.id = t.tenant_id
join public.users u on u.id = tn.user_id
where lower(u.email) = lower('matamoros.maikol85@gmail.com')
union all
select 'menu_items', count(*)
from public.pos_menu_items m
join public.tenants tn on tn.id = m.tenant_id
join public.users u on u.id = tn.user_id
where lower(u.email) = lower('matamoros.maikol85@gmail.com')
union all
select 'menu_categories', count(*)
from public.pos_menu_categories m
join public.tenants tn on tn.id = m.tenant_id
join public.users u on u.id = tn.user_id
where lower(u.email) = lower('matamoros.maikol85@gmail.com')
union all
select 'ingredients', count(*)
from public.pos_ingredients i
join public.tenants tn on tn.id = i.tenant_id
join public.users u on u.id = tn.user_id
where lower(u.email) = lower('matamoros.maikol85@gmail.com');

select id, zones
from public.tenants
where user_id = (
  select id from public.users
  where lower(email) = lower('matamoros.maikol85@gmail.com')
);
