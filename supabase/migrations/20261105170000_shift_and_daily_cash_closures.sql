-- SaborAI POS: cierre de turno por intervalo y cierre diario por caja registrada.
--
-- Dependencias requeridas (ejecutadas previamente en este orden):
--   1. 20261017000000_pos_core.sql
--   2. 20261024020000_phase3_hacienda_history.sql (invoice_data y comprobantes)
--   3. 20261026000000_phase8_central_cash_registers.sql
--   4. 20261026010000_phase2_cash_control_sync.sql (legacy_id para IDs locales)
-- Esta migración es aditiva. No elimina ni transforma comandas, pagos o cierres históricos.
-- No agrega alcance redundante a pagos/facturas ni backfillea atribuciones.
-- pagos se asignan por pos_payments.cash_shift_id; facturas solo por payment_id + issued_at.
-- No aplicar hasta que Maikol revise y apruebe este SQL completo.

do $$
begin
  if to_regclass('public.pos_branches') is null
     or to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null
     or to_regclass('public.pos_tables') is null
     or to_regclass('public.pos_orders') is null
     or to_regclass('public.pos_payments') is null
     or to_regclass('public.pos_invoices') is null then
    raise exception using
      errcode = '42P01',
      message = 'Faltan migraciones POS base, historial fiscal, multi-caja o de sincronización legacy; ejecute las dependencias indicadas antes de esta migración.';
  end if;

  if exists (
    select 1
    from (values
      ('pos_payments', 'id'), ('pos_payments', 'tenant_id'), ('pos_payments', 'order_id'),
      ('pos_payments', 'cash_shift_id'), ('pos_payments', 'paid_at'),
      ('pos_payments', 'amount'), ('pos_payments', 'method'), ('pos_payments', 'status'), ('pos_payments', 'created_at'),
      ('pos_payments', 'provider'), ('pos_payments', 'provider_transaction_id'), ('pos_payments', 'idempotency_key'),
      ('pos_invoices', 'id'), ('pos_invoices', 'tenant_id'), ('pos_invoices', 'branch_id'),
      ('pos_invoices', 'order_id'), ('pos_invoices', 'payment_id'), ('pos_invoices', 'created_at'),
      ('pos_invoices', 'clave'), ('pos_invoices', 'consecutivo'), ('pos_invoices', 'document_type'),
      ('pos_invoices', 'hacienda_status'), ('pos_invoices', 'total'), ('pos_invoices', 'invoice_data'), ('pos_invoices', 'xml_content'),
      ('pos_cash_shifts', 'tenant_id'), ('pos_cash_shifts', 'branch_id'), ('pos_cash_shifts', 'cash_register_id'),
      ('pos_cash_shifts', 'status'), ('pos_cash_shifts', 'opened_at'), ('pos_cash_shifts', 'closed_at'),
      ('pos_cash_shifts', 'legacy_id'), ('pos_cash_shifts', 'opening_float'), ('pos_cash_shifts', 'expected_cash'),
      ('pos_cash_shifts', 'counted_cash'), ('pos_cash_shifts', 'difference'), ('pos_cash_shifts', 'closed_by'),
      ('pos_cash_shifts', 'system_summary'), ('pos_cash_shifts', 'movements'), ('pos_cash_shifts', 'notes'),
      ('pos_cash_shifts', 'cash_breakdown'), ('pos_cash_shifts', 'counted_cards'),
      ('pos_cash_shifts', 'dataphones_breakdown'), ('pos_cash_shifts', 'counted_sinpe'),
      ('pos_cash_shifts', 'difference_reason'), ('pos_cash_shifts', 'z_report_generated'), ('pos_cash_shifts', 'updated_at'),
      ('pos_cash_registers', 'tenant_id'), ('pos_cash_registers', 'branch_id'), ('pos_cash_registers', 'legacy_id'),
      ('pos_cash_registers', 'is_active'), ('pos_cash_registers', 'name'), ('pos_cash_registers', 'terminal_code'),
      ('pos_branches', 'tenant_id'), ('pos_branches', 'timezone'), ('pos_branches', 'is_active'), ('pos_branches', 'code'),
      ('pos_tables', 'tenant_id'), ('pos_tables', 'branch_id'), ('pos_tables', 'status'),
      ('pos_orders', 'id'), ('pos_orders', 'tenant_id'), ('pos_orders', 'branch_id'), ('pos_orders', 'table_id'),
      ('pos_orders', 'service_type'), ('pos_orders', 'status'), ('pos_orders', 'idempotency_key'),
      ('pos_orders', 'cash_shift_id')
    ) as required(table_name, column_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = required.table_name
     and c.column_name = required.column_name
    where c.column_name is null
  ) then
    raise exception using
      errcode = '42703',
      message = 'Falta una columna del esquema requerida por el cierre; revise las migraciones POS base, multi-caja y legacy antes de aplicar esta migración.';
  end if;
end;
$$;

-- Fecha fiscal de emisión, separada de created_at (hora de recepción/sync).
-- Se deja NULL cuando el comprobante no proporciona una fecha ISO con zona.
alter table public.pos_invoices
  add column if not exists issued_at timestamptz;

comment on column public.pos_invoices.issued_at is
  'Instante fiscal de emisión validado desde invoice_data.fechaEmision; NULL si no incluye zona horaria explícita.';

create index if not exists pos_payments_shift_paid_at_idx
  on public.pos_payments(tenant_id, cash_shift_id, paid_at)
  where cash_shift_id is not null and paid_at is not null;

create index if not exists pos_invoices_branch_issued_at_idx
  on public.pos_invoices(tenant_id, branch_id, issued_at)
  where issued_at is not null;

create index if not exists pos_invoices_payment_id_idx
  on public.pos_invoices(tenant_id, payment_id)
  where payment_id is not null;

create table if not exists public.pos_daily_cash_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  business_date date not null,
  timezone text not null,
  closed_by uuid,
  closed_at timestamptz not null default clock_timestamp(),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, cash_register_id, business_date),
  check (jsonb_typeof(summary) = 'object')
);

