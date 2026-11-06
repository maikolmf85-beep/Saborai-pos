-- SaborAI POS - reasignación segura de una terminal activa entre dispositivos.
-- DEPENDENCIAS: ejecutar después de:
--   20261017000000_pos_core.sql
--   20261026000000_phase8_central_cash_registers.sql
--   20261105170000_shift_and_daily_cash_closures.sql
-- Esta migración NO se debe aplicar sin aprobación explícita de Maikol.
-- La RPC no modifica ni elimina pagos, turnos, aperturas o cierres; solo cambia
-- is_active en pos_terminals y asigna el dispositivo confirmado.

-- Preflight: fallar antes de crear la RPC si falta cualquier pieza del esquema
-- o las restricciones que hacen segura la reasignación.
do $$
declare
  v_missing_columns text;
begin
  if to_regclass('public.pos_terminals') is null
     or to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null then
    raise exception using
      errcode = '42P01',
      message = 'Falta el esquema base de terminales/cajas/turnos. Ejecuta primero pos_core, phase8_central_cash_registers y shift_and_daily_cash_closures.';
  end if;

  select string_agg(required.table_name || '.' || required.column_name, ', ' order by required.table_name, required.column_name)
    into v_missing_columns
  from (values
    ('pos_terminals', 'id'),
    ('pos_terminals', 'tenant_id'),
    ('pos_terminals', 'branch_id'),
    ('pos_terminals', 'cash_register_id'),
    ('pos_terminals', 'device_key'),
    ('pos_terminals', 'device_name'),
    ('pos_terminals', 'last_seen_at'),
    ('pos_terminals', 'is_active'),
    ('pos_cash_registers', 'id'),
    ('pos_cash_registers', 'tenant_id'),
    ('pos_cash_registers', 'branch_id'),
    ('pos_cash_registers', 'is_active'),
    ('pos_cash_shifts', 'tenant_id'),
    ('pos_cash_shifts', 'cash_register_id'),
    ('pos_cash_shifts', 'status')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  );

  if v_missing_columns is not null then
    raise exception using
      errcode = '42703',
      message = 'Faltan columnas requeridas para reasignar una terminal: ' || v_missing_columns;
  end if;

  if not exists (
    select 1
    from pg_class idx
    join pg_namespace ns on ns.oid = idx.relnamespace
    join pg_index ix on ix.indexrelid = idx.oid
    where ns.nspname = 'public'
      and idx.relname = 'pos_one_active_terminal_per_register'
      and ix.indisunique
      and ix.indisvalid
      and pg_get_expr(ix.indpred, ix.indrelid) ilike '%is_active = true%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Falta el índice único pos_one_active_terminal_per_register; no se habilita la reasignación sin la regla de una terminal activa por caja.';
  end if;

  if not exists (
    select 1
    from pg_class idx
    join pg_namespace ns on ns.oid = idx.relnamespace
    join pg_index ix on ix.indexrelid = idx.oid
    where ns.nspname = 'public'
      and idx.relname = 'pos_one_open_shift_per_register'
      and ix.indisunique
      and ix.indisvalid
      and pg_get_expr(ix.indpred, ix.indrelid) ilike '%status = ''OPEN''%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Falta el índice único pos_one_open_shift_per_register; no se habilita la reasignación sin la regla de un turno abierto por caja.';
  end if;
end;
$$;

create or replace function public.pos_reassign_cash_terminal(
  p_tenant_id uuid,
  p_previous_terminal_id uuid,
  p_register_id uuid,
  p_device_key text,
  p_device_name text,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.pos_cash_registers%rowtype;
  v_previous public.pos_terminals%rowtype;
  v_current public.pos_terminals%rowtype;
  v_current_found boolean := false;
  v_terminal_id uuid;
begin
  if p_confirmed is distinct from true then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_CONFIRMATION_REQUIRED|Confirme que el terminal anterior está fuera de servicio y que sus cobros pendientes ya se sincronizaron.';
  end if;
  if p_tenant_id is null or p_previous_terminal_id is null or p_register_id is null then
    raise exception using errcode = '22023', message = 'La reasignación de terminal requiere tenant, terminal anterior y caja.';
  end if;
  if p_device_key is null or p_device_key !~ '^[A-Za-z0-9_-]{16,160}$' then
    raise exception using errcode = '22023', message = 'El identificador del dispositivo no es válido.';
  end if;
  if p_device_name is not null and length(p_device_name) > 120 then
    raise exception using errcode = '22023', message = 'El nombre del dispositivo supera el tamaño permitido.';
  end if;

  -- Serializa el cambio con los triggers de pagos y con la apertura de turnos,
  -- que bloquean la fila de la caja durante sus validaciones.
  select * into v_register
  from public.pos_cash_registers r
  where r.tenant_id = p_tenant_id
    and r.id = p_register_id
    and r.is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_REGISTER_NOT_FOUND|No se encontró una caja activa de este restaurante.';
  end if;

  select * into v_previous
  from public.pos_terminals t
  where t.tenant_id = p_tenant_id
    and t.id = p_previous_terminal_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_PREVIOUS_ASSIGNMENT_NOT_FOUND|La asignación anterior ya no existe; actualice la pantalla e intente de nuevo.';
  end if;
  if v_previous.cash_register_id <> v_register.id then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_ASSIGNMENT_CHANGED|La asignación anterior cambió; actualice la pantalla antes de continuar.';
  end if;

  select * into v_current
  from public.pos_terminals t
  where t.tenant_id = p_tenant_id
    and t.device_key = p_device_key
  for update;
  v_current_found := found;

  -- Hace segura una repetición de la solicitud si el servidor alcanzó a
  -- confirmar la reasignación pero se perdió la respuesta HTTP.
  if not v_previous.is_active then
    if v_current_found and v_current.is_active and v_current.cash_register_id = v_register.id then
      return jsonb_build_object(
        'terminalId', v_current.id,
        'deactivatedTerminalId', p_previous_terminal_id,
        'registerId', v_register.id,
        'assigned', true,
        'alreadyAssigned', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_PREVIOUS_ASSIGNMENT_NOT_ACTIVE|La terminal anterior ya fue desactivada; actualice la pantalla e intente la asignación normal.';
  end if;

  if v_current_found and v_current.is_active and v_current.cash_register_id <> v_register.id then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_CURRENT_DEVICE_ASSIGNED|Este dispositivo ya está activo en otra caja. Seleccione esa caja o libere su asignación por separado.';
  end if;

  if exists (
    select 1
    from public.pos_cash_shifts s
    where s.tenant_id = p_tenant_id
      and s.cash_register_id = v_register.id
      and s.status = 'OPEN'
  ) then
    raise exception using errcode = 'P0001', message = 'CASH_TERMINAL_OPEN_SHIFT|No se puede liberar la terminal mientras la caja tenga un turno abierto. Cierre el turno y asegúrese de sincronizar los cobros pendientes.';
  end if;

  -- Baja lógica: conserva la fila de terminal y todas las referencias históricas.
  update public.pos_terminals
  set is_active = false
  where tenant_id = p_tenant_id
    and id = p_previous_terminal_id
    and is_active = true;

  insert into public.pos_terminals (
    tenant_id, branch_id, cash_register_id, device_key, device_name, last_seen_at, is_active
  ) values (
    p_tenant_id,
    v_register.branch_id,
    v_register.id,
    p_device_key,
    coalesce(nullif(btrim(p_device_name), ''), 'Dispositivo POS'),
    now(),
    true
  )
  on conflict (tenant_id, device_key) do update
  set branch_id = excluded.branch_id,
      cash_register_id = excluded.cash_register_id,
      device_name = excluded.device_name,
      last_seen_at = excluded.last_seen_at,
      is_active = true
  returning id into v_terminal_id;

  return jsonb_build_object(
    'terminalId', v_terminal_id,
    'deactivatedTerminalId', p_previous_terminal_id,
    'registerId', v_register.id,
    'assigned', true,
    'alreadyAssigned', false
  );
end;
$$;

revoke all on function public.pos_reassign_cash_terminal(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.pos_reassign_cash_terminal(uuid, uuid, uuid, text, text, boolean) to service_role;

comment on function public.pos_reassign_cash_terminal(uuid, uuid, uuid, text, text, boolean) is
  'Reasigna una terminal tras confirmación explícita. Bloquea la caja, rechaza turnos abiertos y solo cambia pos_terminals.is_active; pagos y cierres quedan intactos.';
