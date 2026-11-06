-- SaborAI POS: apertura diaria de caja, independiente de la apertura/cierre de turno.
--
-- DEPENDENCIAS (deben estar aplicadas en este orden):
--   1. supabase/migrations/20261017000000_pos_core.sql
--   2. supabase/migrations/20261024020000_phase3_hacienda_history.sql
--   3. supabase/migrations/20261026000000_phase8_central_cash_registers.sql
--   4. supabase/migrations/20261026010000_phase2_cash_control_sync.sql
--   5. supabase/migrations/20261105170000_shift_and_daily_cash_closures.sql
-- Esta migración no se ha aplicado. Requiere aprobación explícita de Maikol.
-- La apertura diaria registra responsable/fecha/hora; el fondo de efectivo sigue
-- capturándose por turno. Los cierres Z por turno y el cierre diario no se alteran.

do $$
begin
  if to_regclass('public.pos_branches') is null
     or to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null
     or to_regclass('public.pos_daily_cash_closures') is null
     or to_regclass('public.pos_payments') is null then
    raise exception using
      errcode = '42P01',
      message = 'Faltan las migraciones POS base, multi-caja o de cierres diarios indicadas como dependencias de la apertura diaria.';
  end if;

  if exists (
    select 1
    from (values
      ('pos_branches', 'tenant_id'), ('pos_branches', 'timezone'), ('pos_branches', 'is_active'),
      ('pos_cash_registers', 'id'), ('pos_cash_registers', 'tenant_id'), ('pos_cash_registers', 'branch_id'), ('pos_cash_registers', 'legacy_id'), ('pos_cash_registers', 'name'), ('pos_cash_registers', 'is_active'),
      ('pos_cash_shifts', 'id'), ('pos_cash_shifts', 'tenant_id'), ('pos_cash_shifts', 'branch_id'), ('pos_cash_shifts', 'cash_register_id'), ('pos_cash_shifts', 'status'), ('pos_cash_shifts', 'opened_at'),
      ('pos_daily_cash_closures', 'tenant_id'), ('pos_daily_cash_closures', 'branch_id'), ('pos_daily_cash_closures', 'cash_register_id'), ('pos_daily_cash_closures', 'business_date'),
      ('pos_payments', 'tenant_id'), ('pos_payments', 'cash_shift_id'), ('pos_payments', 'paid_at'), ('pos_payments', 'created_at'), ('pos_payments', 'amount'), ('pos_payments', 'method'), ('pos_payments', 'status')
    ) as required(table_name, column_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = required.table_name
     and c.column_name = required.column_name
    where c.column_name is null
  ) then
    raise exception using
      errcode = '42703',
      message = 'Falta una columna requerida para apertura diaria, protección de cobros o apertura de turnos.';
  end if;
end;
$$;

create table if not exists public.pos_daily_cash_openings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  business_date date not null,
  timezone text not null,
  opened_by uuid not null,
  opened_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, cash_register_id, business_date)
);

create index if not exists pos_daily_cash_openings_tenant_date_idx
  on public.pos_daily_cash_openings(tenant_id, business_date desc);

alter table public.pos_daily_cash_openings enable row level security;
alter table public.pos_daily_cash_openings force row level security;
revoke all on table public.pos_daily_cash_openings from public, anon, authenticated;

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
  v_now timestamptz := clock_timestamp();
  v_business_date date;
  v_result public.pos_daily_cash_openings%rowtype;