create index if not exists pos_daily_cash_closures_tenant_date_idx
  on public.pos_daily_cash_closures(tenant_id, business_date desc);

alter table public.pos_daily_cash_closures enable row level security;
alter table public.pos_daily_cash_closures force row level security;

-- Solo las funciones SECURITY DEFINER llamadas desde el backend con service_role
-- acceden a la nueva tabla; no se conceden lecturas directas al navegador.

create or replace function public.pos_close_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_closed_by uuid,
  p_counted_cash numeric,
  p_counted_cards numeric,
  p_counted_sinpe numeric,
  p_cash_breakdown jsonb,
  p_dataphones_breakdown jsonb,
  p_difference_reason text,
  p_notes text,
  p_system_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.pos_cash_shifts%rowtype;
  v_closed_at timestamptz := clock_timestamp();
  v_cash numeric(14,2) := 0;
  v_card numeric(14,2) := 0;
  v_sinpe numeric(14,2) := 0;
  v_credit numeric(14,2) := 0;
  v_mixed numeric(14,2) := 0;
  v_payment_count integer := 0;
  v_inflows numeric(14,2) := 0;
  v_outflows numeric(14,2) := 0;
  v_expected_cash numeric(14,2) := 0;
  v_difference numeric(14,2);
  v_invoice_count integer := 0;
  v_payments_scope_available boolean := true;
  v_documents_count_available boolean := true;
  v_summary jsonb;
