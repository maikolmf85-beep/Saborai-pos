-- SaborAI POS: persistencia de la sesión de apertura diaria hasta cierre explícito.
--
-- La apertura diaria es la sesión canónica de una caja: permanece vigente a
-- través de medianoche hasta que se inserta su cierre explícito. No se agregan
-- tablas ni columnas; opened_by ya existente conserva la identidad opaca
-- validada por el servidor (auth.employeeId para empleados, auth.userId para
-- usuarios) y el cierre exige igualdad exacta con esa identidad.
--
-- No se modifica la semántica de pos_close_cash_shift ni de sus guards.
-- Dependencias (ya aplicadas, en este orden):
--   1. 20261017000000_pos_core.sql
--   2. 20261024020000_phase3_hacienda_history.sql
--   3. 20261026000000_phase8_central_cash_registers.sql
--   4. 20261026010000_phase2_cash_control_sync.sql
--   5. 20261105170000_shift_and_daily_cash_closures.sql
--   6. 20261106100000_daily_cash_openings.sql
-- Esta propuesta es solo para revisión; no ejecutarla sin aprobación explícita.

-- Preflight estructural solamente: no inspecciona filas ni ejecuta SQL dinámico.
do $$
begin
  if to_regclass('public.pos_branches') is null
     or to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null
     or to_regclass('public.pos_tables') is null
     or to_regclass('public.pos_orders') is null
     or to_regclass('public.pos_payments') is null
     or to_regclass('public.pos_invoices') is null
     or to_regclass('public.pos_daily_cash_openings') is null
     or to_regclass('public.pos_daily_cash_closures') is null then
    raise exception using
      errcode = '42P01',
      message = 'Falta una tabla requerida para persistencia de la sesión de apertura diaria; aplique primero las migraciones POS, multi-caja, cierres diarios y aperturas diarias indicadas.';
  end if;
  if exists (
    select 1
    from (values
      ('pos_branches', 'id'), ('pos_branches', 'tenant_id'), ('pos_branches', 'timezone'), ('pos_branches', 'is_active'), ('pos_branches', 'code'),
      ('pos_cash_registers', 'id'), ('pos_cash_registers', 'tenant_id'), ('pos_cash_registers', 'branch_id'), ('pos_cash_registers', 'name'), ('pos_cash_registers', 'terminal_code'), ('pos_cash_registers', 'is_active'),
      ('pos_cash_shifts', 'id'), ('pos_cash_shifts', 'tenant_id'), ('pos_cash_shifts', 'branch_id'), ('pos_cash_shifts', 'cash_register_id'), ('pos_cash_shifts', 'status'), ('pos_cash_shifts', 'opened_at'), ('pos_cash_shifts', 'closed_at'), ('pos_cash_shifts', 'movements'),
      ('pos_tables', 'tenant_id'), ('pos_tables', 'branch_id'), ('pos_tables', 'status'),
      ('pos_orders', 'id'), ('pos_orders', 'tenant_id'), ('pos_orders', 'branch_id'), ('pos_orders', 'table_id'), ('pos_orders', 'service_type'), ('pos_orders', 'status'),
      ('pos_payments', 'id'), ('pos_payments', 'tenant_id'), ('pos_payments', 'order_id'), ('pos_payments', 'cash_shift_id'), ('pos_payments', 'paid_at'), ('pos_payments', 'created_at'), ('pos_payments', 'amount'), ('pos_payments', 'method'), ('pos_payments', 'status'),
      ('pos_invoices', 'id'), ('pos_invoices', 'tenant_id'), ('pos_invoices', 'branch_id'), ('pos_invoices', 'payment_id'), ('pos_invoices', 'issued_at'), ('pos_invoices', 'created_at'), ('pos_invoices', 'total'),
      ('pos_daily_cash_openings', 'id'), ('pos_daily_cash_openings', 'tenant_id'), ('pos_daily_cash_openings', 'branch_id'), ('pos_daily_cash_openings', 'cash_register_id'), ('pos_daily_cash_openings', 'business_date'), ('pos_daily_cash_openings', 'timezone'), ('pos_daily_cash_openings', 'opened_by'), ('pos_daily_cash_openings', 'opened_at'),
      ('pos_daily_cash_closures', 'id'), ('pos_daily_cash_closures', 'tenant_id'), ('pos_daily_cash_closures', 'branch_id'), ('pos_daily_cash_closures', 'cash_register_id'), ('pos_daily_cash_closures', 'business_date'), ('pos_daily_cash_closures', 'timezone'), ('pos_daily_cash_closures', 'closed_by'), ('pos_daily_cash_closures', 'closed_at'), ('pos_daily_cash_closures', 'summary')
    ) as required(table_name, column_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = required.table_name
     and c.column_name = required.column_name
    where c.column_name is null
  ) then
    raise exception using
      errcode = '42703',
      message = 'Falta una columna requerida para persistencia de sesión, cierre diario o cálculo del resumen; revise las migraciones POS antes de aplicar esta migración.';
  end if;
  if to_regprocedure('public.pos_open_daily_cash(uuid,uuid,uuid)') is null
     or to_regprocedure('public.pos_close_daily_cash(uuid,uuid,date,uuid)') is null
     or to_regprocedure('public.guard_pos_daily_cash_closure_opening()') is null
     or to_regprocedure('public.guard_pos_cash_shift_daily_opening()') is null
     or to_regprocedure('public.guard_pos_payment_daily_cash_opening()') is null
     or to_regprocedure('public.guard_pos_payment_daily_cash_closure()') is null then
    raise exception using
      errcode = '42883',
      message = 'Falta una función POS requerida para redefinir la sesión de apertura diaria; aplique primero la migración de aperturas y cierres diarios.';
  end if;
end;
$$;

create or replace function public.pos_open_daily_cash(
  p_tenant_id uuid,
  p_cash_register_id uuid,
  p_opened_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.pos_cash_registers%rowtype;
  v_branch public.pos_branches%rowtype;
  v_existing public.pos_daily_cash_openings%rowtype;
  v_closure public.pos_daily_cash_closures%rowtype;
  v_now timestamptz := clock_timestamp();
  v_business_date date;
  v_result public.pos_daily_cash_openings%rowtype;
begin
  if p_opened_by is null then
    raise exception using errcode = '22004', message = 'El responsable de apertura diaria es obligatorio.';
  end if;
  select * into v_register
  from public.pos_cash_registers
  where tenant_id = p_tenant_id and id = p_cash_register_id and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontró una caja activa de este restaurante.';
  end if;
  select * into v_branch
  from public.pos_branches
  where tenant_id = p_tenant_id and id = v_register.branch_id and is_active = true;
  if not found or v_branch.timezone is null or btrim(v_branch.timezone) = '' then
    raise exception using errcode = 'P0002', message = 'No se encontró una sucursal activa con zona horaria válida para esta caja.';
  end if;

  v_business_date := (v_now at time zone v_branch.timezone)::date;

  -- Siempre elegir la última apertura, aunque ya esté cerrada; seleccionar la
  -- última apertura sin cierre podría resucitar una sesión anterior.
  select o.* into v_existing
  from public.pos_daily_cash_openings o
  where o.tenant_id = p_tenant_id
    and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id
    and o.opened_at <= v_now
  order by o.opened_at desc, o.id desc
  limit 1
  for update;
  if found then
    select c.* into v_closure
    from public.pos_daily_cash_closures c
    where c.tenant_id = v_existing.tenant_id
      and c.branch_id = v_existing.branch_id
      and c.cash_register_id = v_existing.cash_register_id
      and c.business_date = v_existing.business_date
    for update;
    if not found then
      return jsonb_build_object(
        'openingId', v_existing.id, 'cashRegisterId', v_existing.cash_register_id,
        'businessDate', v_existing.business_date, 'timezone', v_existing.timezone,
        'openedAt', v_existing.opened_at, 'alreadyOpened', true
      );
    end if;
    if v_existing.business_date = v_business_date then
      raise exception using errcode = 'P0001', message = 'DAILY_CASH_CLOSED|' || format(
        'No se puede abrir la caja "%s": ya tiene cierre diario para el %s.',
        v_register.name, to_char(v_business_date, 'YYYY-MM-DD'));
    end if;
  end if;

  if exists (
    select 1 from public.pos_daily_cash_closures c
    where c.tenant_id = p_tenant_id and c.branch_id = v_register.branch_id
      and c.cash_register_id = v_register.id and c.business_date = v_business_date
  ) then
    raise exception using errcode = 'P0001', message = 'DAILY_CASH_CLOSED|' || format(
      'No se puede abrir la caja "%s": ya tiene cierre diario para el %s.',
      v_register.name, to_char(v_business_date, 'YYYY-MM-DD'));
  end if;
  select * into v_existing
  from public.pos_daily_cash_openings o
  where o.tenant_id = p_tenant_id and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id and o.business_date = v_business_date
  for update;
  if found then
    return jsonb_build_object(
      'openingId', v_existing.id, 'cashRegisterId', v_existing.cash_register_id,
      'businessDate', v_existing.business_date, 'timezone', v_existing.timezone,
      'openedAt', v_existing.opened_at, 'alreadyOpened', true
    );
  end if;
  insert into public.pos_daily_cash_openings
    (tenant_id, branch_id, cash_register_id, business_date, timezone, opened_by, opened_at)
  values
    (p_tenant_id, v_register.branch_id, v_register.id, v_business_date, v_branch.timezone, p_opened_by, v_now)
  returning * into v_result;
  return jsonb_build_object(
    'openingId', v_result.id, 'cashRegisterId', v_result.cash_register_id,
    'businessDate', v_result.business_date, 'timezone', v_result.timezone,
    'openedAt', v_result.opened_at, 'alreadyOpened', false
  );
end;
$$;
revoke all on function public.pos_open_daily_cash(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pos_open_daily_cash(uuid, uuid, uuid) to service_role;

create or replace function public.pos_close_daily_cash(
  p_tenant_id uuid,
  p_cash_register_id uuid,
  p_business_date date,
  p_closed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.pos_cash_registers%rowtype;
  v_branch public.pos_branches%rowtype;
  v_opening public.pos_daily_cash_openings%rowtype;
  v_latest_opening public.pos_daily_cash_openings%rowtype;
  v_existing public.pos_daily_cash_closures%rowtype;
  v_closed_at timestamptz := clock_timestamp();
  v_cash numeric(14,2) := 0; v_card numeric(14,2) := 0; v_sinpe numeric(14,2) := 0;
  v_credit numeric(14,2) := 0; v_mixed numeric(14,2) := 0; v_payment_count integer := 0;
  v_invoice_count integer := 0; v_shifts_count integer := 0;
  v_inflows numeric(14,2) := 0; v_outflows numeric(14,2) := 0;
  v_payments_scope_available boolean := true; v_documents_scope_available boolean := true;
  v_movements_scope_available boolean := true; v_summary jsonb; v_result public.pos_daily_cash_closures%rowtype;
begin
  if p_closed_by is null then
    raise exception using errcode = '22004', message = 'La identidad de cierre diario es obligatoria.';
  end if;
  select * into v_register
  from public.pos_cash_registers
  where tenant_id = p_tenant_id and id = p_cash_register_id and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontró una caja activa de este restaurante.';
  end if;
  select * into v_branch
  from public.pos_branches
  where tenant_id = p_tenant_id and id = v_register.branch_id and is_active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontró la sucursal activa de esta caja.';
  end if;
  select * into v_opening
  from public.pos_daily_cash_openings o
  where o.tenant_id = p_tenant_id and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id and o.business_date = p_business_date
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'DAILY_CASH_NOT_OPEN|No existe una apertura diaria para la fecha original de esta sesión.';
  end if;
  if p_closed_by is distinct from v_opening.opened_by then
    raise exception using errcode = '42501', message = 'DAILY_CASH_OWNER_ONLY|Solo la identidad que abrió la sesión puede cerrarla.';
  end if;
  select o.* into v_latest_opening
  from public.pos_daily_cash_openings o
  where o.tenant_id = p_tenant_id and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id and o.opened_at <= v_closed_at
  order by o.opened_at desc, o.id desc
  limit 1
  for update;
  select * into v_existing
  from public.pos_daily_cash_closures c
  where c.tenant_id = p_tenant_id and c.branch_id = v_register.branch_id
    and c.cash_register_id = v_register.id and c.business_date = v_opening.business_date
  for update;
  if found then
    return jsonb_build_object(
      'closureId', v_existing.id, 'cashRegisterId', v_existing.cash_register_id,
      'businessDate', v_existing.business_date, 'closedAt', v_existing.closed_at,
      'timezone', v_existing.timezone, 'summary', v_existing.summary, 'alreadyClosed', true
    );
  end if;
  if v_latest_opening.id is distinct from v_opening.id then
    raise exception using errcode = '55000', message = 'DAILY_CASH_NOT_ACTIVE|La apertura enviada ya no es la sesión diaria más reciente de esta caja.';
  end if;
  if v_closed_at <= v_opening.opened_at then
    raise exception using errcode = '22007', message = 'La hora de cierre debe ser posterior a la apertura.';
  end if;
  if exists (
    select 1 from public.pos_tables t
    where t.tenant_id = p_tenant_id and t.branch_id = v_register.branch_id and t.status in ('OCCUPIED', 'PRE_CHECK')
  ) or exists (
    select 1 from public.pos_orders o
    where o.tenant_id = p_tenant_id and o.branch_id = v_register.branch_id and o.table_id is not null
      and o.service_type = 'DINE_IN' and o.status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED')
  ) then
    raise exception using errcode = '55000', message = 'No se puede cerrar la caja del día mientras haya mesas o comandas abiertas en la sucursal.';
  end if;

  select coalesce(sum(p.amount) filter (where p.method = 'CASH'),0),
         coalesce(sum(p.amount) filter (where p.method = 'CARD'),0),
         coalesce(sum(p.amount) filter (where p.method = 'SINPE'),0),
         coalesce(sum(p.amount) filter (where p.method = 'CREDIT'),0),
         coalesce(sum(p.amount) filter (where p.method = 'MIXED'),0), count(*)::integer
  into v_cash, v_card, v_sinpe, v_credit, v_mixed, v_payment_count
  from public.pos_payments p
  join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
  where p.tenant_id = p_tenant_id and s.branch_id = v_register.branch_id and s.cash_register_id = v_register.id
    and p.paid_at >= v_opening.opened_at and p.paid_at < v_closed_at and p.status in ('PENDING','AUTHORIZED');
  if exists (
    select 1 from public.pos_payments p join public.pos_orders o on o.tenant_id=p.tenant_id and o.id=p.order_id
    left join public.pos_cash_shifts s on s.tenant_id=p.tenant_id and s.id=p.cash_shift_id
    where p.tenant_id=p_tenant_id and o.branch_id=v_register.branch_id and p.status in ('PENDING','AUTHORIZED')
      and ((p.cash_shift_id is null and (p.paid_at is null or (p.paid_at >= v_opening.opened_at and p.paid_at < v_closed_at)))
       or (s.branch_id=v_register.branch_id and s.cash_register_id=v_register.id and p.paid_at is null))
  ) then v_payments_scope_available := false; end if;

  select count(*)::integer into v_invoice_count
  from public.pos_invoices i join public.pos_payments p on p.tenant_id=i.tenant_id and p.id=i.payment_id
  join public.pos_cash_shifts s on s.tenant_id=p.tenant_id and s.id=p.cash_shift_id
  where i.tenant_id=p_tenant_id and i.branch_id=v_register.branch_id and s.branch_id=v_register.branch_id
    and s.cash_register_id=v_register.id and i.issued_at >= v_opening.opened_at and i.issued_at < v_closed_at;
  if exists (
    select 1 from public.pos_invoices i left join public.pos_payments p on p.tenant_id=i.tenant_id and p.id=i.payment_id
    left join public.pos_cash_shifts s on s.tenant_id=p.tenant_id and s.id=p.cash_shift_id
    where i.tenant_id=p_tenant_id and i.branch_id=v_register.branch_id
      and ((i.issued_at >= v_opening.opened_at and i.issued_at < v_closed_at)
       or (i.issued_at is null and ((s.branch_id=v_register.branch_id and s.cash_register_id=v_register.id
             and s.opened_at < v_closed_at and coalesce(s.closed_at,'infinity'::timestamptz) >= v_opening.opened_at)
          or (p.paid_at >= v_opening.opened_at and p.paid_at < v_closed_at)
          or (p.paid_at is null and i.created_at >= v_opening.opened_at and i.created_at < v_closed_at))))
      and (p.id is null or p.cash_shift_id is null or s.id is null or s.branch_id <> i.branch_id
           or (i.issued_at is null and s.cash_register_id=v_register.id))
  ) then v_documents_scope_available := false; end if;

  select coalesce(sum(case when movement->>'type'='INFLOW' then case when coalesce(movement->>'amount','') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end else 0 end),0),
         coalesce(sum(case when movement->>'type' in ('OUTFLOW','TIP_WITHDRAWAL') then case when coalesce(movement->>'amount','') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end else 0 end),0)
  into v_inflows, v_outflows
  from public.pos_cash_shifts s cross join lateral jsonb_array_elements(coalesce(s.movements,'[]'::jsonb)) entry(movement)
  where s.tenant_id=p_tenant_id and s.branch_id=v_register.branch_id and s.cash_register_id=v_register.id
    and coalesce(movement->>'timestamp','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    and (movement->>'timestamp')::timestamptz >= v_opening.opened_at and (movement->>'timestamp')::timestamptz < v_closed_at;
  if exists (
    select 1 from public.pos_cash_shifts s cross join lateral jsonb_array_elements(coalesce(s.movements,'[]'::jsonb)) entry(movement)
    where s.tenant_id=p_tenant_id and s.branch_id=v_register.branch_id and s.cash_register_id=v_register.id
      and coalesce(movement->>'timestamp','') <> ''
      and not (coalesce(movement->>'timestamp','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')
  ) then v_movements_scope_available := false; end if;
  select count(*)::integer into v_shifts_count
  from public.pos_cash_shifts s
  where s.tenant_id=p_tenant_id and s.branch_id=v_register.branch_id and s.cash_register_id=v_register.id
    and s.status <> 'VOIDED' and s.opened_at < v_closed_at and coalesce(s.closed_at,'infinity'::timestamptz) > v_opening.opened_at;

  v_summary := jsonb_build_object(
    'registerName',v_register.name,'terminalCode',v_register.terminal_code,'branchCode',v_branch.code,
    'openingId',v_opening.id,'openingBusinessDate',v_opening.business_date,'openingAt',v_opening.opened_at,
    'closingAt',v_closed_at,'shiftsCount',v_shifts_count,'initialFloatTotal',0,
    'cashSales',v_cash,'cardSales',v_card,'sinpeSales',v_sinpe,'creditSales',v_credit,'mixedSales',v_mixed,
    'totalSales',v_cash+v_card+v_sinpe+v_credit+v_mixed,'inflowsTotal',v_inflows,'outflowsTotal',v_outflows,
    'taxTotal',0,'service10Total',0,'expectedCash',v_cash+v_inflows-v_outflows,'countedCash',0,'difference',0,
    'paymentsCount',v_payment_count,'invoicesCount',v_invoice_count,
    'documentsCountAvailable',v_documents_scope_available,'paymentsScopeAvailable',v_payments_scope_available,
    'movementsScopeAvailable',v_movements_scope_available,
    'paymentsScopeNote','No se puede confirmar el total de cobros: hay pagos sin turno, fecha o alcance verificable en esta sucursal/caja.',
    'taxesAvailable',false,'taxesNote','Impuestos fuera de este cierre: no hay un desglose fiscal confiable asociado a la caja/sesión.'
  );
  insert into public.pos_daily_cash_closures
    (tenant_id,branch_id,cash_register_id,business_date,timezone,closed_by,closed_at,summary)
  values
    (p_tenant_id,v_register.branch_id,v_register.id,v_opening.business_date,v_branch.timezone,p_closed_by,v_closed_at,v_summary)
  returning * into v_result;
  return jsonb_build_object(
    'closureId',v_result.id,'cashRegisterId',v_result.cash_register_id,'businessDate',v_result.business_date,
    'closedAt',v_result.closed_at,'timezone',v_result.timezone,'summary',v_result.summary,'alreadyClosed',false
  );
end;
$$;
revoke all on function public.pos_close_daily_cash(uuid,uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.pos_close_daily_cash(uuid,uuid,date,uuid) to service_role;

create or replace function public.guard_pos_daily_cash_closure_opening()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_opening public.pos_daily_cash_openings%rowtype; v_latest public.pos_daily_cash_openings%rowtype;
begin
  perform 1 from public.pos_cash_registers r where r.tenant_id=new.tenant_id and r.branch_id=new.branch_id and r.id=new.cash_register_id for update;
  if not found then raise exception using errcode='23503',message='No se encontró la caja del cierre diario.'; end if;
  select o.* into v_opening from public.pos_daily_cash_openings o
  where o.tenant_id=new.tenant_id and o.branch_id=new.branch_id and o.cash_register_id=new.cash_register_id and o.business_date=new.business_date
  for update;
  if not found then
    raise exception using errcode='55000',message='DAILY_CASH_NOT_OPEN|No se puede cerrar la caja del día sin registrar primero su apertura diaria.';
  end if;
  if new.closed_by is distinct from v_opening.opened_by then
    raise exception using errcode='42501',message='DAILY_CASH_OWNER_ONLY|Solo la identidad que abrió la sesión puede cerrarla.';
  end if;
  select o.* into v_latest from public.pos_daily_cash_openings o
  where o.tenant_id=new.tenant_id and o.branch_id=new.branch_id and o.cash_register_id=new.cash_register_id and o.opened_at <= new.closed_at
  order by o.opened_at desc,o.id desc limit 1 for update;
  if not found or v_latest.id is distinct from v_opening.id then
    raise exception using errcode='55000',message='DAILY_CASH_NOT_ACTIVE|El cierre no corresponde a la sesión diaria más reciente de esta caja.';
  end if;
  if new.closed_at <= v_opening.opened_at then
    raise exception using errcode='22007',message='La hora de cierre debe ser posterior a la apertura.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_daily_cash_closure_opening() from public, anon, authenticated;
drop trigger if exists pos_daily_cash_closures_guard_opening on public.pos_daily_cash_closures;
create trigger pos_daily_cash_closures_guard_opening before insert on public.pos_daily_cash_closures for each row execute function public.guard_pos_daily_cash_closure_opening();

create or replace function public.guard_pos_cash_shift_daily_opening()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_register public.pos_cash_registers%rowtype; v_opening public.pos_daily_cash_openings%rowtype;
begin
  if new.status <> 'OPEN' then return new; end if;
  select * into v_register from public.pos_cash_registers r where r.tenant_id=new.tenant_id and r.branch_id=new.branch_id and r.id=new.cash_register_id for update;
  if not found then raise exception using errcode='23503',message='No se encontró la caja del turno.'; end if;
  select o.* into v_opening from public.pos_daily_cash_openings o
  where o.tenant_id=new.tenant_id and o.branch_id=v_register.branch_id and o.cash_register_id=v_register.id and o.opened_at <= new.opened_at
  order by o.opened_at desc,o.id desc limit 1;
  if not found then raise exception using errcode='55000',message='DAILY_CASH_NOT_OPEN|Abre primero la sesión diaria antes de iniciar un turno.'; end if;
  if new.opened_at < v_opening.opened_at then raise exception using errcode='55000',message='DAILY_CASH_NOT_OPEN|La apertura de turno no puede ser anterior a la apertura de caja.'; end if;
  if exists (select 1 from public.pos_daily_cash_closures c where c.tenant_id=v_opening.tenant_id and c.branch_id=v_opening.branch_id and c.cash_register_id=v_opening.cash_register_id and c.business_date=v_opening.business_date) then
    raise exception using errcode='55000',message='DAILY_CASH_CLOSED|No se puede abrir un turno porque la sesión diaria correspondiente ya está cerrada.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_cash_shift_daily_opening() from public, anon, authenticated;
drop trigger if exists pos_cash_shifts_guard_daily_opening on public.pos_cash_shifts;
create trigger pos_cash_shifts_guard_daily_opening before insert or update of status,opened_at,cash_register_id,branch_id on public.pos_cash_shifts for each row execute function public.guard_pos_cash_shift_daily_opening();

create or replace function public.guard_pos_payment_daily_cash_opening()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_shift public.pos_cash_shifts%rowtype; v_register public.pos_cash_registers%rowtype; v_opening public.pos_daily_cash_openings%rowtype; v_paid_at timestamptz;
begin
  if new.status not in ('PENDING','AUTHORIZED') then return new; end if;
  if TG_OP='UPDATE' and new.tenant_id is not distinct from old.tenant_id and new.cash_shift_id is not distinct from old.cash_shift_id and new.paid_at is not distinct from old.paid_at and new.amount is not distinct from old.amount and new.method is not distinct from old.method then return new; end if;
  if new.cash_shift_id is null then raise exception using errcode='P0001',message='DAILY_CASH_NOT_OPEN|El cobro requiere una apertura diaria y un turno válido.'; end if;
  select * into v_shift from public.pos_cash_shifts s where s.tenant_id=new.tenant_id and s.id=new.cash_shift_id for update;
  if not found then raise exception using errcode='23503',message='No se encontró el turno asociado al cobro.'; end if;
  select * into v_register from public.pos_cash_registers r where r.tenant_id=new.tenant_id and r.branch_id=v_shift.branch_id and r.id=v_shift.cash_register_id for update;
  if not found then raise exception using errcode='23503',message='No se encontró la caja asociada al turno.'; end if;
  v_paid_at:=coalesce(new.paid_at,new.created_at,clock_timestamp());
  select o.* into v_opening from public.pos_daily_cash_openings o
  where o.tenant_id=new.tenant_id and o.branch_id=v_register.branch_id and o.cash_register_id=v_register.id and o.opened_at <= v_paid_at
  order by o.opened_at desc,o.id desc limit 1 for update;
  if not found then raise exception using errcode='P0001',message='DAILY_CASH_NOT_OPEN|No existe una sesión diaria abierta para la hora del cobro.'; end if;
  if exists (select 1 from public.pos_daily_cash_closures c where c.tenant_id=v_opening.tenant_id and c.branch_id=v_opening.branch_id and c.cash_register_id=v_opening.cash_register_id and c.business_date=v_opening.business_date) then
    raise exception using errcode='P0001',message='DAILY_CASH_CLOSED|La sesión diaria correspondiente al cobro ya está cerrada; el cobro no se registró.';
  end if;
  if v_paid_at < v_opening.opened_at then raise exception using errcode='P0001',message='DAILY_CASH_NOT_OPEN|El cobro es anterior a la apertura diaria; el cobro no se registró.'; end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_payment_daily_cash_opening() from public, anon, authenticated;
drop trigger if exists pos_payments_guard_daily_cash_opening on public.pos_payments;
create trigger pos_payments_guard_daily_cash_opening before insert or update of tenant_id,cash_shift_id,paid_at,amount,method,status on public.pos_payments for each row execute function public.guard_pos_payment_daily_cash_opening();

create or replace function public.guard_pos_payment_daily_cash_closure()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_shift public.pos_cash_shifts%rowtype; v_register public.pos_cash_registers%rowtype; v_opening public.pos_daily_cash_openings%rowtype; v_old_opening public.pos_daily_cash_openings%rowtype; v_paid_at timestamptz; v_old_paid_at timestamptz;
begin
  if new.cash_shift_id is null then raise exception using errcode='23502',message='El cobro requiere un turno abierto o válido para atribuirlo a una caja registrada.'; end if;
  if TG_OP='UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.cash_shift_id is distinct from old.cash_shift_id) then raise exception using errcode='55000',message='No se puede reasignar un cobro ya registrado a otra sucursal, caja o turno.'; end if;
  select * into v_shift from public.pos_cash_shifts s where s.tenant_id=new.tenant_id and s.id=new.cash_shift_id for update;
  if not found or v_shift.status not in ('OPEN','CLOSED') then raise exception using errcode='23503',message='No se encontró un turno válido para la caja del cobro.'; end if;
  select * into v_register from public.pos_cash_registers r where r.tenant_id=new.tenant_id and r.id=v_shift.cash_register_id for update;
  if not found then raise exception using errcode='23503',message='No se encontró la caja registrada del cobro.'; end if;
  if v_shift.branch_id<>v_register.branch_id then raise exception using errcode='23514',message='El turno y la caja del cobro no pertenecen a la misma sucursal.'; end if;
  v_paid_at:=coalesce(new.paid_at,new.created_at,clock_timestamp()); new.paid_at:=v_paid_at;
  select o.* into v_opening from public.pos_daily_cash_openings o where o.tenant_id=new.tenant_id and o.branch_id=v_register.branch_id and o.cash_register_id=v_register.id and o.opened_at <= v_paid_at order by o.opened_at desc,o.id desc limit 1 for update;
  if not found then raise exception using errcode='P0001',message='DAILY_CASH_NOT_OPEN|No existe una sesión diaria para la hora del cobro.'; end if;
  if v_paid_at < v_shift.opened_at or v_paid_at >= coalesce(v_shift.closed_at,'infinity'::timestamptz) then raise exception using errcode='22007',message='El cobro ocurrió fuera del intervalo del turno asociado.'; end if;
  if TG_OP='UPDATE' then
    v_old_paid_at:=coalesce(old.paid_at,old.created_at,clock_timestamp());
    select o.* into v_old_opening from public.pos_daily_cash_openings o where o.tenant_id=old.tenant_id and o.branch_id=v_register.branch_id and o.cash_register_id=v_register.id and o.opened_at <= v_old_paid_at order by o.opened_at desc,o.id desc limit 1;
    if found and exists (select 1 from public.pos_daily_cash_closures c where c.tenant_id=v_old_opening.tenant_id and c.branch_id=v_old_opening.branch_id and c.cash_register_id=v_old_opening.cash_register_id and c.business_date=v_old_opening.business_date) then raise exception using errcode='P0001',message='DAILY_CASH_CLOSED|No se puede modificar un cobro ya incluido en una sesión cerrada.'; end if;
  end if;
  if exists (select 1 from public.pos_daily_cash_closures c where c.tenant_id=v_opening.tenant_id and c.branch_id=v_opening.branch_id and c.cash_register_id=v_opening.cash_register_id and c.business_date=v_opening.business_date) then raise exception using errcode='P0001',message='DAILY_CASH_CLOSED|La sesión diaria correspondiente al cobro ya está cerrada; el cobro no se registró.'; end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_payment_daily_cash_closure() from public, anon, authenticated;
drop trigger if exists pos_payments_guard_daily_cash_closure on public.pos_payments;
create trigger pos_payments_guard_daily_cash_closure before insert or update of tenant_id,cash_shift_id,paid_at,amount,method,status on public.pos_payments for each row execute function public.guard_pos_payment_daily_cash_closure();

comment on function public.pos_open_daily_cash(uuid,uuid,uuid) is 'Abre una sesión diaria idempotente; una apertura sin cierre explícito continúa a través de medianoche y conserva su fecha de negocio original.';
comment on function public.pos_close_daily_cash(uuid,uuid,date,uuid) is 'Cierra la sesión identificada por la fecha de negocio de su apertura; solo opened_by puede cerrarla y el resumen usa opened_at <= instante < closed_at.';
comment on function public.guard_pos_daily_cash_closure_opening() is 'Exige una apertura diaria previa para la fecha original del cierre y serializa con la caja.';
comment on function public.guard_pos_cash_shift_daily_opening() is 'Exige una sesión diaria vigente antes de iniciar o reabrir un turno; no altera la semántica de cierre de turno.';
comment on function public.guard_pos_payment_daily_cash_opening() is 'Asocia el cobro a la última apertura anterior a paid_at y rechaza la sesión si ya fue cerrada.';
comment on function public.guard_pos_payment_daily_cash_closure() is 'Bloquea cobros posteriores al cierre de su sesión de apertura y conserva el intervalo del turno asociado.';

-- Riesgo de compatibilidad histórica:
-- Las sesiones legacy abiertas por employee guardan owner auth.userId y no se
-- pueden distinguir retroactivamente. Esta migración no inventa reatribución ni
-- modifica opened_by existente; el endpoint debe pasar la identidad opaca
-- correcta al abrir y al cerrar.
--
-- Plan de pruebas temporal (fixtures sintéticos; no forma parte de la migración):
-- 1) Abrir a las 23:59: crear pagos antes y después de medianoche en el mismo
--    turno; verificar que ambos resuelven la misma opening.business_date y que
--    el resumen los suma en [opened_at, closed_at).
-- 2) Intentar cerrar con identidad distinta a opening.opened_by; verificar
--    DAILY_CASH_OWNER_ONLY y ausencia de fila de cierre.
-- 3) Tras cambiar de día, cerrar pasando la businessDate original; verificar
--    owner exacto, cierre en esa fecha y resumen de sesión completo.
-- 4) Tras cerrar, intentar pago posterior; verificar DAILY_CASH_CLOSED; luego
--    abrir la fecha siguiente y verificar que un pago nuevo de esa sesión sí
--    entra. También verificar que no se creó apertura nueva al dar open antes
--    del cierre de la sesión anterior.
-- 5) SIN cambio en cierre de turno: probar pos_close_cash_shift y sus guards
--    con fixtures equivalentes; confirmar que sus contratos y semántica quedan
--    intactos.
