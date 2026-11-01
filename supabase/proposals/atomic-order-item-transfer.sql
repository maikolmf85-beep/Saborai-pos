-- PROPUESTA LOCAL NO APLICADA.
-- No copiar a supabase/migrations ni ejecutar contra Supabase sin aprobación explícita.
-- Requiere las migraciones POS existentes, incluidas columnas operativas y actor_employee_id.
--
-- El objetivo es que UPDATE_TABLE y TRANSFER_TABLE_ITEM tengan el mismo orden de locks,
-- usen una revisión CAS por orden y escriban líneas/auditoría/ledger dentro de una transacción.

alter table public.pos_order_items
  add column if not exists client_item_id text;

alter table public.pos_order_items
  drop constraint if exists pos_order_items_client_item_id_check;
alter table public.pos_order_items
  add constraint pos_order_items_client_item_id_check
  check (client_item_id is null or length(btrim(client_item_id)) between 1 and 160);

create unique index if not exists pos_order_items_client_item_id_uidx
  on public.pos_order_items (tenant_id, order_id, client_item_id)
  where client_item_id is not null;

alter table public.pos_orders
  add column if not exists cloud_revision integer not null default 0;

alter table public.pos_orders
  drop constraint if exists pos_orders_cloud_revision_check;
alter table public.pos_orders
  add constraint pos_orders_cloud_revision_check check (cloud_revision >= 0);

-- Cambios de estado existentes (por ejemplo, el cierre de pago) invalidan los
-- snapshots previos. Las RPC de orden/traslado incrementan explícitamente la
-- revisión por cada cambio de contenido; este trigger cubre solo el estado.
create or replace function public.bump_pos_order_revision_on_status_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    new.cloud_revision := old.cloud_revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_pos_order_revision_on_status_change() from public, anon, authenticated;
grant execute on function public.bump_pos_order_revision_on_status_change() to service_role;
drop trigger if exists pos_orders_bump_revision_on_status_change on public.pos_orders;
create trigger pos_orders_bump_revision_on_status_change
before update of status on public.pos_orders
for each row execute function public.bump_pos_order_revision_on_status_change();

create table if not exists public.pos_order_sync_requests (
  tenant_id uuid not null,
  operation_id text not null,
  actor_user_id uuid not null,
  request_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  constraint pos_order_sync_requests_pk primary key (tenant_id, operation_id),
  constraint pos_order_sync_requests_operation_id_check check (length(btrim(operation_id)) between 1 and 160),
  constraint pos_order_sync_requests_payload_check check (jsonb_typeof(request_payload) = 'object'),
  constraint pos_order_sync_requests_result_check check (result is null or jsonb_typeof(result) = 'object')
);

alter table public.pos_order_sync_requests enable row level security;
revoke all on table public.pos_order_sync_requests from public, anon, authenticated;
grant all on table public.pos_order_sync_requests to service_role;

create table if not exists public.pos_order_item_transfer_requests (
  tenant_id uuid not null,
  operation_id text not null,
  actor_user_id uuid not null,
  request_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  constraint pos_order_item_transfer_requests_pk primary key (tenant_id, operation_id),
  constraint pos_order_item_transfer_requests_operation_id_check check (length(btrim(operation_id)) between 1 and 160),
  constraint pos_order_item_transfer_requests_payload_check check (jsonb_typeof(request_payload) = 'object'),
  constraint pos_order_item_transfer_requests_result_check check (result is null or jsonb_typeof(result) = 'object')
);

alter table public.pos_order_item_transfer_requests enable row level security;
revoke all on table public.pos_order_item_transfer_requests from public, anon, authenticated;
grant all on table public.pos_order_item_transfer_requests to service_role;

