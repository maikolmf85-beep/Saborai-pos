-- Fase 10: Comanda Ejecutiva y crédito interno de colaboradores
-- No almacena PINes ni credenciales. employee_id corresponde al identificador del perfil POS.

create table if not exists public.pos_employee_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id text not null,
  employee_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  balance numeric(14,2) not null default 0 check (balance >= 0),
  credit_limit numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_id)
);

create table if not exists public.pos_employee_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null references public.pos_employee_credit_accounts(id) on delete restrict,
  employee_id text not null,
  transaction_type text not null check (transaction_type in ('CHARGE', 'PAYMENT', 'ADJUSTMENT', 'VOID')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  order_id uuid references public.pos_orders(id) on delete set null,
  invoice_id uuid references public.pos_invoices(id) on delete set null,
  reference text,
  notes text,
  idempotency_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists pos_employee_credit_accounts_tenant_idx
  on public.pos_employee_credit_accounts(tenant_id, status, employee_name);
create index if not exists pos_employee_credit_transactions_account_idx
  on public.pos_employee_credit_transactions(tenant_id, account_id, created_at desc);

alter table public.pos_employee_credit_accounts enable row level security;
alter table public.pos_employee_credit_transactions enable row level security;

comment on table public.pos_employee_credit_accounts is
  'Cuentas por cobrar internas de colaboradores; no representa pago recibido en caja.';
comment on table public.pos_employee_credit_transactions is
  'Movimientos de crédito de empleados, separados de pagos de caja.';
