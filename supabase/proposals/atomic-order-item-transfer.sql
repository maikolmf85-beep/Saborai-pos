-- PROPUESTA NO APLICADA — revisar y aprobar antes de convertirla en migración.
-- No colocar este archivo en supabase/migrations ni ejecutarlo sobre Supabase
-- hasta aprobar el contrato y completar la integración del endpoint/cliente.
--
-- Requiere el esquema pos_core existente. La RPC está diseñada para que una
-- sola llamada PostgreSQL mueva una línea completa o parcial entre dos órdenes,
-- y para que un reintento con el mismo operation_id no vuelva a moverla.

alter table public.pos_order_items
  add column if not exists client_item_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pos_order_items'::regclass
      and conname = 'pos_order_items_client_item_id_check'
  ) then
    alter table public.pos_order_items
      add constraint pos_order_items_client_item_id_check
      check (
        client_item_id is null
        or length(btrim(client_item_id)) between 1 and 160
      );
  end if;
end;
$$;

-- Las filas existentes quedan NULL. El contrato posterior debe persistir el ID
-- local para nuevas sincronizaciones y la RPC resolverá filas históricas solo
-- con una coincidencia exacta y no ambigua de snapshot.
create unique index if not exists pos_order_items_client_item_id_uidx
  on public.pos_order_items (tenant_id, order_id, client_item_id)
  where client_item_id is not null;

create table if not exists public.pos_order_item_transfer_requests (
  tenant_id uuid not null,
  operation_id text not null,
  actor_user_id uuid not null,
  request_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  constraint pos_order_item_transfer_requests_pk
    primary key (tenant_id, operation_id),
  constraint pos_order_item_transfer_requests_operation_id_check
    check (length(btrim(operation_id)) between 1 and 160),
  constraint pos_order_item_transfer_requests_payload_check
    check (jsonb_typeof(request_payload) = 'object'),
  constraint pos_order_item_transfer_requests_result_check
    check (result is null or jsonb_typeof(result) = 'object')
);

alter table public.pos_order_item_transfer_requests enable row level security;
revoke all on table public.pos_order_item_transfer_requests from public, anon, authenticated;
grant all on table public.pos_order_item_transfer_requests to service_role;