begin
  select * into v_shift
  from public.pos_cash_shifts
  where tenant_id = p_tenant_id and id = p_shift_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'No existe el turno de esta caja.';
  end if;

  if v_shift.status = 'CLOSED' then
    if v_shift.closed_by = p_closed_by then
      return jsonb_build_object(
        'shiftId', v_shift.id,
        'closedAt', v_shift.closed_at,
        'expectedCash', v_shift.expected_cash,
        'countedCash', v_shift.counted_cash,
        'difference', v_shift.difference,
        'summary', v_shift.system_summary,
        'alreadyClosed', true
      );
    end if;
    raise exception using errcode = '23505', message = 'Este turno ya fue cerrado.';
  end if;

  if v_shift.status <> 'OPEN' then
    raise exception using errcode = '55000', message = 'El turno no está abierto y no se puede cerrar.';
  end if;

  if v_closed_at <= v_shift.opened_at then
    raise exception using errcode = '22007', message = 'La hora de cierre debe ser posterior a la apertura.';
  end if;

  select
    coalesce(sum(p.amount) filter (where p.method = 'CASH'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'CARD'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'SINPE'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'CREDIT'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'MIXED'), 0),
    count(*)::integer
  into v_cash, v_card, v_sinpe, v_credit, v_mixed, v_payment_count
  from public.pos_payments p
  where p.tenant_id = p_tenant_id
    and p.cash_shift_id = v_shift.id
    and p.paid_at >= v_shift.opened_at
    and p.paid_at < v_closed_at
    and p.status in ('PENDING', 'AUTHORIZED');

  if exists (
    select 1
    from public.pos_payments p
    join public.pos_orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
    where p.tenant_id = p_tenant_id
      and o.branch_id = v_shift.branch_id
      and p.status in ('PENDING', 'AUTHORIZED')
      and (
        (p.cash_shift_id is null and (p.paid_at is null or (p.paid_at >= v_shift.opened_at and p.paid_at < v_closed_at)))
        or (p.cash_shift_id = v_shift.id and p.paid_at is null)
      )
  ) then
    v_payments_scope_available := false;
  end if;

  select count(*)::integer into v_invoice_count
  from public.pos_invoices i
  join public.pos_payments p on p.tenant_id = i.tenant_id and p.id = i.payment_id
  where i.tenant_id = p_tenant_id
    and i.branch_id = v_shift.branch_id
    and p.cash_shift_id = v_shift.id
    and i.issued_at >= v_shift.opened_at
    and i.issued_at < v_closed_at;

  if exists (
    select 1
    from public.pos_invoices i
    left join public.pos_payments p on p.tenant_id = i.tenant_id and p.id = i.payment_id
    left join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
    where i.tenant_id = p_tenant_id
      and i.branch_id = v_shift.branch_id
      and (
        (i.issued_at >= v_shift.opened_at and i.issued_at < v_closed_at)
        or (i.issued_at is null and (
          p.cash_shift_id = v_shift.id
          or
          (p.paid_at >= v_shift.opened_at and p.paid_at < v_closed_at)
          or (p.paid_at is null and i.created_at >= v_shift.opened_at and i.created_at < v_closed_at)
        ))
      )
      and (
        p.id is null or p.cash_shift_id is null or s.id is null or s.branch_id <> i.branch_id
        or (i.issued_at is null and p.cash_shift_id = v_shift.id)
      )
  ) then
    v_documents_count_available := false;
  end if;

  select
    coalesce(sum(case when movement->>'type' = 'INFLOW' then
      case when coalesce(movement->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end
      else 0 end), 0),
    coalesce(sum(case when movement->>'type' in ('OUTFLOW', 'TIP_WITHDRAWAL') then
      case when coalesce(movement->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end
      else 0 end), 0)
  into v_inflows, v_outflows
  from jsonb_array_elements(coalesce(v_shift.movements, '[]'::jsonb)) as entry(movement);

  v_expected_cash := coalesce(v_shift.opening_float, 0) + v_cash + v_inflows - v_outflows;
  if p_counted_cash is not null then
    v_difference := p_counted_cash - v_expected_cash;
  end if;

  v_summary := jsonb_build_object(
    'cashSales', v_cash,
    'cardSales', v_card,
    'sinpeSales', v_sinpe,
    'creditSales', v_credit,
    'mixedSales', v_mixed,
    'totalSales', v_cash + v_card + v_sinpe + v_credit + v_mixed,
    'subtotal', 0,
    'totalTax', 0,
    'serviceTax10', 0,
    'taxesAvailable', false,
    'taxesNote', 'Impuestos fuera de este cierre: no hay un desglose fiscal confiable asociado a la caja/turno.',
    'documentsCountAvailable', v_documents_count_available,
    'paymentsScopeAvailable', v_payments_scope_available,
    'paymentsScopeNote', 'No se puede confirmar el total de cobros: hay pagos sin turno o fecha de cobro verificables en esta sucursal.',
    'totalInflows', v_inflows,
    'totalOutflows', v_outflows,
    'expectedCashInDrawer', v_expected_cash,
    'invoicesCount', v_invoice_count,
    'paymentsCount', v_payment_count
  );

  update public.pos_cash_shifts
  set status = 'CLOSED',
      closed_by = p_closed_by,
      closed_at = v_closed_at,
      expected_cash = v_expected_cash,
      counted_cash = p_counted_cash,
      difference = v_difference,
      notes = coalesce(p_notes, notes),
      system_summary = v_summary,
      cash_breakdown = p_cash_breakdown,
      counted_cards = p_counted_cards,
      dataphones_breakdown = p_dataphones_breakdown,
      counted_sinpe = p_counted_sinpe,
      difference_reason = p_difference_reason,
      z_report_generated = true,
      updated_at = now()
  where id = v_shift.id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'shiftId', v_shift.id,
    'closedAt', v_closed_at,
    'expectedCash', v_expected_cash,
    'countedCash', p_counted_cash,
    'difference', v_difference,
    'summary', v_summary,
    'alreadyClosed', false
  );
end;
$$;

revoke all on function public.pos_close_cash_shift(uuid, uuid, uuid, numeric, numeric, numeric, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_close_cash_shift(uuid, uuid, uuid, numeric, numeric, numeric, jsonb, jsonb, text, text, jsonb) to service_role;

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
  v_existing public.pos_daily_cash_closures%rowtype;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_closed_at timestamptz := clock_timestamp();
  v_cash numeric(14,2) := 0;
  v_card numeric(14,2) := 0;
  v_sinpe numeric(14,2) := 0;
  v_credit numeric(14,2) := 0;
  v_mixed numeric(14,2) := 0;
  v_payment_count integer := 0;
  v_payments_scope_available boolean := true;
  v_invoice_count integer := 0;
  v_documents_count_available boolean := true;
  v_inflows numeric(14,2) := 0;
  v_outflows numeric(14,2) := 0;
  v_shifts_count integer := 0;
  v_expected_cash numeric(14,2) := 0;
  v_summary jsonb;
  v_result public.pos_daily_cash_closures%rowtype;
begin
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

  select * into v_existing
  from public.pos_daily_cash_closures
  where tenant_id = p_tenant_id
    and branch_id = v_register.branch_id
    and cash_register_id = v_register.id
    and business_date = p_business_date;

  if found then
    return jsonb_build_object(
      'closureId', v_existing.id,
      'cashRegisterId', v_existing.cash_register_id,
      'businessDate', v_existing.business_date,
      'closedAt', v_existing.closed_at,
      'timezone', v_existing.timezone,
      'summary', v_existing.summary,
      'alreadyClosed', true
    );
  end if;

  v_day_start := p_business_date::timestamp at time zone v_branch.timezone;
  v_day_end := (p_business_date + 1)::timestamp at time zone v_branch.timezone;

  if exists (
    select 1
    from public.pos_tables t
    where t.tenant_id = p_tenant_id
      and t.branch_id = v_register.branch_id
      and t.status in ('OCCUPIED', 'PRE_CHECK')
  ) or exists (
    select 1
    from public.pos_orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = v_register.branch_id
      and o.table_id is not null
      and o.service_type = 'DINE_IN'
      and o.status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED')
  ) then
    raise exception using errcode = '55000', message = 'No se puede cerrar la caja del día mientras haya mesas o comandas abiertas en la sucursal.';
  end if;

  select
    coalesce(sum(p.amount) filter (where p.method = 'CASH'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'CARD'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'SINPE'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'CREDIT'), 0),
    coalesce(sum(p.amount) filter (where p.method = 'MIXED'), 0),
    count(*)::integer
  into v_cash, v_card, v_sinpe, v_credit, v_mixed, v_payment_count
  from public.pos_payments p
  join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
  where p.tenant_id = p_tenant_id
    and s.branch_id = v_register.branch_id
    and s.cash_register_id = v_register.id
    and p.paid_at >= v_day_start
    and p.paid_at < v_day_end
    and p.status in ('PENDING', 'AUTHORIZED');

  if exists (
    select 1
    from public.pos_payments p
    join public.pos_orders o on o.tenant_id = p.tenant_id and o.id = p.order_id
    left join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
    where p.tenant_id = p_tenant_id
      and o.branch_id = v_register.branch_id
      and p.status in ('PENDING', 'AUTHORIZED')
      and (
        (p.cash_shift_id is null and (p.paid_at is null or (p.paid_at >= v_day_start and p.paid_at < v_day_end)))
        or (s.branch_id = v_register.branch_id and s.cash_register_id = v_register.id and p.paid_at is null)
      )
  ) then
    v_payments_scope_available := false;
  end if;

  select count(*)::integer into v_invoice_count
  from public.pos_invoices i
  join public.pos_payments p on p.tenant_id = i.tenant_id and p.id = i.payment_id
  join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
  where i.tenant_id = p_tenant_id
    and i.branch_id = v_register.branch_id
    and s.branch_id = v_register.branch_id
    and s.cash_register_id = v_register.id
    and i.issued_at >= v_day_start
    and i.issued_at < v_day_end;

  if exists (
    select 1
    from public.pos_invoices i
    left join public.pos_payments p on p.tenant_id = i.tenant_id and p.id = i.payment_id
    left join public.pos_cash_shifts s on s.tenant_id = p.tenant_id and s.id = p.cash_shift_id
    where i.tenant_id = p_tenant_id
      and i.branch_id = v_register.branch_id
      and (
        (i.issued_at >= v_day_start and i.issued_at < v_day_end)
        or (i.issued_at is null and (
          (s.branch_id = v_register.branch_id and s.cash_register_id = v_register.id
            and s.opened_at < v_day_end and coalesce(s.closed_at, 'infinity'::timestamptz) >= v_day_start)
          or
          (p.paid_at >= v_day_start and p.paid_at < v_day_end)
          or (p.paid_at is null and i.created_at >= v_day_start and i.created_at < v_day_end)
        ))
      )
      and (
        p.id is null or p.cash_shift_id is null or s.id is null or s.branch_id <> i.branch_id
        or (i.issued_at is null and s.cash_register_id = v_register.id)
      )
  ) then
    v_documents_count_available := false;
  end if;

  select
    coalesce(sum(case when movement->>'type' = 'INFLOW' then
      case when coalesce(movement->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end
      else 0 end), 0),
    coalesce(sum(case when movement->>'type' in ('OUTFLOW', 'TIP_WITHDRAWAL') then
      case when coalesce(movement->>'amount', '') ~ '^[0-9]+([.][0-9]+)?$' then (movement->>'amount')::numeric else 0 end
      else 0 end), 0)
  into v_inflows, v_outflows
  from public.pos_cash_shifts s
  cross join lateral jsonb_array_elements(coalesce(s.movements, '[]'::jsonb)) as entry(movement)
  where s.tenant_id = p_tenant_id
    and s.branch_id = v_register.branch_id
    and s.cash_register_id = v_register.id
    and coalesce(movement->>'timestamp', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    and (movement->>'timestamp')::timestamptz >= v_day_start
    and (movement->>'timestamp')::timestamptz < v_day_end;

  select count(*)::integer into v_shifts_count
  from public.pos_cash_shifts s
  where s.tenant_id = p_tenant_id
    and s.branch_id = v_register.branch_id
    and s.cash_register_id = v_register.id
    and s.status <> 'VOIDED'
    and s.opened_at < v_day_end
    and coalesce(s.closed_at, 'infinity'::timestamptz) >= v_day_start;

  v_expected_cash := v_cash + v_inflows - v_outflows;
  v_summary := jsonb_build_object(
    'registerName', v_register.name,
    'terminalCode', v_register.terminal_code,
    'branchCode', v_branch.code,
    'shiftsCount', v_shifts_count,
    'initialFloatTotal', 0,
    'cashSales', v_cash,
    'cardSales', v_card,
    'sinpeSales', v_sinpe,
    'creditSales', v_credit,
    'mixedSales', v_mixed,
    'totalSales', v_cash + v_card + v_sinpe + v_credit + v_mixed,
    'inflowsTotal', v_inflows,
    'outflowsTotal', v_outflows,
    'taxTotal', 0,
    'service10Total', 0,
    'expectedCash', v_expected_cash,
    'countedCash', 0,
    'difference', 0,
    'paymentsCount', v_payment_count,
    'invoicesCount', v_invoice_count,
    'documentsCountAvailable', v_documents_count_available,
    'paymentsScopeAvailable', v_payments_scope_available,
    'paymentsScopeNote', 'No se puede confirmar el total de cobros: hay pagos sin turno o fecha de cobro verificables en esta sucursal.',
    'taxesAvailable', false,
    'taxesNote', 'Impuestos fuera de este cierre: no hay un desglose fiscal confiable asociado a la caja/turno.'
  );

  insert into public.pos_daily_cash_closures (
    tenant_id, branch_id, cash_register_id, business_date, timezone, closed_by, closed_at, summary
  ) values (
    p_tenant_id, v_register.branch_id, v_register.id, p_business_date, v_branch.timezone, p_closed_by, v_closed_at, v_summary
  ) returning * into v_result;

  return jsonb_build_object(
    'closureId', v_result.id,
    'cashRegisterId', v_result.cash_register_id,
    'businessDate', v_result.business_date,
    'closedAt', v_result.closed_at,
    'timezone', v_result.timezone,
    'summary', v_result.summary,
    'alreadyClosed', false
  );
end;
$$;

revoke all on function public.pos_close_daily_cash(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.pos_close_daily_cash(uuid, uuid, date, uuid) to service_role;

comment on table public.pos_daily_cash_closures is
  'Cierre diario inmutable por caja registrada. Se calcula por fecha local de sucursal y solo si no hay comandas de mesa abiertas.';
comment on function public.pos_close_cash_shift(uuid, uuid, uuid, numeric, numeric, numeric, jsonb, jsonb, text, text, jsonb) is
  'Cierra un turno con pagos cobrados en el intervalo semiabierto apertura <= paid_at < cierre; no cambia el estado de mesas ni comandas.';

-- Serializa cada inserción de pago con pos_close_daily_cash, que también bloquea
-- la fila de caja. Así, una carrera queda en uno de dos estados seguros: el pago
-- entra antes y se incluye en el cierre, o espera y se rechaza después del cierre.
create or replace function public.guard_pos_payment_daily_cash_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.pos_cash_shifts%rowtype;
  v_register public.pos_cash_registers%rowtype;
  v_timezone text;
  v_old_paid_at timestamptz;
  v_paid_at timestamptz;
  v_old_business_date date;
  v_business_date date;
begin
  if new.cash_shift_id is null then
    raise exception using
      errcode = '23502',
      message = 'El cobro requiere un turno abierto o válido para atribuirlo a una caja registrada.';
  end if;

  if TG_OP = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.cash_shift_id is distinct from old.cash_shift_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'No se puede reasignar un cobro ya registrado a otra sucursal, caja o turno.';
  end if;

  select * into v_shift
  from public.pos_cash_shifts
  where tenant_id = new.tenant_id and id = new.cash_shift_id
  for update;

  if not found or v_shift.status not in ('OPEN', 'CLOSED') then
    raise exception using
      errcode = '23503',
      message = 'No se encontró un turno válido para la caja del cobro.';
  end if;

  select * into v_register
  from public.pos_cash_registers
  where tenant_id = new.tenant_id and id = v_shift.cash_register_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'No se encontró la caja registrada del cobro.';
  end if;

  if v_shift.branch_id <> v_register.branch_id then
    raise exception using
      errcode = '23514',
      message = 'El turno y la caja del cobro no pertenecen a la misma sucursal.';
  end if;

  select timezone into v_timezone
  from public.pos_branches
  where tenant_id = new.tenant_id and id = v_register.branch_id;

  if v_timezone is null then
    raise exception using
      errcode = '55000',
      message = 'No se pudo determinar la fecha local de la caja; el cobro no se registró. Contacte al administrador.';
  end if;

  v_paid_at := coalesce(new.paid_at, new.created_at, clock_timestamp());
  new.paid_at := v_paid_at;
  v_business_date := (v_paid_at at time zone v_timezone)::date;

  if v_paid_at < v_shift.opened_at
     or v_paid_at >= coalesce(v_shift.closed_at, 'infinity'::timestamptz) then
    raise exception using
      errcode = '22007',
      message = 'El cobro ocurrió fuera del intervalo del turno asociado.';
  end if;

  if TG_OP = 'UPDATE' then
    v_old_paid_at := coalesce(old.paid_at, old.created_at, clock_timestamp());
    v_old_business_date := (v_old_paid_at at time zone v_timezone)::date;
    if exists (
      select 1
      from public.pos_daily_cash_closures c
      where c.tenant_id = old.tenant_id
        and c.branch_id = v_register.branch_id
        and c.cash_register_id = v_register.id
        and c.business_date = v_old_business_date
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'DAILY_CASH_CLOSED|' || format(
          'No se puede modificar un cobro ya incluido en el cierre diario de la caja "%s" para el %s. Contacte al administrador.',
          v_register.name,
          to_char(v_old_business_date, 'YYYY-MM-DD')
        );
    end if;
  end if;

  if exists (
    select 1
    from public.pos_daily_cash_closures c
    where c.tenant_id = new.tenant_id
      and c.branch_id = v_register.branch_id
      and c.cash_register_id = v_register.id
      and c.business_date = v_business_date
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_CASH_CLOSED|' || format(
        'No se puede registrar el cobro: la caja "%s" ya tiene cierre diario para el %s. El cobro no se registró. Contacte al administrador si necesita corregir el cierre.',
        v_register.name,
        to_char(v_business_date, 'YYYY-MM-DD')
      );
  end if;

  return new;
end;
$$;

revoke all on function public.guard_pos_payment_daily_cash_closure() from public, anon, authenticated;

drop trigger if exists pos_payments_guard_daily_cash_closure on public.pos_payments;
create trigger pos_payments_guard_daily_cash_closure
before insert or update of tenant_id, cash_shift_id, paid_at, amount, method, status on public.pos_payments
for each row execute function public.guard_pos_payment_daily_cash_closure();

comment on function public.guard_pos_payment_daily_cash_closure() is
  'Impide insertar cobros o cambiar su alcance, fecha, importe, medio o estado cuando su fecha local ya está cerrada, serializado con el cierre diario por la fila de caja.';