create or replace function public.sync_pos_table_order(
  p_tenant_id uuid,
  p_operation_id text,
  p_actor_user_id uuid,
  p_actor_employee_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.pos_order_sync_requests%rowtype;
  v_inserted integer;
  v_table_payload jsonb;
  v_order_payload jsonb;
  v_scope jsonb;
  v_branch_id uuid;
  v_cash_register_id uuid;
  v_cash_shift_id uuid;
  v_terminal_id uuid;
  v_table_input_id uuid;
  v_table_id uuid;
  v_table_number integer;
  v_table_count integer;
  v_name text;
  v_zone text;
  v_seats integer;
  v_status text;
  v_position jsonb;
  v_order_number text;
  v_order_key text;
  v_expected_revision integer;
  v_current_revision integer;
  v_new_revision integer;
  v_order_id uuid;
  v_order_status text;
  v_service_type text;
  v_server_name text;
  v_opened_at timestamptz;
  v_result jsonb;
  v_bad_item boolean;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'tenant y actor son requeridos.' using errcode = '22023';
  end if;
  if p_operation_id is null or length(btrim(p_operation_id)) not between 1 and 160 then
    raise exception 'operation_id debe tener entre 1 y 160 caracteres.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'table') <> 'object'
     or jsonb_typeof(p_payload -> 'scope') <> 'object' then
    raise exception 'El payload de sincronización no tiene estructura válida.' using errcode = '22023';
  end if;

  v_table_payload := p_payload -> 'table';
  v_order_payload := p_payload -> 'order';
  v_scope := p_payload -> 'scope';
  begin
    v_branch_id := nullif(p_payload ->> 'branch_id', '')::uuid;
    v_table_input_id := nullif(v_table_payload ->> 'table_id', '')::uuid;
    v_table_number := nullif(v_table_payload ->> 'table_number', '')::integer;
    v_cash_register_id := nullif(v_scope ->> 'cash_register_id', '')::uuid;
    v_cash_shift_id := nullif(v_scope ->> 'cash_shift_id', '')::uuid;
    v_terminal_id := nullif(v_scope ->> 'terminal_id', '')::uuid;
    v_seats := (v_table_payload ->> 'seats')::integer;
  exception when others then
    raise exception 'Sucursal, mesa o alcance operativo inválido.' using errcode = '22023';
  end;
  v_name := nullif(btrim(v_table_payload ->> 'name'), '');
  v_zone := coalesce(nullif(btrim(v_table_payload ->> 'zone'), ''), 'Principal');
  v_status := v_table_payload ->> 'status';
  v_position := coalesce(v_table_payload -> 'position', '{}'::jsonb);
  if v_branch_id is null or v_name is null or length(v_name) > 120
     or v_seats is null or v_seats < 1
     or v_status is null or v_status not in ('AVAILABLE', 'OCCUPIED', 'PRE_CHECK', 'RESERVED')
     or jsonb_typeof(v_position) <> 'object' then
    raise exception 'Los datos de mesa no son válidos.' using errcode = '22023';
  end if;

  -- Una misma clave debe referirse siempre al mismo actor y payload exacto.
  insert into public.pos_order_sync_requests (tenant_id, operation_id, actor_user_id, request_payload)
  values (p_tenant_id, btrim(p_operation_id), p_actor_user_id, p_payload)
  on conflict (tenant_id, operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into v_existing
    from public.pos_order_sync_requests
    where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id)
    for update;
    if not found then
      raise exception 'No se pudo resolver el reintento de sincronización.' using errcode = '40001';
    end if;
    if v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.request_payload is distinct from p_payload then
      raise exception 'operation_id ya fue usado con otro actor o payload.' using errcode = '22023';
    end if;
    if v_existing.result is null then
      raise exception 'La operación idempotente anterior no tiene resultado confirmado.' using errcode = '40001';
    end if;
    return v_existing.result || jsonb_build_object('alreadyApplied', true);
  end if;

  perform 1 from public.pos_branches
  where id = v_branch_id and tenant_id = p_tenant_id and is_active = true;
  if not found then
    raise exception 'La sucursal no está activa para este tenant.' using errcode = '22023';
  end if;

  -- Resolver mesa dentro del tenant/sucursal antes de escribir. Las tablas por
  -- número duplicado se rechazan en vez de elegir una al azar.
  if v_table_input_id is not null then
    select id into v_table_id
    from public.pos_tables
    where id = v_table_input_id and tenant_id = p_tenant_id;
  end if;
  if v_table_id is null and v_table_number is not null then
    select count(*) into v_table_count
    from public.pos_tables
    where tenant_id = p_tenant_id and branch_id = v_branch_id and table_number = v_table_number;
    if v_table_count > 1 then
      raise exception 'El número de mesa es ambiguo en esta sucursal.' using errcode = '22023';
    elsif v_table_count = 1 then
      select id into v_table_id
      from public.pos_tables
      where tenant_id = p_tenant_id and branch_id = v_branch_id and table_number = v_table_number;
    end if;
  end if;
  v_table_id := coalesce(v_table_id, v_table_input_id, gen_random_uuid());

  -- Mismo orden de locks que la RPC de traslado: mesa primero, luego órdenes.
  insert into public.pos_tables (
    id, tenant_id, branch_id, name, table_number, zone, seats, status, position, updated_at
  ) values (
    v_table_id, p_tenant_id, v_branch_id, v_name, v_table_number, v_zone, v_seats, v_status, v_position, now()
  ) on conflict (id) do update set
    branch_id = excluded.branch_id,
    name = excluded.name,
    table_number = excluded.table_number,
    zone = excluded.zone,
    seats = excluded.seats,
    status = excluded.status,
    position = excluded.position,
    updated_at = now()
  where public.pos_tables.tenant_id = excluded.tenant_id
  returning id into v_table_id;
  if not found then
    raise exception 'La mesa no pertenece al tenant indicado.' using errcode = '22023';
  end if;

  v_order_id := null;
  v_new_revision := null;
  if v_order_payload is not null and jsonb_typeof(v_order_payload) <> 'null' then
    if jsonb_typeof(v_order_payload) <> 'object'
       or jsonb_typeof(v_order_payload -> 'items') <> 'array' then
      raise exception 'La orden o sus líneas no tienen estructura válida.' using errcode = '22023';
    end if;
    v_order_number := nullif(btrim(v_order_payload ->> 'order_number'), '');
    if v_order_number is null or length(v_order_number) > 80 then
      raise exception 'El número de orden no es válido.' using errcode = '22023';
    end if;
    begin
      v_expected_revision := coalesce(nullif(v_order_payload ->> 'expected_revision', '')::integer, 0);
      v_opened_at := coalesce(nullif(v_order_payload ->> 'opened_at', '')::timestamptz, now());
    exception when others then
      raise exception 'La revisión o fecha de apertura de la orden no es válida.' using errcode = '22023';
    end;
    if v_expected_revision < 0 then
      raise exception 'La revisión esperada no puede ser negativa.' using errcode = '22023';
    end if;
    v_server_name := nullif(left(coalesce(v_order_payload ->> 'server_name', ''), 120), '');
    v_service_type := coalesce(nullif(v_order_payload ->> 'service_type', ''), 'DINE_IN');
    if v_service_type not in ('DINE_IN', 'TAKEAWAY', 'DELIVERY') then
      raise exception 'El tipo de servicio no es válido.' using errcode = '22023';
    end if;

    select exists (
      select 1
      from jsonb_to_recordset(v_order_payload -> 'items') as i(
        client_item_id text, menu_item_id uuid, name_snapshot text,
        quantity numeric, unit_price numeric, tax_rate numeric, modifiers jsonb,
        notes text, station text, kds_status text
      )
      where i.client_item_id is null or length(btrim(i.client_item_id)) not between 1 and 160
         or i.name_snapshot is null or length(i.name_snapshot) > 200
         or i.quantity is null or i.quantity <= 0
         or i.unit_price is null or i.unit_price < 0
         or i.tax_rate is null or i.tax_rate < 0
         or (i.modifiers is not null and jsonb_typeof(i.modifiers) <> 'array')
         or (i.kds_status is not null and i.kds_status not in ('PENDING', 'IN_PREPARATION', 'READY', 'SERVED'))
    ) into v_bad_item;
    if v_bad_item then
      raise exception 'Una o más líneas de la orden no son válidas.' using errcode = '22023';
    end if;

    v_order_key := 'order:' || p_tenant_id::text || ':' || v_order_number;
    select id, cloud_revision, status into v_order_id, v_current_revision, v_order_status
    from public.pos_orders
    where tenant_id = p_tenant_id and idempotency_key = v_order_key
    for update;

    if found then
      if v_order_status in ('CLOSED', 'CANCELLED') or v_current_revision <> v_expected_revision then
        raise exception 'STALE_ORDER_REVISION' using errcode = '40001';
      end if;
      update public.pos_orders set
        branch_id = v_branch_id,
        cash_register_id = coalesce(v_cash_register_id, cash_register_id),
        cash_shift_id = coalesce(v_cash_shift_id, cash_shift_id),
        terminal_id = coalesce(v_terminal_id, terminal_id),
        table_id = v_table_id,
        server_name = v_server_name,
        status = 'OPEN',
        cloud_revision = cloud_revision + 1
      where id = v_order_id and tenant_id = p_tenant_id
      returning cloud_revision into v_new_revision;
    else
      if v_expected_revision <> 0 then
        raise exception 'STALE_ORDER_REVISION' using errcode = '40001';
      end if;
      insert into public.pos_orders (
        tenant_id, branch_id, cash_register_id, cash_shift_id, terminal_id, table_id,
        order_number, status, service_type, opened_by, server_name, opened_at,
        idempotency_key, cloud_revision
      ) values (
        p_tenant_id, v_branch_id, v_cash_register_id, v_cash_shift_id, v_terminal_id, v_table_id,
        v_order_number, 'OPEN', v_service_type, p_actor_user_id, v_server_name, v_opened_at,
        v_order_key, 1
      ) on conflict (tenant_id, idempotency_key) do nothing
      returning id, cloud_revision into v_order_id, v_new_revision;
      if not found then
        select id, cloud_revision into v_order_id, v_current_revision
        from public.pos_orders
        where tenant_id = p_tenant_id and idempotency_key = v_order_key
        for update;
        if not found or v_current_revision <> v_expected_revision then
          raise exception 'STALE_ORDER_REVISION' using errcode = '40001';
        end if;
        raise exception 'STALE_ORDER_REVISION' using errcode = '40001';
      end if;
    end if;

    delete from public.pos_order_items
    where tenant_id = p_tenant_id and order_id = v_order_id;

    insert into public.pos_order_items (
      tenant_id, order_id, menu_item_id, client_item_id, name_snapshot,
      quantity, unit_price, tax_rate, modifiers, notes, station, kds_status
    )
    select
      p_tenant_id, v_order_id, i.menu_item_id, btrim(i.client_item_id), i.name_snapshot,
      i.quantity, i.unit_price, coalesce(i.tax_rate, 0.13), coalesce(i.modifiers, '[]'::jsonb),
      i.notes, i.station, coalesce(i.kds_status, 'PENDING')
    from jsonb_to_recordset(v_order_payload -> 'items') as i(
      client_item_id text, menu_item_id uuid, name_snapshot text,
      quantity numeric, unit_price numeric, tax_rate numeric, modifiers jsonb,
      notes text, station text, kds_status text
    );
  end if;

  v_result := jsonb_build_object(
    'tableId', v_table_id,
    'orderId', v_order_id,
    'orderNumber', case when v_order_payload is not null and jsonb_typeof(v_order_payload) <> 'null' then v_order_number else null end,
    'cloudRevision', v_new_revision,
    'alreadyApplied', false
  );
  insert into public.pos_audit_events (
    tenant_id, branch_id, actor_user_id, actor_employee_id, action,
    entity_type, entity_id, request_id, metadata
  ) values (
    p_tenant_id, v_branch_id, p_actor_user_id, p_actor_employee_id, 'OFFLINE_SYNC',
    'TABLE', v_table_id::text, btrim(p_operation_id), v_result
  );
  update public.pos_order_sync_requests
  set result = v_result
  where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
  return v_result;
end;
$$;

revoke all on function public.sync_pos_table_order(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_pos_table_order(uuid, text, uuid, uuid, jsonb) to service_role;

create or replace function public.transfer_pos_order_item(
  p_tenant_id uuid,
  p_operation_id text,
  p_actor_user_id uuid,
  p_actor_employee_id uuid,
  p_source_order_number text,
  p_destination_order_number text,
  p_source_client_item_id text,
  p_destination_client_item_id text,
  p_quantity numeric,
  p_expected_source_revision integer,
  p_expected_destination_revision integer,
  p_source_item_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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
  v_source_revision integer;
  v_destination_revision integer;
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
  if p_expected_source_revision is null or p_expected_source_revision < 0
     or p_expected_destination_revision is null or p_expected_destination_revision < 0 then
    raise exception 'Las revisiones esperadas no son válidas.' using errcode = '22023';
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

  v_snapshot_modifiers := coalesce(p_source_item_snapshot -> 'selectedModifiers', '[]'::jsonb);
  if jsonb_typeof(v_snapshot_modifiers) <> 'array' then
    raise exception 'Los modificadores del snapshot no son válidos.' using errcode = '22023';
  end if;
  v_snapshot_notes := case when p_source_item_snapshot ? 'notes' then p_source_item_snapshot ->> 'notes' else null end;
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
    'expected_source_revision', p_expected_source_revision,
    'expected_destination_revision', p_expected_destination_revision,
    'source_item_snapshot', p_source_item_snapshot
  );

  insert into public.pos_order_item_transfer_requests (tenant_id, operation_id, actor_user_id, request_payload)
  values (p_tenant_id, btrim(p_operation_id), p_actor_user_id, v_payload)
  on conflict (tenant_id, operation_id) do nothing;
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
    return v_existing.result || jsonb_build_object('alreadyApplied', true);
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

  perform t.id from public.pos_tables t
  where t.tenant_id = p_tenant_id and t.id in (v_source_table_id, v_destination_table_id)
  order by t.id for update;
  get diagnostics v_locked = row_count;
  if v_locked <> 2 then
    raise exception 'Una de las mesas ya no existe en este tenant.' using errcode = '22023';
  end if;

  perform o.id from public.pos_orders o
  where o.tenant_id = p_tenant_id and o.id in (v_source_order_id, v_destination_order_id)
  order by o.id for update;
  get diagnostics v_locked = row_count;
  if v_locked <> 2 then
    raise exception 'Una de las comandas cambió durante el traslado.' using errcode = '40001';
  end if;

  select * into v_source_order from public.pos_orders o
  where o.id = v_source_order_id and o.tenant_id = p_tenant_id;
  select * into v_destination_order from public.pos_orders o
  where o.id = v_destination_order_id and o.tenant_id = p_tenant_id;
  if v_source_order.table_id is distinct from v_source_table_id
     or v_destination_order.table_id is distinct from v_destination_table_id then
    raise exception 'La mesa asociada a una comanda cambió; vuelve a sincronizar.' using errcode = '40001';
  end if;
  if v_source_order.cloud_revision <> p_expected_source_revision
     or v_destination_order.cloud_revision <> p_expected_destination_revision then
    raise exception 'STALE_ORDER_REVISION' using errcode = '40001';
  end if;
  if v_source_order.status in ('CLOSED', 'CANCELLED')
     or v_destination_order.status in ('CLOSED', 'CANCELLED') then
    raise exception 'No se puede trasladar a o desde una comanda cerrada.' using errcode = '22023';
  end if;

  select * into v_source_table from public.pos_tables t
  where t.id = v_source_table_id and t.tenant_id = p_tenant_id;
  select * into v_destination_table from public.pos_tables t
  where t.id = v_destination_table_id and t.tenant_id = p_tenant_id;
  if v_source_table.branch_id is distinct from v_destination_table.branch_id then
    raise exception 'El traslado debe permanecer en la misma sucursal.' using errcode = '22023';
  end if;
  if v_source_table.status not in ('OCCUPIED', 'PRE_CHECK')
     or v_destination_table.status not in ('OCCUPIED', 'PRE_CHECK') then
    raise exception 'Las dos mesas deben conservar una comanda activa.' using errcode = '22023';
  end if;

  select count(*) into v_match_count
  from public.pos_order_items i
  where i.tenant_id = p_tenant_id and i.order_id = v_source_order_id
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
  where i.tenant_id = p_tenant_id and i.order_id = v_source_order_id
    and (i.client_item_id = btrim(p_source_client_item_id) or i.client_item_id is null)
    and i.name_snapshot = v_snapshot_name and i.quantity = v_snapshot_quantity
    and i.unit_price = v_snapshot_price and i.tax_rate = v_snapshot_tax_rate
    and i.notes is not distinct from v_snapshot_notes and i.modifiers = v_snapshot_modifiers
    and i.station = v_snapshot_station and i.kds_status = v_snapshot_kds_status
  order by i.id limit 1 for update;

  if v_source_item.client_item_id is null then
    update public.pos_order_items set client_item_id = btrim(p_source_client_item_id)
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
    update public.pos_order_items set order_id = v_destination_order_id
    where id = v_source_item.id and tenant_id = p_tenant_id and order_id = v_source_order_id
    returning * into v_moved_item;
  else
    if btrim(p_destination_client_item_id) = btrim(p_source_client_item_id) then
      raise exception 'Un traslado parcial requiere un ID nuevo para la línea destino.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.pos_order_items i
      where i.tenant_id = p_tenant_id and i.order_id = v_destination_order_id
        and i.client_item_id = btrim(p_destination_client_item_id)
    ) then
      raise exception 'El ID de línea destino ya existe en esa comanda.' using errcode = '23505';
    end if;
    update public.pos_order_items set quantity = quantity - p_quantity
    where id = v_source_item.id and tenant_id = p_tenant_id and order_id = v_source_order_id
    returning * into v_updated_source_item;
    insert into public.pos_order_items (
      tenant_id, order_id, menu_item_id, client_item_id, name_snapshot,
      quantity, unit_price, tax_rate, modifiers, notes, station, kds_status
    ) values (
      v_updated_source_item.tenant_id, v_destination_order_id, v_updated_source_item.menu_item_id,
      btrim(p_destination_client_item_id), v_updated_source_item.name_snapshot, p_quantity,
      v_updated_source_item.unit_price, v_updated_source_item.tax_rate, v_updated_source_item.modifiers,
      v_updated_source_item.notes, v_updated_source_item.station, v_updated_source_item.kds_status
    ) returning * into v_moved_item;
  end if;

  update public.pos_orders set cloud_revision = cloud_revision + 1
  where id = v_source_order_id and tenant_id = p_tenant_id
  returning cloud_revision into v_source_revision;
  update public.pos_orders set cloud_revision = cloud_revision + 1
  where id = v_destination_order_id and tenant_id = p_tenant_id
  returning cloud_revision into v_destination_revision;

  v_result := jsonb_build_object(
    'sourceOrderId', v_source_order_id,
    'destinationOrderId', v_destination_order_id,
    'sourceOrderNumber', btrim(p_source_order_number),
    'destinationOrderNumber', btrim(p_destination_order_number),
    'sourceRevision', v_source_revision,
    'destinationRevision', v_destination_revision,
    'sourceItemRowId', v_source_item.id,
    'destinationItemRowId', v_moved_item.id,
    'sourceClientItemId', btrim(p_source_client_item_id),
    'destinationClientItemId', btrim(p_destination_client_item_id),
    'quantity', p_quantity,
    'alreadyApplied', false
  );

  insert into public.pos_audit_events (
    tenant_id, branch_id, actor_user_id, actor_employee_id, action,
    entity_type, entity_id, request_id, metadata
  ) values (
    p_tenant_id, v_source_table.branch_id, p_actor_user_id, p_actor_employee_id,
    'TRANSFER_ORDER_ITEM', 'ORDER_ITEM_TRANSFER', v_moved_item.id::text,
    btrim(p_operation_id), v_result
  );
  update public.pos_order_item_transfer_requests
  set result = v_result
  where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
  return v_result;
end;
$$;

revoke all on function public.transfer_pos_order_item(uuid, text, uuid, uuid, text, text, text, text, numeric, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.transfer_pos_order_item(uuid, text, uuid, uuid, text, text, text, text, numeric, integer, integer, jsonb)
  to service_role;