create or replace function public.transfer_pos_order_item(
  p_tenant_id uuid,
  p_operation_id text,
  p_actor_user_id uuid,
  p_source_order_number text,
  p_destination_order_number text,
  p_source_client_item_id text,
  p_destination_client_item_id text,
  p_quantity numeric,
  p_source_item_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_inserted integer;
  v_locked integer;
  v_match_count integer;
  v_source_key text;
  v_destination_key text;
  v_source_order_id uuid;
  v_destination_order_id uuid;
  v_source_table_id uuid;
  v_destination_table_id uuid;
  v_source_order public.pos_orders%rowtype;
  v_destination_order public.pos_orders%rowtype;
  v_source_table public.pos_tables%rowtype;
  v_destination_table public.pos_tables%rowtype;
  v_source_item public.pos_order_items%rowtype;
  v_updated_source_item public.pos_order_items%rowtype;
  v_moved_item public.pos_order_items%rowtype;
  v_existing public.pos_order_item_transfer_requests%rowtype;
  v_snapshot_name text;
  v_snapshot_quantity numeric;
  v_snapshot_price numeric;
  v_snapshot_tax_rate numeric;
  v_snapshot_notes text;
  v_snapshot_modifiers jsonb;
  v_snapshot_station text;
  v_snapshot_kds_status text;
  v_result jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'tenant y actor son requeridos.' using errcode = '22023';
  end if;
  if p_operation_id is null or length(btrim(p_operation_id)) not between 1 and 160 then
    raise exception 'operation_id debe tener entre 1 y 160 caracteres.' using errcode = '22023';
  end if;
  if p_source_order_number is null or length(btrim(p_source_order_number)) not between 1 and 80
     or p_destination_order_number is null or length(btrim(p_destination_order_number)) not between 1 and 80
     or btrim(p_source_order_number) = btrim(p_destination_order_number) then
    raise exception 'Las comandas origen y destino no son válidas.' using errcode = '22023';
  end if;
  if p_source_client_item_id is null or length(btrim(p_source_client_item_id)) not between 1 and 160
     or p_destination_client_item_id is null or length(btrim(p_destination_client_item_id)) not between 1 and 160 then
    raise exception 'Los IDs de línea origen y destino no son válidos.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity, 3) then
    raise exception 'La cantidad debe ser positiva y tener como máximo tres decimales.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_source_item_snapshot) <> 'object'
     or p_source_item_snapshot ->> 'id' is distinct from p_source_client_item_id then
    raise exception 'El snapshot de la línea no coincide con el ID origen.' using errcode = '22023';
  end if;

  begin
    v_snapshot_name := nullif(btrim(p_source_item_snapshot ->> 'name'), '');
    v_snapshot_quantity := (p_source_item_snapshot ->> 'quantity')::numeric;
    v_snapshot_price := (p_source_item_snapshot ->> 'price')::numeric;
    v_snapshot_tax_rate := (p_source_item_snapshot ->> 'taxRate')::numeric;
  exception when others then
    raise exception 'El snapshot de producto no contiene nombre, cantidad, precio e impuesto válidos.' using errcode = '22023';
  end;
  if v_snapshot_name is null or v_snapshot_quantity <= 0 or v_snapshot_price < 0 or v_snapshot_tax_rate < 0 then
    raise exception 'El snapshot de producto contiene valores fuera de rango.' using errcode = '22023';
  end if;

  if p_source_item_snapshot ? 'selectedModifiers' then
    v_snapshot_modifiers := p_source_item_snapshot -> 'selectedModifiers';
  else
    v_snapshot_modifiers := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_snapshot_modifiers) <> 'array' then
    raise exception 'Los modificadores del snapshot no son válidos.' using errcode = '22023';
  end if;
  if p_source_item_snapshot ? 'notes' then
    v_snapshot_notes := p_source_item_snapshot ->> 'notes';
  else
    v_snapshot_notes := null;
  end if;
  v_snapshot_station := case
    when p_source_item_snapshot ->> 'category' = 'Bar' then 'Bar'
    when p_source_item_snapshot ->> 'category' = 'Postres' then 'Postres'
    else 'Cocina'
  end;
  v_snapshot_kds_status := coalesce(nullif(p_source_item_snapshot ->> 'kdsStatus', ''), 'PENDING');
  if v_snapshot_kds_status not in ('PENDING', 'IN_PREPARATION', 'READY', 'SERVED') then
    raise exception 'El estado KDS del snapshot no es válido.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'source_order_number', btrim(p_source_order_number),
    'destination_order_number', btrim(p_destination_order_number),
    'source_client_item_id', btrim(p_source_client_item_id),
    'destination_client_item_id', btrim(p_destination_client_item_id),
    'quantity', p_quantity,
    'source_item_snapshot', p_source_item_snapshot
  );

  -- La fila de idempotencia y el resultado se guardan en la misma transacción
  -- que el movimiento. Un conflicto concurrente espera el commit/rollback previo.
  insert into public.pos_order_item_transfer_requests (
    tenant_id, operation_id, actor_user_id, request_payload
  ) values (
    p_tenant_id, btrim(p_operation_id), p_actor_user_id, v_payload
  ) on conflict (tenant_id, operation_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_existing
    from public.pos_order_item_transfer_requests
    where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id)
    for update;
    if not found then
      raise exception 'No se pudo resolver el reintento de traslado.' using errcode = '40001';
    end if;
    if v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.request_payload is distinct from v_payload then
      raise exception 'operation_id ya fue usado con otro actor o payload.' using errcode = '22023';
    end if;
    if v_existing.result is null then
      raise exception 'La operación idempotente anterior no tiene resultado confirmado.' using errcode = '40001';
    end if;
    return v_existing.result || jsonb_build_object('already_applied', true);
  end if;

  v_source_key := 'order:' || p_tenant_id::text || ':' || btrim(p_source_order_number);
  v_destination_key := 'order:' || p_tenant_id::text || ':' || btrim(p_destination_order_number);

  select o.id, o.table_id into v_source_order_id, v_source_table_id
  from public.pos_orders o
  where o.tenant_id = p_tenant_id and o.idempotency_key = v_source_key;
  if not found or v_source_table_id is null then
    raise exception 'No existe una comanda origen de mesa en este tenant.' using errcode = '22023';
  end if;

  select o.id, o.table_id into v_destination_order_id, v_destination_table_id
  from public.pos_orders o
  where o.tenant_id = p_tenant_id and o.idempotency_key = v_destination_key;
  if not found or v_destination_table_id is null then
    raise exception 'No existe una comanda destino de mesa en este tenant.' using errcode = '22023';
  end if;
  if v_source_order_id = v_destination_order_id or v_source_table_id = v_destination_table_id then
    raise exception 'Origen y destino deben ser comandas de mesas distintas.' using errcode = '22023';
  end if;

  -- Tomar locks de mesa antes que de orden, siguiendo el orden de syncTable
  -- (mesa y luego orden), y siempre ordenados para reducir deadlocks.
  perform t.id
  from public.pos_tables t
  where t.tenant_id = p_tenant_id and t.id in (v_source_table_id, v_destination_table_id)
  order by t.id
  for update;
  get diagnostics v_locked = row_count;
  if v_locked <> 2 then
    raise exception 'Una de las mesas ya no existe en este tenant.' using errcode = '22023';
  end if;

  perform o.id
  from public.pos_orders o
  where o.tenant_id = p_tenant_id and o.id in (v_source_order_id, v_destination_order_id)
  order by o.id
  for update;
  get diagnostics v_locked = row_count;
  if v_locked <> 2 then
    raise exception 'Una de las comandas cambió durante el traslado.' using errcode = '40001';
  end if;

  select * into v_source_order
  from public.pos_orders o
  where o.id = v_source_order_id and o.tenant_id = p_tenant_id;
  select * into v_destination_order
  from public.pos_orders o
  where o.id = v_destination_order_id and o.tenant_id = p_tenant_id;
  if v_source_order.table_id is distinct from v_source_table_id
     or v_destination_order.table_id is distinct from v_destination_table_id then
    raise exception 'La mesa asociada a una comanda cambió; vuelve a sincronizar.' using errcode = '40001';
  end if;
  if v_source_order.status in ('CLOSED', 'CANCELLED')
     or v_destination_order.status in ('CLOSED', 'CANCELLED') then
    raise exception 'No se puede trasladar a o desde una comanda cerrada.' using errcode = '22023';
  end if;

  select * into v_source_table
  from public.pos_tables t
  where t.id = v_source_table_id and t.tenant_id = p_tenant_id;
  select * into v_destination_table
  from public.pos_tables t
  where t.id = v_destination_table_id and t.tenant_id = p_tenant_id;
  if v_source_table.branch_id is distinct from v_destination_table.branch_id then
    raise exception 'El traslado debe permanecer en la misma sucursal.' using errcode = '22023';
  end if;
  if v_source_table.status not in ('OCCUPIED', 'PRE_CHECK')
     or v_destination_table.status not in ('OCCUPIED', 'PRE_CHECK') then
    raise exception 'Las dos mesas deben conservar una comanda activa.' using errcode = '22023';
  end if;

  -- El snapshot evita mover una fila si el cliente está desactualizado. Las
  -- filas legadas con client_item_id NULL solo se aceptan si hay una única
  -- coincidencia exacta; las ambiguas se rechazan sin tocar la comanda.
  select count(*) into v_match_count
  from public.pos_order_items i
  where i.tenant_id = p_tenant_id
    and i.order_id = v_source_order_id
    and (i.client_item_id = btrim(p_source_client_item_id) or i.client_item_id is null)
    and i.name_snapshot = v_snapshot_name
    and i.quantity = v_snapshot_quantity
    and i.unit_price = v_snapshot_price
    and i.tax_rate = v_snapshot_tax_rate
    and i.notes is not distinct from v_snapshot_notes
    and i.modifiers = v_snapshot_modifiers
    and i.station = v_snapshot_station
    and i.kds_status = v_snapshot_kds_status;
  if v_match_count <> 1 then
    raise exception 'La línea cambió o no se puede identificar de forma única; sincroniza y vuelve a intentar.' using errcode = '22023';
  end if;

  select * into v_source_item
  from public.pos_order_items i
  where i.tenant_id = p_tenant_id
    and i.order_id = v_source_order_id
    and (i.client_item_id = btrim(p_source_client_item_id) or i.client_item_id is null)
    and i.name_snapshot = v_snapshot_name
    and i.quantity = v_snapshot_quantity
    and i.unit_price = v_snapshot_price
    and i.tax_rate = v_snapshot_tax_rate
    and i.notes is not distinct from v_snapshot_notes
    and i.modifiers = v_snapshot_modifiers
    and i.station = v_snapshot_station
    and i.kds_status = v_snapshot_kds_status
  order by i.id
  limit 1
  for update;

  if v_source_item.client_item_id is null then
    update public.pos_order_items
    set client_item_id = btrim(p_source_client_item_id)
    where id = v_source_item.id and tenant_id = p_tenant_id and order_id = v_source_order_id
    returning * into v_source_item;
  end if;
  if p_quantity > v_source_item.quantity then
    raise exception 'La cantidad solicitada supera la cantidad disponible.' using errcode = '22023';
  end if;

  if p_quantity = v_source_item.quantity then
    if btrim(p_destination_client_item_id) <> btrim(p_source_client_item_id) then
      raise exception 'Un traslado completo debe conservar el ID estable de la línea.' using errcode = '22023';
    end if;
    update public.pos_order_items
    set order_id = v_destination_order_id
    where id = v_source_item.id and tenant_id = p_tenant_id and order_id = v_source_order_id
    returning * into v_moved_item;
  else
    if btrim(p_destination_client_item_id) = btrim(p_source_client_item_id) then
      raise exception 'Un traslado parcial requiere un ID nuevo para la línea destino.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.pos_order_items i
      where i.tenant_id = p_tenant_id
        and i.order_id = v_destination_order_id
        and i.client_item_id = btrim(p_destination_client_item_id)
    ) then
      raise exception 'El ID de línea destino ya existe en esa comanda.' using errcode = '23505';
    end if;

    update public.pos_order_items
    set quantity = quantity - p_quantity
    where id = v_source_item.id and tenant_id = p_tenant_id and order_id = v_source_order_id
    returning * into v_updated_source_item;

    insert into public.pos_order_items (
      tenant_id, order_id, menu_item_id, client_item_id, name_snapshot,
      quantity, unit_price, tax_rate, modifiers, notes, station, kds_status
    ) values (
      v_updated_source_item.tenant_id,
      v_destination_order_id,
      v_updated_source_item.menu_item_id,
      btrim(p_destination_client_item_id),
      v_updated_source_item.name_snapshot,
      p_quantity,
      v_updated_source_item.unit_price,
      v_updated_source_item.tax_rate,
      v_updated_source_item.modifiers,
      v_updated_source_item.notes,
      v_updated_source_item.station,
      v_updated_source_item.kds_status
    ) returning * into v_moved_item;
  end if;

  v_result := jsonb_build_object(
    'source_order_id', v_source_order_id,
    'destination_order_id', v_destination_order_id,
    'source_item_row_id', v_source_item.id,
    'destination_item_row_id', v_moved_item.id,
    'source_client_item_id', btrim(p_source_client_item_id),
    'destination_client_item_id', btrim(p_destination_client_item_id),
    'quantity', p_quantity,
    'already_applied', false
  );

  -- Audit y ledger participan en la misma transacción que el cambio de líneas.
  -- Un error aquí también revierte origen y destino.
  insert into public.pos_audit_events (
    tenant_id, branch_id, actor_user_id, action, entity_type, entity_id,
    request_id, metadata
  ) values (
    p_tenant_id,
    v_source_table.branch_id,
    p_actor_user_id,
    'TRANSFER_ORDER_ITEM',
    'ORDER_ITEM_TRANSFER',
    v_moved_item.id::text,
    btrim(p_operation_id),
    v_result
  );

  update public.pos_order_item_transfer_requests
  set result = v_result
  where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);

  return v_result;
end;
$$;

revoke all on function public.transfer_pos_order_item(uuid, text, uuid, text, text, text, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.transfer_pos_order_item(uuid, text, uuid, text, text, text, text, numeric, jsonb)
  to service_role;
