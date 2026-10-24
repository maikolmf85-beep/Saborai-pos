-- Fase 2: sincronización offline idempotente de inventario.
-- Cada movimiento y su actualización de stock se aplican dentro de la misma transacción.
create or replace function public.apply_offline_inventory(
  p_tenant_id uuid,
  p_operation_id text,
  p_created_by uuid,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_index integer;
  menu_item_id uuid;
  ingredient_row record;
  requested_quantity numeric;
  deduction numeric;
  movement_key text;
  inserted_movement_id uuid;
  applied_count integer := 0;
  skipped_count integer := 0;
begin
  if p_tenant_id is null or p_operation_id is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Parámetros de inventario offline inválidos';
  end if;

  for item, item_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    requested_quantity := greatest(coalesce((item->>'quantity')::numeric, 0), 0);
    if requested_quantity <= 0 then
      continue;
    end if;

    menu_item_id := null;
    if coalesce(item->>'menuItemId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select id into menu_item_id
      from pos_menu_items
      where id = (item->>'menuItemId')::uuid
        and tenant_id = p_tenant_id
      limit 1;
    end if;

    if menu_item_id is null and nullif(trim(item->>'name'), '') is not null then
      select id into menu_item_id
      from pos_menu_items
      where tenant_id = p_tenant_id
        and lower(name) = lower(trim(item->>'name'))
      order by updated_at desc
      limit 1;
    end if;

    if menu_item_id is null then
      continue;
    end if;

    for ingredient_row in
      select r.ingredient_id, r.quantity, r.unit, i.current_stock, i.name as ingredient_name
      from pos_recipes r
      join pos_ingredients i on i.id = r.ingredient_id and i.tenant_id = p_tenant_id
      where r.menu_item_id = menu_item_id
        and r.tenant_id = p_tenant_id
    loop
      deduction := ingredient_row.quantity * requested_quantity;
      movement_key := format('%s:%s:%s', p_operation_id, item_index, ingredient_row.ingredient_id);
      inserted_movement_id := null;

      insert into pos_inventory_movements (
        tenant_id, branch_id, ingredient_id, order_id, movement_type,
        quantity, reason, idempotency_key, created_by
      )
      select
        p_tenant_id,
        o.branch_id,
        ingredient_row.ingredient_id,
        p_order_id,
        'SALE',
        deduction,
        'Venta sincronizada desde POS offline',
        movement_key,
        p_created_by
      from pos_orders o
      where o.id = p_order_id
        and o.tenant_id = p_tenant_id
      on conflict (tenant_id, idempotency_key) do nothing
      returning id into inserted_movement_id;

      if inserted_movement_id is null then
        skipped_count := skipped_count + 1;
      else
        update pos_ingredients
        set current_stock = greatest(0, current_stock - deduction)
        where id = ingredient_row.ingredient_id
          and tenant_id = p_tenant_id;
        applied_count := applied_count + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('appliedCount', applied_count, 'skippedCount', skipped_count);
end;
$$;

revoke all on function public.apply_offline_inventory(uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.apply_offline_inventory(uuid, text, uuid, uuid, jsonb) to service_role;
