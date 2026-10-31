-- Comanda Ejecutiva y crédito interno de colaboradores.
-- Migración autocontenida: crea las tablas y la RPC requeridas por la aplicación.
-- Esta migración queda preparada para revisión y NO se aplica automáticamente aquí.
-- El acceso de clientes se hace por API server-side con validación de sesión, rol y tenant.

create table if not exists public.pos_employee_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id text not null,
  employee_name text not null,
  status text not null default 'ACTIVE',
  balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_employee_credit_accounts_status_check
    check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  constraint pos_employee_credit_accounts_balance_check
    check (balance >= 0),
  constraint pos_employee_credit_accounts_employee_id_check
    check (length(btrim(employee_id)) between 1 and 120),
  constraint pos_employee_credit_accounts_employee_name_check
    check (length(btrim(employee_name)) between 1 and 120),
  constraint pos_employee_credit_accounts_credit_limit_check
    check (credit_limit is null or credit_limit >= 0),
  constraint pos_employee_credit_accounts_tenant_employee_key
    unique (tenant_id, employee_id),
  -- Necesaria como clave candidata para la FK compuesta tenant/account de movimientos.
  constraint pos_employee_credit_accounts_tenant_id_id_key
    unique (tenant_id, id)
);

create table if not exists public.pos_employee_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null,
  employee_id text not null,
  transaction_type text not null,
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  order_id uuid references public.pos_orders(id) on delete set null,
  invoice_id uuid references public.pos_invoices(id) on delete set null,
  reference text,
  notes text,
  idempotency_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint pos_employee_credit_transactions_account_fkey
    foreign key (tenant_id, account_id)
    references public.pos_employee_credit_accounts(tenant_id, id)
    on delete restrict,
  constraint pos_employee_credit_transactions_type_check
    check (transaction_type in ('CHARGE', 'PAYMENT', 'ADJUSTMENT', 'VOID')),
  constraint pos_employee_credit_transactions_amount_check
    check (amount > 0),
  constraint pos_employee_credit_transactions_balance_check
    check (balance_after >= 0),
  constraint pos_employee_credit_transactions_employee_id_check
    check (length(btrim(employee_id)) between 1 and 120),
  constraint pos_employee_credit_transactions_idempotency_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint pos_employee_credit_transactions_tenant_idempotency_key
    unique (tenant_id, idempotency_key)
);

