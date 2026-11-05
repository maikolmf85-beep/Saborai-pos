-- SaborAI POS - ajuste idempotente de existencias del catálogo compartido.
-- Dependencias ya existentes:
--   20261017000000_pos_core.sql: pos_ingredients, pos_inventory_movements,
--     UNIQUE (tenant_id, idempotency_key), tipos SALE/RESTOCK/WASTE/ADJUSTMENT.
--   20261026020000_phase9_operational_scope.sql: alcance y trigger de sucursal/caja/turno/terminal.
-- La RPC requiere columnas para conservar la solicitud original y el resultado estable.
-- Esta migración NO debe aplicarse sin revisión y aprobación explícita.

alter table public.pos_inventory_movements
  add column if not exists requested_adjustment numeric(14,4),
  add column if not exists resulting_stock numeric(14,4);

comment on column public.pos_inventory_movements.requested_adjustment is
  'Cantidad firmada solicitada a apply_inventory_adjustment; permite validar reintentos idempotentes.';
comment on column public.pos_inventory_movements.resulting_stock is
  'Saldo de pos_ingredients al completar este ajuste; conserva el resultado original para reintentos.';

create or replace function public.apply_inventory_adjustment(
  p_tenant_id uuid,
  p_operation_id text,
  p_created_by uuid,
  p_branch_id uuid,
  p_ingredient_id uuid,
  p_adjustment numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_operation_id text;
  normalized_reason text;
  expected_movement_type text;
  inserted_movement_id uuid;
  existing_movement_id uuid;
  existing_ingredient_id uuid;
  existing_branch_id uuid;
  existing_movement_type text;
  existing_quantity numeric(14,4);
  existing_adjustment_request numeric(14,4);
  existing_reason text;
  existing_created_by uuid;
  existing_resulting_stock numeric(14,4);
  locked_stock numeric(14,4);
  available_stock numeric(14,4);
  applied_adjustment numeric(14,4);
  new_stock numeric(14,4);
begin
  if p_tenant_id is null
    or nullif(trim(p_operation_id), '') is null
    or length(trim(p_operation_id)) > 160
    or p_branch_id is null
    or p_ingredient_id is null
    or p_adjustment is null
    or p_adjustment = 0
    or abs(p_adjustment) > 100000000
    or p_adjustment <> round(p_adjustment, 4)
    or (p_reason is not null and length(trim(p_reason)) > 300) then
    raise exception 'Parámetros de ajuste de inventario inválidos';
  end if;

  normalized_operation_id := trim(p_operation_id);
  normalized_reason := coalesce(nullif(trim(p_reason), ''), 'Ajuste de inventario');
  expected_movement_type := case when p_adjustment > 0 then 'RESTOCK' else 'ADJUSTMENT' end;

  -- Serialize calls to this RPC for the same tenant-scoped operation key.
  -- Hash collisions only add serialization; the unique table key remains authoritative.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tenant_id::text),
    pg_catalog.hashtext(normalized_operation_id)
  );

  -- A retry returns the saved operation result, not today's stock balance.
  select m.id, m.ingredient_id, m.branch_id, m.movement_type, m.quantity,
         m.requested_adjustment, m.reason, m.created_by, m.resulting_stock
    into existing_movement_id, existing_ingredient_id, existing_branch_id,
         existing_movement_type, existing_quantity, existing_adjustment_request,
         existing_reason, existing_created_by, existing_resulting_stock
  from public.pos_inventory_movements m
  where m.tenant_id = p_tenant_id
    and m.idempotency_key = normalized_operation_id;

  if found then
    if existing_ingredient_id is distinct from p_ingredient_id
      or existing_branch_id is distinct from p_branch_id
      or existing_movement_type is distinct from expected_movement_type
      or existing_adjustment_request is distinct from p_adjustment
      or existing_reason is distinct from normalized_reason
      or existing_created_by is distinct from p_created_by then
      raise exception 'La clave de operación ya fue usada con otros valores';
    end if;
    if existing_quantity is null or existing_quantity <= 0
      or (existing_movement_type = 'RESTOCK' and existing_quantity <> existing_adjustment_request)
      or (existing_movement_type = 'ADJUSTMENT' and existing_quantity > abs(existing_adjustment_request))
      or existing_resulting_stock is null or existing_resulting_stock < 0 then
      raise exception 'La operación idempotente existente no tiene un resultado válido';
    end if;

    return jsonb_build_object(
      'alreadyApplied', true,
      'movementId', existing_movement_id,
      'requestedAdjustment', existing_adjustment_request,
      'appliedAdjustment', case
        when existing_adjustment_request > 0 then existing_quantity
        else -existing_quantity
      end,
      'stockAfterOperation', existing_resulting_stock
    );
  end if;

  select i.current_stock into locked_stock
  from public.pos_ingredients i
  where i.id = p_ingredient_id
    and i.tenant_id = p_tenant_id
    and i.branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'El insumo no existe en el tenant y sucursal indicados';
  end if;

  available_stock := greatest(0, locked_stock);
  applied_adjustment := case
    when p_adjustment < 0 then greatest(-available_stock, p_adjustment)
    else p_adjustment
  end;

  if applied_adjustment = 0 then
    raise exception 'No hay existencias disponibles para aplicar este ajuste negativo';
  end if;
  if abs(applied_adjustment) > 100000000
    or available_stock + applied_adjustment > 9999999999.9999 then
    raise exception 'El ajuste excede los límites permitidos del inventario';
  end if;

  new_stock := available_stock + applied_adjustment;

  -- Both the actual movement quantity and its post-operation balance are known
  -- before insertion. A zero/invalid adjustment therefore creates no movement.
  insert into public.pos_inventory_movements (
    tenant_id,
    branch_id,
    ingredient_id,
    movement_type,
    quantity,
    reason,
    idempotency_key,
    created_by,
    requested_adjustment,
    resulting_stock
  ) values (
    p_tenant_id,
    p_branch_id,
    p_ingredient_id,
    expected_movement_type,
    abs(applied_adjustment),
    normalized_reason,
    normalized_operation_id,
    p_created_by,
    p_adjustment,
    new_stock
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into inserted_movement_id;

  if inserted_movement_id is null then
    -- Covers a conflicting writer that inserted the key after the first lookup.
    select m.id, m.ingredient_id, m.branch_id, m.movement_type, m.quantity,
           m.requested_adjustment, m.reason, m.created_by, m.resulting_stock
      into existing_movement_id, existing_ingredient_id, existing_branch_id,
           existing_movement_type, existing_quantity, existing_adjustment_request,
           existing_reason, existing_created_by, existing_resulting_stock
    from public.pos_inventory_movements m
    where m.tenant_id = p_tenant_id
      and m.idempotency_key = normalized_operation_id;

    if not found then
      raise exception 'No se pudo resolver la clave de idempotencia concurrente';
    end if;
    if existing_ingredient_id is distinct from p_ingredient_id
      or existing_branch_id is distinct from p_branch_id
      or existing_movement_type is distinct from expected_movement_type
      or existing_adjustment_request is distinct from p_adjustment
      or existing_reason is distinct from normalized_reason
      or existing_created_by is distinct from p_created_by then
      raise exception 'La clave de operación ya fue usada con otros valores';
    end if;
    if existing_quantity is null or existing_quantity <= 0
      or (existing_movement_type = 'RESTOCK' and existing_quantity <> existing_adjustment_request)
      or (existing_movement_type = 'ADJUSTMENT' and existing_quantity > abs(existing_adjustment_request))
      or existing_resulting_stock is null or existing_resulting_stock < 0 then
      raise exception 'La operación idempotente existente no tiene un resultado válido';
    end if;

    return jsonb_build_object(
      'alreadyApplied', true,
      'movementId', existing_movement_id,
      'requestedAdjustment', existing_adjustment_request,
      'appliedAdjustment', case
        when existing_adjustment_request > 0 then existing_quantity
        else -existing_quantity
      end,
      'stockAfterOperation', existing_resulting_stock
    );
  end if;

  update public.pos_ingredients
  set current_stock = new_stock
  where id = p_ingredient_id
    and tenant_id = p_tenant_id
    and branch_id = p_branch_id
  returning current_stock into new_stock;

  if not found then
    raise exception 'No se pudo actualizar el insumo en la sucursal indicada';
  end if;

  return jsonb_build_object(
    'alreadyApplied', false,
    'movementId', inserted_movement_id,
    'requestedAdjustment', p_adjustment,
    'appliedAdjustment', applied_adjustment,
    'stockAfterOperation', new_stock
  );
end;
$$;

revoke all on function public.apply_inventory_adjustment(uuid, text, uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.apply_inventory_adjustment(uuid, text, uuid, uuid, uuid, numeric, text)
  to service_role;