begin
  if p_opened_by is null then
    raise exception using errcode = '22004', message = 'El responsable de apertura diaria es obligatorio.';
  end if;

  select * into v_register
  from public.pos_cash_registers
  where tenant_id = p_tenant_id
    and id = p_cash_register_id
    and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontró una caja activa de este restaurante.';
  end if;

  select * into v_branch
  from public.pos_branches
  where tenant_id = p_tenant_id
    and id = v_register.branch_id
    and is_active = true;
  if not found or v_branch.timezone is null or btrim(v_branch.timezone) = '' then
    raise exception using errcode = 'P0002', message = 'No se encontró una sucursal activa con zona horaria válida para esta caja.';
  end if;

  v_business_date := (v_now at time zone v_branch.timezone)::date;

  if exists (
    select 1
    from public.pos_daily_cash_closures c
    where c.tenant_id = p_tenant_id
      and c.branch_id = v_register.branch_id
      and c.cash_register_id = v_register.id
      and c.business_date = v_business_date
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_CASH_CLOSED|' || format(
        'No se puede abrir la caja "%s": ya tiene cierre diario para el %s.',
        v_register.name,
        to_char(v_business_date, 'YYYY-MM-DD')
      );
  end if;

  select * into v_existing
  from public.pos_daily_cash_openings o
  where o.tenant_id = p_tenant_id
    and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id
    and o.business_date = v_business_date
  for update;
  if found then
    return jsonb_build_object(
      'openingId', v_existing.id,
      'cashRegisterId', v_existing.cash_register_id,
      'businessDate', v_existing.business_date,
      'timezone', v_existing.timezone,
      'openedAt', v_existing.opened_at,
      'alreadyOpened', true
    );
  end if;

  insert into public.pos_daily_cash_openings (
    tenant_id, branch_id, cash_register_id, business_date, timezone, opened_by, opened_at
  ) values (
    p_tenant_id, v_register.branch_id, v_register.id, v_business_date, v_branch.timezone, p_opened_by, v_now
  ) returning * into v_result;

  return jsonb_build_object(
    'openingId', v_result.id,
    'cashRegisterId', v_result.cash_register_id,
    'businessDate', v_result.business_date,
    'timezone', v_result.timezone,
    'openedAt', v_result.opened_at,
    'alreadyOpened', false
  );