-- Compatibilidad idempotente con la migración previa de tablas, que no incluía
-- la clave candidata y la FK compuesta para impedir cuentas cruzadas entre tenants.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_accounts'::regclass
      and conname = 'pos_employee_credit_accounts_tenant_id_id_key'
  ) then
    alter table public.pos_employee_credit_accounts
      add constraint pos_employee_credit_accounts_tenant_id_id_key unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_transactions'::regclass
      and conname = 'pos_employee_credit_transactions_account_fkey'
  ) then
    alter table public.pos_employee_credit_transactions
      add constraint pos_employee_credit_transactions_account_fkey
      foreign key (tenant_id, account_id)
      references public.pos_employee_credit_accounts(tenant_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_accounts'::regclass
      and conname = 'pos_employee_credit_accounts_employee_id_check'
  ) then
    alter table public.pos_employee_credit_accounts
      add constraint pos_employee_credit_accounts_employee_id_check
      check (length(btrim(employee_id)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_accounts'::regclass
      and conname = 'pos_employee_credit_accounts_employee_name_check'
  ) then
    alter table public.pos_employee_credit_accounts
      add constraint pos_employee_credit_accounts_employee_name_check
      check (length(btrim(employee_name)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_accounts'::regclass
      and conname = 'pos_employee_credit_accounts_credit_limit_check'
  ) then
    alter table public.pos_employee_credit_accounts
      add constraint pos_employee_credit_accounts_credit_limit_check
      check (credit_limit is null or credit_limit >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_transactions'::regclass
      and conname = 'pos_employee_credit_transactions_employee_id_check'
  ) then
    alter table public.pos_employee_credit_transactions
      add constraint pos_employee_credit_transactions_employee_id_check
      check (length(btrim(employee_id)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_employee_credit_transactions'::regclass
      and conname = 'pos_employee_credit_transactions_idempotency_key_check'
  ) then
    alter table public.pos_employee_credit_transactions
      add constraint pos_employee_credit_transactions_idempotency_key_check
      check (length(btrim(idempotency_key)) between 1 and 200);
  end if;
end;
$$;

create index if not exists pos_employee_credit_accounts_tenant_idx
  on public.pos_employee_credit_accounts (tenant_id, status, employee_name);
create index if not exists pos_employee_credit_transactions_account_idx
  on public.pos_employee_credit_transactions (tenant_id, account_id, created_at desc);
create index if not exists pos_employee_credit_transactions_employee_idx
  on public.pos_employee_credit_transactions (tenant_id, employee_id, created_at desc);
create index if not exists pos_employee_credit_transactions_tenant_created_idx
  on public.pos_employee_credit_transactions (tenant_id, created_at desc);

-- RLS queda habilitado sin políticas para anon/authenticated: solo el backend,
-- después de autenticar y validar el tenant, accede usando service_role.
alter table public.pos_employee_credit_accounts enable row level security;
alter table public.pos_employee_credit_transactions enable row level security;
revoke all on table public.pos_employee_credit_accounts from public, anon, authenticated;
revoke all on table public.pos_employee_credit_transactions from public, anon, authenticated;
grant all on table public.pos_employee_credit_accounts to service_role;
grant all on table public.pos_employee_credit_transactions to service_role;

comment on table public.pos_employee_credit_accounts is
  'Cuentas por cobrar internas de colaboradores; no representa pago recibido en caja.';
comment on table public.pos_employee_credit_transactions is
  'Movimientos de crédito de empleados, separados de pagos de caja.';

create or replace function public.apply_employee_credit_transaction(
  p_tenant_id uuid,
  p_employee_id text,
  p_transaction_type text,
  p_amount numeric,
  p_idempotency_key text,
  p_order_id uuid,
  p_reference text,
  p_notes text,
  p_created_by text
)
returns table (
  account_id uuid,
  transaction_id uuid,
  employee_id text,
  employee_name text,
  transaction_type text,
  amount numeric,
  balance_after numeric,
  reference text,
  idempotency_key text,
  created_at timestamptz,
  already_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_name text;
  v_account_id uuid;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_credit_limit numeric(14,2);
  v_account_status text;
  v_transaction_id uuid;
  v_existing public.pos_employee_credit_transactions%rowtype;
  v_existing_name text;
begin
  if p_tenant_id is null
     or p_employee_id is null or length(btrim(p_employee_id)) not between 1 and 120
     or p_transaction_type is null or p_transaction_type not in ('CHARGE', 'PAYMENT')
     or p_amount is null or p_amount <= 0 or p_amount > 999999999999.99
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'La operación de crédito contiene datos inválidos.' using errcode = '22023';
  end if;

  -- Reintento idempotente: acepta solo la misma persona, tipo y monto.
  select t.* into v_existing
  from public.pos_employee_credit_transactions t
  where t.tenant_id = p_tenant_id and t.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.employee_id <> btrim(p_employee_id)
       or v_existing.transaction_type <> p_transaction_type
       or v_existing.amount <> round(p_amount, 2) then
      raise exception 'La clave de idempotencia ya se usó para otro movimiento.' using errcode = '23505';
    end if;
    select a.employee_name into v_existing_name
    from public.pos_employee_credit_accounts a
    where a.id = v_existing.account_id and a.tenant_id = p_tenant_id;
    return query select v_existing.account_id, v_existing.id, v_existing.employee_id,
      coalesce(v_existing_name, 'Colaborador'), v_existing.transaction_type,
      v_existing.amount, v_existing.balance_after, v_existing.reference,
      v_existing.idempotency_key, v_existing.created_at, true;
    return;
  end if;

  -- El cliente solo entrega el ID de roster; nombre, estado y tenant se resuelven aquí.
  select e.name into v_employee_name
  from public.pos_employees e
  where e.tenant_id = p_tenant_id
    and e.external_id = btrim(p_employee_id)
    and (e.is_active = true or p_transaction_type = 'PAYMENT');
  if not found and p_transaction_type = 'PAYMENT' then
    select a.employee_name into v_employee_name
    from public.pos_employee_credit_accounts a
    where a.tenant_id = p_tenant_id and a.employee_id = btrim(p_employee_id);
  end if;
  if not found then
    raise exception 'El colaborador no existe en este tenant.' using errcode = 'P0002';
  end if;

  if p_order_id is not null and not exists (
    select 1 from public.pos_orders o
    where o.id = p_order_id and o.tenant_id = p_tenant_id
  ) then
    raise exception 'La orden no pertenece al tenant activo.' using errcode = '23503';
  end if;

  insert into public.pos_employee_credit_accounts (tenant_id, employee_id, employee_name)
  values (p_tenant_id, btrim(p_employee_id), v_employee_name)
  on conflict (tenant_id, employee_id) do nothing;

  select a.id, a.balance, a.credit_limit, a.status
  into v_account_id, v_balance, v_credit_limit, v_account_status
  from public.pos_employee_credit_accounts a
  where a.tenant_id = p_tenant_id and a.employee_id = btrim(p_employee_id)
  for update;
  if v_account_id is null then
    raise exception 'No se pudo abrir la cuenta de crédito del colaborador.';
  end if;
  if p_transaction_type = 'CHARGE' and v_account_status <> 'ACTIVE' then
    raise exception 'La cuenta de crédito del colaborador no está activa.' using errcode = '22023';
  end if;

  -- Segunda comprobación tras el bloqueo de cuenta para cubrir reintentos concurrentes.
  select t.* into v_existing
  from public.pos_employee_credit_transactions t
  where t.tenant_id = p_tenant_id and t.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.employee_id <> btrim(p_employee_id)
       or v_existing.transaction_type <> p_transaction_type
       or v_existing.amount <> round(p_amount, 2) then
      raise exception 'La clave de idempotencia ya se usó para otro movimiento.' using errcode = '23505';
    end if;
    select a.employee_name into v_existing_name
    from public.pos_employee_credit_accounts a
    where a.id = v_existing.account_id and a.tenant_id = p_tenant_id;
    return query select v_existing.account_id, v_existing.id, v_existing.employee_id,
      coalesce(v_existing_name, v_employee_name), v_existing.transaction_type,
      v_existing.amount, v_existing.balance_after, v_existing.reference,
      v_existing.idempotency_key, v_existing.created_at, true;
    return;
  end if;

  if p_transaction_type = 'PAYMENT' and round(p_amount, 2) > v_balance then
    raise exception 'El abono supera el saldo pendiente.' using errcode = '22023';
  end if;

  v_new_balance := case
    when p_transaction_type = 'CHARGE' then v_balance + round(p_amount, 2)
    else v_balance - round(p_amount, 2)
  end;
  if v_credit_limit is not null and v_new_balance > v_credit_limit then
    raise exception 'El consumo supera el límite de crédito del colaborador.' using errcode = '22023';
  end if;

  insert into public.pos_employee_credit_transactions (
    tenant_id, account_id, employee_id, transaction_type, amount, balance_after,
    order_id, reference, notes, idempotency_key, created_by
  ) values (
    p_tenant_id, v_account_id, btrim(p_employee_id), p_transaction_type,
    round(p_amount, 2), v_new_balance, p_order_id,
    nullif(left(btrim(coalesce(p_reference, '')), 200), ''),
    nullif(left(btrim(coalesce(p_notes, '')), 500), ''),
    btrim(p_idempotency_key), nullif(left(btrim(coalesce(p_created_by, '')), 120), '')
  ) on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select t.* into v_existing
    from public.pos_employee_credit_transactions t
    where t.tenant_id = p_tenant_id and t.idempotency_key = btrim(p_idempotency_key);
    if not found or v_existing.employee_id <> btrim(p_employee_id)
       or v_existing.transaction_type <> p_transaction_type
       or v_existing.amount <> round(p_amount, 2) then
      raise exception 'La clave de idempotencia ya se usó para otro movimiento.' using errcode = '23505';
    end if;
    select a.employee_name into v_existing_name
    from public.pos_employee_credit_accounts a
    where a.id = v_existing.account_id and a.tenant_id = p_tenant_id;
    return query select v_existing.account_id, v_existing.id, v_existing.employee_id,
      coalesce(v_existing_name, v_employee_name), v_existing.transaction_type,
      v_existing.amount, v_existing.balance_after, v_existing.reference,
      v_existing.idempotency_key, v_existing.created_at, true;
    return;
  end if;

  update public.pos_employee_credit_accounts a
  set balance = v_new_balance,
      employee_name = v_employee_name,
      updated_at = now()
  where a.id = v_account_id and a.tenant_id = p_tenant_id;

  return query select v_account_id, v_transaction_id, btrim(p_employee_id),
    v_employee_name, p_transaction_type, round(p_amount, 2), v_new_balance,
    nullif(left(btrim(coalesce(p_reference, '')), 200), ''), btrim(p_idempotency_key), now(), false;
end;
$$;

revoke all on function public.apply_employee_credit_transaction(uuid, text, text, numeric, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_employee_credit_transaction(uuid, text, text, numeric, text, uuid, text, text, text) to service_role;
