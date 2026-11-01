-- PRUEBA DE INTEGRACIÓN NO EJECUTADA.
-- Requiere aplicar atomic-order-item-transfer.sql solo en una base PostgreSQL desechable.
-- Ejecutar con psql -v ON_ERROR_STOP=1; todos los fixtures terminan en ROLLBACK.

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
  v_register_id uuid := gen_random_uuid();
  v_shift_cloud_id uuid;
  v_register_legacy_id text := 'test-register-' || replace(gen_random_uuid()::text, '-', '');
  v_shift_legacy_id text := 'test-shift-' || replace(gen_random_uuid()::text, '-', '');
  v_shift_payload jsonb;
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
  v_sync_payload jsonb;
  v_qty numeric;
  v_revision integer;
  v_order_status text;
  v_count integer;
  v_failed boolean;
begin
  insert into public.pos_branches (id, tenant_id, name, code)
  values (v_branch_id, v_tenant_id, 'Atomic transfer test', 'TST');

  insert into public.pos_cash_registers (
    id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering,
    is_active, linked_zones, legacy_id
  ) values (
    v_register_id, v_tenant_id, v_branch_id, 'Caja test', '98101', true, true,
    true, '[]'::jsonb, v_register_legacy_id
  );

  v_shift_payload := jsonb_build_object(
      'shiftId', v_shift_legacy_id, 'cashRegisterId', v_register_legacy_id,
      'status', 'OPEN', 'shiftNumber', 1, 'openedAt', now(),
      'initialFloat', 5000, 'expectedCash', 5000, 'notes', '',
      'linkedZones', jsonb_build_array('Test'),
      'participants', jsonb_build_array(jsonb_build_object('userId', v_actor_id::text, 'userName', 'Prueba', 'userRole', 'ADMIN')),
      'movements', '[]'::jsonb, 'systemSummary', jsonb_build_object('expectedCashInDrawer', 5000)
    );
  v_result := public.sync_pos_cash_shift(
    v_tenant_id, 'test-open-shift', v_actor_id, null, 'OPEN',
    v_shift_legacy_id, v_register_legacy_id, v_shift_payload
  );
  v_shift_cloud_id := (v_result ->> 'shiftId')::uuid;
  if v_shift_cloud_id is null or v_result ->> 'status' <> 'OPEN' then
    raise exception 'la RPC debe abrir y devolver un turno central';
  end if;
  v_result := public.sync_pos_cash_shift(
    v_tenant_id, 'test-open-shift', v_actor_id, null, 'OPEN',
    v_shift_legacy_id, v_register_legacy_id, v_shift_payload
  );
  if not coalesce((v_result ->> 'alreadyApplied')::boolean, false) then
    raise exception 'el replay de apertura debe ser idempotente';
  end if;

  insert into public.pos_tables (id, tenant_id, branch_id, name, table_number, zone, status)
  values
    (v_source_table_id, v_tenant_id, v_branch_id, 'Mesa test origen', 981, 'Test', 'OCCUPIED'),
    (v_destination_table_id, v_tenant_id, v_branch_id, 'Mesa test destino', 982, 'Test', 'OCCUPIED');

  insert into public.pos_orders (
    id, tenant_id, branch_id, table_id, order_number, status, service_type,
    opened_by, server_name, idempotency_key, cloud_revision
  ) values
    (v_source_order_id, v_tenant_id, v_branch_id, v_source_table_id, v_source_order_number,
      'IN_PREPARATION', 'DINE_IN', v_actor_id, 'Prueba', 'order:' || v_tenant_id::text || ':' || v_source_order_number, 0),
    (v_destination_order_id, v_tenant_id, v_branch_id, v_destination_table_id, v_destination_order_number,
      'READY', 'DINE_IN', v_actor_id, 'Prueba', 'order:' || v_tenant_id::text || ':' || v_destination_order_number, 0);

  -- Línea histórica sin client_item_id; se vinculará solo con snapshot único.
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

  -- La RPC valida en servidor la zona destino contra el snapshot del turno.
  update public.pos_tables set zone = 'Fuera del turno' where id = v_destination_table_id;
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-zone-rejected', v_actor_id, null,
      v_shift_cloud_id, v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'zone-rejected-line', 1, 0, 0, v_snapshot_partial
    );
  exception when sqlstate '22023' then
    if position('zona' in lower(sqlerrm)) > 0 then v_failed := true; else raise; end if;
  end;
  if not v_failed then raise exception 'se aceptó una mesa destino fuera de las zonas del turno'; end if;
  update public.pos_tables set zone = 'Test' where id = v_destination_table_id;

  -- Turno histórico sin linked_zones: el fallback de servidor usa las zonas de la caja.
  update public.pos_cash_shifts set linked_zones = null where id = v_shift_cloud_id;
  update public.pos_cash_registers set linked_zones = '["Test"]'::jsonb where id = v_register_id;
  update public.pos_tables set zone = 'Fuera de la caja' where id = v_destination_table_id;
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-register-zone-fallback', v_actor_id, null,
      v_shift_cloud_id, v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'register-zone-rejected-line', 1, 0, 0, v_snapshot_partial
    );
  exception when sqlstate '22023' then
    if position('zona' in lower(sqlerrm)) > 0 then v_failed := true; else raise; end if;
  end;
  if not v_failed then raise exception 'se aceptó una mesa fuera de las zonas de la caja para un turno histórico'; end if;
  update public.pos_tables set zone = 'Test' where id = v_destination_table_id;
  update public.pos_cash_shifts set linked_zones = '["Test"]'::jsonb where id = v_shift_cloud_id;
  update public.pos_cash_registers set linked_zones = '[]'::jsonb where id = v_register_id;

  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-partial-transfer', v_actor_id, null,
    v_shift_cloud_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-partial', 'partial-destination-line', 2, 0, 0, v_snapshot_partial
  );
  if coalesce((v_result ->> 'alreadyApplied')::boolean, true) then
    raise exception 'la primera ejecución no debe ser un replay';
  end if;
  if (v_result ->> 'sourceRevision')::integer <> 1 or (v_result ->> 'destinationRevision')::integer <> 1 then
    raise exception 'el traslado debe incrementar ambas revisiones exactamente una vez';
  end if;

  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then raise exception 'cantidad origen incorrecta tras traslado parcial: %', v_qty; end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'partial-destination-line' and quantity = 2;
  if v_count <> 1 then raise exception 'debe existir exactamente una línea destino parcial'; end if;

  -- Replay ambiguo devuelve el mismo resultado y no mueve producto ni revisiones otra vez.
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-partial-transfer', v_actor_id, null,
    v_shift_cloud_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-partial', 'partial-destination-line', 2, 0, 0, v_snapshot_partial
  );
  if not coalesce((v_result ->> 'alreadyApplied')::boolean, false) then
    raise exception 'el replay debe indicar alreadyApplied';
  end if;
  select cloud_revision into v_revision from public.pos_orders where id = v_source_order_id;
  if v_revision <> 1 then raise exception 'el replay incrementó la revisión origen'; end if;
  select quantity into v_qty
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then raise exception 'el replay alteró la cantidad origen'; end if;
  select count(*) into v_count
  from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id and client_item_id = 'partial-destination-line';
  if v_count <> 1 then raise exception 'el replay duplicó la línea destino'; end if;

  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-partial-transfer', v_actor_id, null,
    v_shift_cloud_id,
      v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'partial-destination-line', 1, 0, 0, v_snapshot_partial
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'se aceptó una clave idempotente con payload distinto'; end if;

  -- Una escritura UPDATE_TABLE con revisión 0 llega después del traslado (revisión 1).
  -- Aunque lleve un snapshot antiguo con cantidad 5, debe fallar antes de borrar/reinsertar.
  v_sync_payload := jsonb_build_object(
    'branch_id', v_branch_id,
    'scope', jsonb_build_object('cash_register_id', v_register_id, 'cash_shift_id', v_shift_cloud_id, 'terminal_id', null),
    'table', jsonb_build_object(
      'table_id', v_source_table_id, 'table_number', 981, 'name', 'Mesa test origen',
      'zone', 'Test', 'seats', 2, 'status', 'OCCUPIED',
      'position', jsonb_build_object('x', 20, 'y', 20, 'rotation', 0, 'shape', 'square')
    ),
    'order', jsonb_build_object(
      'order_number', v_source_order_number, 'expected_revision', 0, 'server_name', 'Prueba',
      'opened_at', now(), 'service_type', 'DINE_IN',
      'items', jsonb_build_array(jsonb_build_object(
        'client_item_id', 'legacy-line-partial', 'menu_item_id', null,
        'name_snapshot', 'Producto parcial', 'quantity', 5, 'unit_price', 12.50,
        'tax_rate', 0.13, 'modifiers', '[]'::jsonb, 'notes', null,
        'station', 'Cocina', 'kds_status', 'PENDING'
      ))
    )
  );
  v_failed := false;
  begin
    perform public.sync_pos_table_order(v_tenant_id, 'test-stale-table-save', v_actor_id, null, v_sync_payload);
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'UPDATE_TABLE obsoleto no se rechazó'; end if;
  select quantity into v_qty from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then raise exception 'el snapshot obsoleto reintrodujo el producto en origen'; end if;
  select count(*) into v_count from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id and client_item_id = 'partial-destination-line';
  if v_count <> 1 then raise exception 'el snapshot obsoleto borró el producto destino'; end if;
  select count(*) into v_count from public.pos_order_sync_requests
  where tenant_id = v_tenant_id and operation_id = 'test-stale-table-save';
  if v_count <> 0 then raise exception 'el intento stale dejó un ledger confirmado'; end if;

  -- Simula dos escritores que leyeron revision 1: gana el primero y el segundo
  -- debe esperar el lock y perder la comparación CAS, igual que en la carrera real.
  v_sync_payload := jsonb_set(v_sync_payload, '{order,expected_revision}', '1'::jsonb);
  v_sync_payload := jsonb_set(v_sync_payload, '{order,items,0,quantity}', '3'::jsonb);
  v_result := public.sync_pos_table_order(v_tenant_id, 'test-writer-wins', v_actor_id, null, v_sync_payload);
  if (v_result ->> 'cloudRevision')::integer <> 2 then raise exception 'el ganador CAS no dejó revisión 2'; end if;
  select status into v_order_status from public.pos_orders where id = v_source_order_id;
  if v_order_status <> 'IN_PREPARATION' then raise exception 'UPDATE_TABLE revirtió el estado de cocina a %', v_order_status; end if;
  v_sync_payload := jsonb_set(v_sync_payload, '{order,items,0,quantity}', '2'::jsonb);
  v_failed := false;
  begin
    perform public.sync_pos_table_order(v_tenant_id, 'test-writer-stale', v_actor_id, null, v_sync_payload);
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'el segundo escritor con revisión 1 no se rechazó'; end if;
  select quantity into v_qty from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id and client_item_id = 'legacy-line-partial';
  if v_qty is distinct from 3::numeric then raise exception 'el escritor stale sobrescribió las líneas del ganador'; end if;
  select cloud_revision into v_revision from public.pos_orders where id = v_source_order_id;
  if v_revision <> 2 then raise exception 'el escritor stale alteró la revisión'; end if;

  -- Un replay del guardado confirmado devuelve la misma revisión y no vuelve a incrementar.
  v_sync_payload := jsonb_set(v_sync_payload, '{order,expected_revision}', '2'::jsonb);
  v_sync_payload := jsonb_set(v_sync_payload, '{order,items,0,quantity}', '3'::jsonb);
  v_result := public.sync_pos_table_order(v_tenant_id, 'test-sync-replay', v_actor_id, null, v_sync_payload);
  if (v_result ->> 'cloudRevision')::integer <> 3 then raise exception 'el guardado no incrementó la revisión esperada'; end if;
  v_result := public.sync_pos_table_order(v_tenant_id, 'test-sync-replay', v_actor_id, null, v_sync_payload);
  if not coalesce((v_result ->> 'alreadyApplied')::boolean, false)
     or (v_result ->> 'cloudRevision')::integer <> 3 then
    raise exception 'el replay del guardado no devolvió el mismo resultado';
  end if;

  -- Un traslado con revisión fuente antigua tampoco puede cambiar la pareja de órdenes.
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-stale-transfer', v_actor_id, null,
    v_shift_cloud_id,
      v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'stale-destination-line', 1, 2, 1, v_snapshot_partial
    );
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'el traslado con revisión obsoleta no se rechazó'; end if;
  select count(*) into v_count from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id and client_item_id = 'stale-destination-line';
  if v_count <> 0 then raise exception 'el traslado stale dejó una línea destino'; end if;

  -- Fallo inyectado después de modificar origen, antes de insertar destino: todo
  -- el cambio, las revisiones, el ledger y la auditoría deben hacer rollback.
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
      v_tenant_id, 'test-failed-then-retry', v_actor_id, null,
    v_shift_cloud_id,
      v_source_order_number, v_destination_order_number,
      'legacy-line-failure', 'failure-destination-line', 2, 3, 1, v_snapshot_failure
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'no se disparó el fallo inyectado'; end if;
  select quantity into v_qty from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id
    and client_item_id is null and name_snapshot = 'Producto con fallo';
  if v_qty is distinct from 4::numeric then raise exception 'fallo parcial dejó cantidad origen inconsistente: %', v_qty; end if;
  select cloud_revision into v_revision from public.pos_orders where id = v_source_order_id;
  if v_revision <> 3 then raise exception 'fallo parcial incrementó revisión origen'; end if;
  select count(*) into v_count from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id and client_item_id = 'failure-destination-line';
  if v_count <> 0 then raise exception 'fallo parcial dejó línea destino'; end if;
  select count(*) into v_count from public.pos_order_item_transfer_requests
  where tenant_id = v_tenant_id and operation_id = 'test-failed-then-retry';
  if v_count <> 0 then raise exception 'fallo parcial dejó ledger de traslado confirmado'; end if;
  select count(*) into v_count from public.pos_audit_events
  where tenant_id = v_tenant_id and request_id = 'test-failed-then-retry';
  if v_count <> 0 then raise exception 'fallo parcial dejó auditoría de traslado no confirmado'; end if;

  execute 'drop trigger __pos_transfer_test_fail_before_dest_insert on public.pos_order_items';
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-failed-then-retry', v_actor_id, null,
    v_shift_cloud_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-failure', 'failure-destination-line', 2, 3, 1, v_snapshot_failure
  );
  if coalesce((v_result ->> 'alreadyApplied')::boolean, true) then raise exception 'el retry tras rollback no debe ser replay'; end if;
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-failed-then-retry', v_actor_id, null,
    v_shift_cloud_id,
    v_source_order_number, v_destination_order_number,
    'legacy-line-failure', 'failure-destination-line', 2, 3, 1, v_snapshot_failure
  );
  if not coalesce((v_result ->> 'alreadyApplied')::boolean, false) then raise exception 'el retry confirmado debe ser idempotente'; end if;
  select quantity into v_qty from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_source_order_id and client_item_id = 'legacy-line-failure';
  if v_qty is distinct from 2::numeric then raise exception 'cantidad origen incorrecta tras retry'; end if;
  select count(*) into v_count from public.pos_order_items
  where tenant_id = v_tenant_id and order_id = v_destination_order_id
    and client_item_id = 'failure-destination-line' and quantity = 2;
  if v_count <> 1 then raise exception 'retry debe crear una sola línea destino'; end if;
  select count(*) into v_count from public.pos_order_item_transfer_requests
  where tenant_id = v_tenant_id and operation_id = 'test-failed-then-retry';
  if v_count <> 1 then raise exception 'ledger exitoso debe contener una sola operación'; end if;
  select count(*) into v_count from public.pos_audit_events
  where tenant_id = v_tenant_id and request_id = 'test-failed-then-retry';
  if v_count <> 1 then raise exception 'auditoría exitosa debe contener una sola operación'; end if;

  -- Cerrar centralmente el turno y asegurar que la RPC rechaza cualquier nuevo traslado.
  v_result := public.sync_pos_cash_shift(
    v_tenant_id, 'test-close-shift', v_actor_id, null, 'CLOSE',
    v_shift_legacy_id, v_register_legacy_id,
    jsonb_build_object(
      'shiftId', v_shift_legacy_id, 'cashRegisterId', v_register_legacy_id,
      'status', 'CLOSED', 'shiftNumber', 1, 'openedAt', now(), 'closedAt', now(),
      'initialFloat', 5000, 'expectedCash', 5000, 'countedCash', 5000,
      'countedCards', 0, 'countedSinpe', 0, 'difference', 0, 'notes', '',
      'linkedZones', jsonb_build_array('Test'), 'participants', '[]'::jsonb,
      'movements', '[]'::jsonb, 'systemSummary', jsonb_build_object('expectedCashInDrawer', 5000),
      'cashBreakdown', null, 'dataphonesBreakdown', null, 'differenceReason', '', 'zReportGenerated', true
    )
  );
  if v_result ->> 'status' <> 'CLOSED' then raise exception 'el cierre debe persistir estado CLOSED'; end if;
  v_result := public.transfer_pos_order_item(
    v_tenant_id, 'test-partial-transfer', v_actor_id, null,
    v_shift_cloud_id, v_source_order_number, v_destination_order_number,
    'legacy-line-partial', 'partial-destination-line', 2, 0, 0, v_snapshot_partial
  );
  if not coalesce((v_result ->> 'alreadyApplied')::boolean, false) then
    raise exception 'un replay confirmado debe seguir siendo idempotente tras cerrar el turno';
  end if;
  v_failed := false;
  begin
    perform public.transfer_pos_order_item(
      v_tenant_id, 'test-after-close-transfer', v_actor_id, null,
      v_shift_cloud_id, v_source_order_number, v_destination_order_number,
      'legacy-line-partial', 'closed-shift-line', 1, 4, 2, v_snapshot_partial
    );
  exception when sqlstate '22023' then
    if position('CASH_SHIFT_NOT_OPEN' in sqlerrm) > 0 then v_failed := true; else raise; end if;
  end;
  if not v_failed then raise exception 'se aceptó un traslado después del cierre del turno'; end if;

  -- Un cambio de estado externo invalida snapshots anteriores.
  update public.pos_orders set status = 'CLOSED' where id = v_source_order_id;
  select cloud_revision into v_revision from public.pos_orders where id = v_source_order_id;
  if v_revision <> 5 then raise exception 'cierre debe incrementar revisión de 4 a 5'; end if;
  v_sync_payload := jsonb_set(v_sync_payload, '{order,expected_revision}', '4'::jsonb);
  v_failed := false;
  begin
    perform public.sync_pos_table_order(v_tenant_id, 'test-stale-after-close', v_actor_id, null, v_sync_payload);
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'un snapshot anterior al cierre no se rechazó'; end if;
end;
$$;

drop trigger if exists __pos_transfer_test_fail_before_dest_insert on public.pos_order_items;
drop function if exists public.__pos_transfer_test_fail_before_dest_insert();
rollback;