end;
$$;
revoke all on function public.pos_open_daily_cash(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pos_open_daily_cash(uuid, uuid, uuid) to service_role;

create or replace function public.guard_pos_daily_cash_closure_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.pos_cash_registers r
  where r.tenant_id = new.tenant_id
    and r.branch_id = new.branch_id
    and r.id = new.cash_register_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'No se encontró la caja del cierre diario.';
  end if;

  if not exists (
    select 1
    from public.pos_daily_cash_openings o
    where o.tenant_id = new.tenant_id
      and o.branch_id = new.branch_id
      and o.cash_register_id = new.cash_register_id
      and o.business_date = new.business_date
  ) then
    raise exception using
      errcode = '55000',
      message = 'DAILY_CASH_NOT_OPEN|No se puede cerrar la caja del día sin registrar primero su apertura diaria.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_daily_cash_closure_opening() from public, anon, authenticated;
drop trigger if exists pos_daily_cash_closures_guard_opening on public.pos_daily_cash_closures;
create trigger pos_daily_cash_closures_guard_opening
before insert on public.pos_daily_cash_closures
for each row execute function public.guard_pos_daily_cash_closure_opening();

create or replace function public.guard_pos_cash_shift_daily_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_register public.pos_cash_registers%rowtype;
  v_timezone text;
  v_business_date date;
  v_opened_at timestamptz;
begin
  if new.status <> 'OPEN' then
    return new;
  end if;

  select * into v_register
  from public.pos_cash_registers r
  where r.tenant_id = new.tenant_id
    and r.branch_id = new.branch_id
    and r.id = new.cash_register_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'No se encontró la caja del turno.';
  end if;

  select b.timezone into v_timezone
  from public.pos_branches b
  where b.tenant_id = new.tenant_id
    and b.id = new.branch_id
    and b.is_active = true;
  if v_timezone is null or btrim(v_timezone) = '' then
    raise exception using errcode = '55000', message = 'No se pudo determinar la fecha local del turno.';
  end if;

  v_business_date := (new.opened_at at time zone v_timezone)::date;
  select o.opened_at into v_opened_at
  from public.pos_daily_cash_openings o
  where o.tenant_id = new.tenant_id
    and o.branch_id = new.branch_id
    and o.cash_register_id = new.cash_register_id
    and o.business_date = v_business_date;
  if v_opened_at is null then
    raise exception using
      errcode = '55000',
      message = 'DAILY_CASH_NOT_OPEN|' || format(
        'Abre primero la caja del día %s antes de iniciar un turno.',
        to_char(v_business_date, 'YYYY-MM-DD')
      );
  end if;
  if new.opened_at < v_opened_at then
    raise exception using
      errcode = '55000',
      message = 'DAILY_CASH_NOT_OPEN|La apertura de turno no puede ser anterior a la apertura de caja del día.';
  end if;

  if exists (
    select 1
    from public.pos_daily_cash_closures c
    where c.tenant_id = new.tenant_id
      and c.branch_id = new.branch_id
      and c.cash_register_id = new.cash_register_id
      and c.business_date = v_business_date
  ) then
    raise exception using
      errcode = '55000',
      message = 'DAILY_CASH_CLOSED|No se puede abrir un turno porque esta caja ya tiene cierre diario para la fecha local.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_cash_shift_daily_opening() from public, anon, authenticated;
drop trigger if exists pos_cash_shifts_guard_daily_opening on public.pos_cash_shifts;
create trigger pos_cash_shifts_guard_daily_opening
before insert or update of status, opened_at, cash_register_id, branch_id on public.pos_cash_shifts
for each row execute function public.guard_pos_cash_shift_daily_opening();

create or replace function public.guard_pos_payment_daily_cash_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.pos_cash_shifts%rowtype;
  v_register public.pos_cash_registers%rowtype;
  v_timezone text;
  v_business_date date;
  v_paid_at timestamptz;
  v_opened_at timestamptz;
begin
  if new.status not in ('PENDING', 'AUTHORIZED') then
    return new;
  end if;

  -- Los cambios de estado de cobros ya registrados no requieren revalidar la
  -- apertura; cualquier inserción o cambio de fecha/importe/medio/enlace sí.
  if TG_OP = 'UPDATE'
     and new.tenant_id is not distinct from old.tenant_id
     and new.cash_shift_id is not distinct from old.cash_shift_id
     and new.paid_at is not distinct from old.paid_at
     and new.amount is not distinct from old.amount
     and new.method is not distinct from old.method then
    return new;
  end if;

  if new.cash_shift_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_CASH_NOT_OPEN|El cobro requiere una apertura diaria y un turno válido.';
  end if;

  select * into v_shift
  from public.pos_cash_shifts s
  where s.tenant_id = new.tenant_id
    and s.id = new.cash_shift_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'No se encontró el turno asociado al cobro.';
  end if;

  select * into v_register
  from public.pos_cash_registers r
  where r.tenant_id = new.tenant_id
    and r.branch_id = v_shift.branch_id
    and r.id = v_shift.cash_register_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'No se encontró la caja asociada al turno.';
  end if;

  select b.timezone into v_timezone
  from public.pos_branches b
  where b.tenant_id = new.tenant_id
    and b.id = v_register.branch_id;
  if v_timezone is null or btrim(v_timezone) = '' then
    raise exception using errcode = '55000', message = 'No se pudo determinar la fecha local de la caja.';
  end if;

  v_paid_at := coalesce(new.paid_at, new.created_at, clock_timestamp());
  v_business_date := (v_paid_at at time zone v_timezone)::date;
  select o.opened_at into v_opened_at
  from public.pos_daily_cash_openings o
  where o.tenant_id = new.tenant_id
    and o.branch_id = v_register.branch_id
    and o.cash_register_id = v_register.id
    and o.business_date = v_business_date;
  if v_opened_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_CASH_NOT_OPEN|' || format(
        'No se puede registrar el cobro: primero debe abrirse la caja "%s" para el %s. El cobro no se registró.',
        v_register.name,
        to_char(v_business_date, 'YYYY-MM-DD')
      );
  end if;
  if v_paid_at < v_opened_at then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_CASH_NOT_OPEN|' || format(
        'El cobro es anterior a la apertura diaria de "%s" para el %s; el cobro no se registró.',
        v_register.name,
        to_char(v_business_date, 'YYYY-MM-DD')
      );
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pos_payment_daily_cash_opening() from public, anon, authenticated;
drop trigger if exists pos_payments_guard_daily_cash_opening on public.pos_payments;
create trigger pos_payments_guard_daily_cash_opening
before insert or update of tenant_id, cash_shift_id, paid_at, amount, method, status on public.pos_payments
for each row execute function public.guard_pos_payment_daily_cash_opening();

comment on table public.pos_daily_cash_openings is
  'Apertura diaria única por caja registrada y fecha local de sucursal. Independiente de la apertura y cierre de turnos; el fondo inicial se registra en cada turno.';
comment on function public.pos_open_daily_cash(uuid, uuid, uuid) is
  'Abre de forma idempotente una caja para la fecha local actual de la sucursal y serializa la apertura con el cierre diario.';
comment on function public.guard_pos_cash_shift_daily_opening() is
  'Exige una apertura diaria previa antes de insertar o reabrir un turno.';
comment on function public.guard_pos_payment_daily_cash_opening() is
  'Impide registrar cobros antes de la apertura diaria de su caja/fecha local y permite solo cobros posteriores a opened_at.';
