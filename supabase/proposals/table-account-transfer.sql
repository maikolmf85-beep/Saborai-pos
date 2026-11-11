-- PROPUESTA — NO APLICADA.
-- Traslada una cuenta completa entre mesas de la misma sucursal en una sola transacción.
-- Dependencias previas (todas deben existir antes de ejecutar):
--   * 20261017000000_pos_core.sql: sucursales, mesas, órdenes y auditoría.
--   * 20261026000000_phase8_central_cash_registers.sql: cajas, turnos y linked_zones.
--   * 20261021010000_offline_sync.sql: índice de idempotencia por request_id.
--   * 20261028210000_pos_employee_sessions.sql: actor_employee_id en auditoría.
-- La propuesta repite el índice idempotente de forma IF NOT EXISTS para poder
-- ejecutarse después de esas dependencias sin duplicarlo.

create unique index if not exists pos_audit_events_tenant_request_uidx
  on public.pos_audit_events (tenant_id, request_id)
  where request_id is not null;

create or replace function public.transfer_pos_table_account(
  p_tenant_id uuid,
  p_operation_id text,
  p_actor_user_id uuid,
  p_actor_employee_id uuid,
  p_order_number text,
  p_branch_code text,
  p_source_table jsonb,
  p_destination_table jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch_id uuid;
  v_order_id uuid;
  v_order_branch_id uuid;
  v_source_table_id uuid;
  v_destination_table_id uuid;
  v_source_status text;
  v_order_status text;
  v_destination_status text;
  v_source_table_number integer;
  v_destination_table_number integer;
  v_destination_seats integer;
  v_source_name text;
  v_source_zone text;
  v_destination_name text;
  v_destination_zone text;
  v_source_client_id text;
  v_destination_client_id text;
  v_existing_action text;
  v_existing_metadata jsonb;
  v_active_order_count integer;
  v_target_count integer;
  v_result jsonb;
begin
  if p_tenant_id is null
     or p_actor_user_id is null
     or nullif(btrim(p_operation_id), '') is null
     or length(p_operation_id) > 160
     or nullif(btrim(p_order_number), '') is null
     or length(p_order_number) > 80
     or nullif(btrim(p_branch_code), '') is null
     or btrim(p_branch_code) !~ '^[0-9]{3}$'
     or p_source_table is null
     or p_destination_table is null
     or jsonb_typeof(p_source_table) <> 'object'
     or jsonb_typeof(p_destination_table) <> 'object' then
    raise exception 'La solicitud de traslado no es válida.' using errcode = '22023';
  end if;

  v_source_client_id := nullif(btrim(p_source_table->>'id'), '');
  v_destination_client_id := nullif(btrim(p_destination_table->>'id'), '');
  v_source_name := nullif(btrim(p_source_table->>'name'), '');
  v_source_zone := nullif(btrim(p_source_table->>'zone'), '');
  v_destination_name := nullif(btrim(p_destination_table->>'name'), '');
  v_destination_zone := nullif(btrim(p_destination_table->>'zone'), '');

  if v_source_client_id is null
     or v_destination_client_id is null
     or v_source_client_id = v_destination_client_id
     or v_source_name is null
     or v_source_zone is null
     or v_destination_name is null
     or v_destination_zone is null
     or length(v_source_name) > 120
     or length(v_source_zone) > 120
     or length(v_destination_name) > 120
     or length(v_destination_zone) > 120
     or coalesce(p_source_table->>'number', '') !~ '^[1-9][0-9]{0,5}$'
     or coalesce(p_destination_table->>'number', '') !~ '^[1-9][0-9]{0,5}$'
     or coalesce(p_destination_table->>'seats', '') !~ '^[1-9][0-9]?$' then
    raise exception 'Los datos de las mesas no son válidos.' using errcode = '22023';
  end if;

  v_source_table_number := (p_source_table->>'number')::integer;
  v_destination_table_number := (p_destination_table->>'number')::integer;
  v_destination_seats := (p_destination_table->>'seats')::integer;
  if v_destination_seats > 50 then
    raise exception 'La capacidad de la mesa destino no es válida.' using errcode = '22023';
  end if;

  -- Serializa reintentos y traslados para un tenant; la auditoría hace de ledger idempotente.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':table-account-transfer:' || p_operation_id, 0));
  select action, metadata
    into v_existing_action, v_existing_metadata
    from public.pos_audit_events
   where tenant_id = p_tenant_id
     and request_id = p_operation_id
   limit 1
   for update;
  if found then
    if v_existing_action <> 'TABLE_ACCOUNT_TRANSFER'
       or v_existing_metadata->>'orderNumber' is distinct from btrim(p_order_number)
       or v_existing_metadata->>'sourceClientTableId' is distinct from v_source_client_id
       or v_existing_metadata->>'destinationClientTableId' is distinct from v_destination_client_id then
      raise exception 'El identificador de operación ya se usó para otra solicitud.' using errcode = '22023';
    end if;
    return v_existing_metadata || jsonb_build_object('alreadyApplied', true);
  end if;

  select id into v_branch_id
    from public.pos_branches
   where tenant_id = p_tenant_id
     and code = btrim(p_branch_code)
     and is_active = true;
  if v_branch_id is null then
    raise exception 'La sucursal activa del turno no existe.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || v_branch_id::text || ':target:' ||
    v_destination_table_number::text || ':' || lower(v_destination_name) || ':' || lower(v_destination_zone),
    0
  ));

  select id, branch_id, table_id, status
    into v_order_id, v_order_branch_id, v_source_table_id, v_order_status
    from public.pos_orders
   where tenant_id = p_tenant_id
     and order_number = btrim(p_order_number)
     and idempotency_key = 'order:' || p_tenant_id::text || ':' || btrim(p_order_number)
   for update;
  if v_order_id is null then
    raise exception 'La cuenta origen ya no existe en la nube.' using errcode = '22023';
  end if;
  if v_order_branch_id <> v_branch_id then
    raise exception 'No se puede trasladar una cuenta entre sucursales.' using errcode = '22023';
  end if;
  if v_order_status not in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED') then
    raise exception 'La cuenta ya está cerrada y no se puede trasladar.' using errcode = '22023';
  end if;

  select table_number, name, zone, status
    into v_source_table_number, v_source_name, v_source_zone, v_source_status
    from public.pos_tables
   where id = v_source_table_id
     and tenant_id = p_tenant_id
     and branch_id = v_branch_id
   for update;
  if v_source_table_id is null or v_source_status not in ('OCCUPIED', 'PRE_CHECK') then
    raise exception 'La mesa origen ya no tiene una cuenta abierta.' using errcode = '22023';
  end if;
  if v_source_table_number is distinct from (p_source_table->>'number')::integer
     or v_source_name is distinct from nullif(btrim(p_source_table->>'name'), '')
     or v_source_zone is distinct from nullif(btrim(p_source_table->>'zone'), '') then
    raise exception 'La mesa origen cambió; actualiza el mapa antes de trasladar.' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.pos_cash_registers r
      join public.pos_cash_shifts s
        on s.tenant_id = r.tenant_id
       and s.branch_id = r.branch_id
       and s.cash_register_id = r.id
       and s.status = 'OPEN'
     where r.tenant_id = p_tenant_id
       and r.branch_id = v_branch_id
       and r.is_active = true
       and r.linked_zones @> jsonb_build_array(v_source_zone)
  ) then
    raise exception 'El salón origen no tiene un turno abierto en esta sucursal.' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.pos_cash_registers r
      join public.pos_cash_shifts s
        on s.tenant_id = r.tenant_id
       and s.branch_id = r.branch_id
       and s.cash_register_id = r.id
       and s.status = 'OPEN'
     where r.tenant_id = p_tenant_id
       and r.branch_id = v_branch_id
       and r.is_active = true
       and r.linked_zones @> jsonb_build_array(v_destination_zone)
  ) then
    raise exception 'El salón destino no tiene un turno abierto en esta sucursal.' using errcode = '22023';
  end if;

  select count(*) into v_active_order_count
    from public.pos_orders
   where tenant_id = p_tenant_id
     and branch_id = v_branch_id
     and table_id = v_source_table_id
     and status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED');
  if v_active_order_count <> 1 then
    raise exception 'La mesa origen tiene más de una cuenta activa o cambió durante el traslado.' using errcode = '22023';
  end if;

  -- La mesa destino se resuelve exclusivamente dentro de la sucursal del turno y de la cuenta.
  select count(*) into v_target_count
    from public.pos_tables
   where tenant_id = p_tenant_id
     and branch_id = v_branch_id
     and table_number = v_destination_table_number
     and name = v_destination_name
     and zone = v_destination_zone;
  if v_target_count > 1 then
    raise exception 'La mesa destino no se puede identificar de forma única en esta sucursal.' using errcode = '22023';
  elsif v_target_count = 1 then
    select id, status into v_destination_table_id, v_destination_status
      from public.pos_tables
     where tenant_id = p_tenant_id
       and branch_id = v_branch_id
       and table_number = v_destination_table_number
       and name = v_destination_name
       and zone = v_destination_zone
     for update;
  else
    insert into public.pos_tables (
      tenant_id, branch_id, name, table_number, zone, seats, status, position
    ) values (
      p_tenant_id,
      v_branch_id,
      v_destination_name,
      v_destination_table_number,
      v_destination_zone,
      v_destination_seats,
      'AVAILABLE',
      jsonb_build_object(
        'x', greatest(0, least(100, coalesce((p_destination_table->>'x')::numeric, 0))),
        'y', greatest(0, least(100, coalesce((p_destination_table->>'y')::numeric, 0))),
        'rotation', coalesce((p_destination_table->>'rotation')::numeric, 0),
        'shape', case when p_destination_table->>'shape' in ('round', 'bar') then p_destination_table->>'shape' else 'square' end
      )
    ) returning id, status into v_destination_table_id, v_destination_status;
  end if;

  if v_destination_table_id = v_source_table_id then
    raise exception 'El destino debe ser una mesa distinta.' using errcode = '22023';
  end if;
  if v_destination_status <> 'AVAILABLE' then
    raise exception 'La mesa destino ya no está disponible.' using errcode = '22023';
  end if;
  select count(*) into v_active_order_count
    from public.pos_orders
   where tenant_id = p_tenant_id
     and branch_id = v_branch_id
     and table_id = v_destination_table_id
     and status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED');
  if v_active_order_count > 0 then
    raise exception 'La mesa destino ya tiene una cuenta activa.' using errcode = '22023';
  end if;

  update public.pos_orders
     set table_id = v_destination_table_id
   where id = v_order_id
     and tenant_id = p_tenant_id
     and branch_id = v_branch_id
     and status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED');
  if not found then
    raise exception 'La cuenta cambió durante el traslado.' using errcode = '40001';
  end if;

  update public.pos_tables
     set status = 'AVAILABLE', updated_at = now()
   where id = v_source_table_id and tenant_id = p_tenant_id and branch_id = v_branch_id;
  update public.pos_tables
     set status = v_source_status, updated_at = now()
   where id = v_destination_table_id and tenant_id = p_tenant_id and branch_id = v_branch_id;

  v_result := jsonb_build_object(
    'orderNumber', btrim(p_order_number),
    'sourceClientTableId', v_source_client_id,
    'destinationClientTableId', v_destination_client_id,
    'sourceTableNumber', v_source_table_number,
    'destinationTableNumber', v_destination_table_number,
    'sourceZone', v_source_zone,
    'destinationZone', v_destination_zone,
    'sourceStatus', 'AVAILABLE',
    'destinationStatus', v_source_status,
    'branchId', v_branch_id,
    'alreadyApplied', false
  );

  insert into public.pos_audit_events (
    tenant_id, branch_id, actor_user_id, actor_employee_id,
    action, entity_type, entity_id, request_id, metadata
  ) values (
    p_tenant_id, v_branch_id, p_actor_user_id, p_actor_employee_id,
    'TABLE_ACCOUNT_TRANSFER', 'TABLE_ACCOUNT', v_order_id::text,
    p_operation_id, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.transfer_pos_table_account(uuid, text, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.transfer_pos_table_account(uuid, text, uuid, uuid, text, text, jsonb, jsonb)
  to service_role;

comment on function public.transfer_pos_table_account(uuid, text, uuid, uuid, text, text, jsonb, jsonb)
  is 'Moves an entire open POS table account atomically to an available table in the same branch.';
