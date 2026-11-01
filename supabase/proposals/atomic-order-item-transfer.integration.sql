-- PRUEBA NO EJECUTADA.
-- Requiere aplicar atomic-order-item-transfer.sql en una base Supabase desechable.
-- Ejecútese allí con psql y ON_ERROR_STOP; todo el fixture termina en ROLLBACK.

begin;

create or replace function public.__pos_transfer_test_fail_before_dest_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.order_id::text = current_setting('pos_test.transfer_fail_order', true) then
    raise exception 'fallo inyectado antes de insertar la línea destino';
  end if;
  return new;
end;
$function$;

drop trigger if exists __pos_transfer_test_fail_before_dest_insert on public.pos_order_items;
create trigger __pos_transfer_test_fail_before_dest_insert
before insert on public.pos_order_items
for each row execute function public.__pos_transfer_test_fail_before_dest_insert();

do $$
declare
  v_tenant_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_source_table_id uuid := gen_random_uuid();
  v_destination_table_id uuid := gen_random_uuid();
  v_source_order_id uuid := gen_random_uuid();
  v_destination_order_id uuid := gen_random_uuid();
  v_actor_id uuid := gen_random_uuid();
  v_source_order_number text := 'TEST-S-' || replace(gen_random_uuid()::text, '-', '');
  v_destination_order_number text := 'TEST-D-' || replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_snapshot_partial jsonb;
  v_snapshot_failure jsonb;
  v_qty numeric;
  v_count integer;
  v_failed boolean;
begin
  insert into public.pos_branches (id, tenant_id, name, code)
  values (v_branch_id, v_tenant_id, 'Atomic transfer test', 'TST');

  insert into public.pos_tables (id, tenant_id, branch_id, name, table_number, zone, status)
  values
    (v_source_table_id, v_tenant_id, v_branch_id, 'Mesa test origen', 981, 'Test', 'OCCUPIED'),
    (v_destination_table_id, v_tenant_id, v_branch_id, 'Mesa test destino', 982, 'Test', 'OCCUPIED');

  insert into public.pos_orders (
    id, tenant_id, branch_id, table_id, order_number, status, service_type,
    opened_by, server_name, idempotency_key
  ) values
    (v_source_order_id, v_tenant_id, v_branch_id, v_source_table_id, v_source_order_number,
      'OPEN', 'DINE_IN', v_actor_id, 'Prueba', 'order:' || v_tenant_id::text || ':' || v_source_order_number),
    (v_destination_order_id, v_tenant_id, v_branch_id, v_destination_table_id, v_destination_order_number,
      'OPEN', 'DINE_IN', v_actor_id, 'Prueba', 'order:' || v_tenant_id::text || ':' || v_destination_order_number);

  -- Línea histórica sin client_item_id; la RPC debe vincularla únicamente
  -- porque el snapshot coincide con una sola fila.
  insert into public.pos_order_items (
    tenant_id, order_id, name_snapshot, quantity, unit_price, tax_rate,
    modifiers, notes, station, kds_status
  ) values (
    v_tenant_id, v_source_order_id, 'Producto parcial', 5, 12.50, 0.13,
    '[]'::jsonb, null, 'Cocina', 'PENDING'
  );

  v_snapshot_partial := jsonb_build_object(
    'id', 'legacy-line-partial', 'name', 'Producto parcial', 'quantity', 5,
    'price', 12.50, 'taxRate', 0.13, 'category', 'Comida',
    'selectedModifiers', '[]'::jsonb, 'notes', null, 'kdsStatus', 'PENDING'
  );

  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-partial-transfer', v_actor_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-partial', 'partial-destination-line', 2, v_snapshot_partial
  );
  if coalesce((v_result ->> 'already_applied')::boolean, true) then
    raise exception 'la primera ejecución no debe ser un replay';
  end if;

  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id
    and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then
    raise exception 'cantidad origen incorrecta después del traslado parcial: %', v_qty;
  end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'partial-destination-line' and quantity = 2;
  if v_count <> 1 then raise exception 'debe existir exactamente una línea destino parcial'; end if;

  -- Simula que el servidor confirmó y la respuesta se perdió: mismo ID/payload
  -- devuelve resultado existente y no vuelve a mover cantidad.
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-partial-transfer', v_actor_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-partial', 'partial-destination-line', 2, v_snapshot_partial
  );
  if not coalesce((v_result ->> 'already_applied')::boolean, false) then
    raise exception 'el replay debe indicar already_applied';
  end if;
  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id
    and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then raise exception 'el replay alteró la cantidad origen'; end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'partial-destination-line';
  if v_count <> 1 then raise exception 'el replay duplicó la línea destino'; end if;

  -- La misma clave con otro payload se rechaza, sin modificar ninguna cantidad.
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-partial-transfer', v_actor_id,
      v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'partial-destination-line', 1, v_snapshot_partial
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'se aceptó una clave idempotente con payload distinto'; end if;

  -- Preparar un segundo caso para forzar una falla después del UPDATE de origen
  -- y antes del INSERT destino. La función y el fixture usan el mismo tenant.
  insert into public.pos_order_items (
    tenant_id, order_id, name_snapshot, quantity, unit_price, tax_rate,
    modifiers, notes, station, kds_status
  ) values (
    v_tenant_id, v_source_order_id, 'Producto con fallo', 4, 8.00, 0.13,
    '[]'::jsonb, null, 'Cocina', 'PENDING'
  );
  v_snapshot_failure := jsonb_build_object(
    'id', 'legacy-line-failure', 'name', 'Producto con fallo', 'quantity', 4,
    'price', 8.00, 'taxRate', 0.13, 'category', 'Comida',
    'selectedModifiers', '[]'::jsonb, 'notes', null, 'kdsStatus', 'PENDING'
  );

  perform set_config('pos_test.transfer_fail_order', v_destination_order_id::text, true);
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-failed-then-retry', v_actor_id,
      v_source_order_number, v_destination_order_number,
      'legacy-line-failure', 'failure-destination-line', 2, v_snapshot_failure
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'no se disparó el fallo inyectado'; end if;

  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id
    and client_item_id is null and name_snapshot = 'Producto con fallo';
  if v_qty is distinct from 4::numeric then
    raise exception 'fallo parcial dejó la cantidad origen en estado inconsistente: %', v_qty;
  end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'failure-destination-line';
  if v_count <> 0 then raise exception 'fallo parcial dejó una línea destino'; end if;
  select count(*) into v_count
  from public.pos_order_item_transfer_requests
  where tenant_id = v_tenant_id and operation_id = 'test-failed-then-retry';
  if v_count <> 0 then raise exception 'fallo parcial dejó un ledger idempotente confirmado'; end if;
  select count(*) into v_count
  from public.pos_audit_events
  where tenant_id = v_tenant_id and request_id = 'test-failed-then-retry';
  if v_count <> 0 then raise exception 'fallo parcial dejó auditoría de un traslado no confirmado'; end if;

  execute 'drop trigger __pos_transfer_test_fail_before_dest_insert on public.pos_order_items';

  -- Mismo operation_id tras rollback: ahora se aplica una sola vez.
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-failed-then-retry', v_actor_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-failure', 'failure-destination-line', 2, v_snapshot_failure
  );
  if coalesce((v_result ->> 'already_applied')::boolean, true) then
    raise exception 'el reintento posterior al rollback no debe ser un replay';
  end if;
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-failed-then-retry', v_actor_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-failure', 'failure-destination-line', 2, v_snapshot_failure
  );
  if not coalesce((v_result ->> 'already_applied')::boolean, false) then
    raise exception 'el segundo reintento debe ser un replay idempotente';
  end if;

  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id
    and client_item_id = 'legacy-line-failure';
  if v_qty is distinct from 2::numeric then raise exception 'cantidad origen incorrecta tras reintento'; end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'failure-destination-line' and quantity = 2;
  if v_count <> 1 then raise exception 'reintento debe crear exactamente una línea destino'; end if;
  select count(*) into v_count
  from public.pos_order_item_transfer_requests
  where tenant_id = v_tenant_id and operation_id = 'test-failed-then-retry';
  if v_count <> 1 then raise exception 'ledger de éxito debe contener una sola operación'; end if;
  select count(*) into v_count
  from public.pos_audit_events
  where tenant_id = v_tenant_id and request_id = 'test-failed-then-retry';
  if v_count <> 1 then raise exception 'auditoría de éxito debe contener una sola operación'; end if;
end;
$$;

rollback;
