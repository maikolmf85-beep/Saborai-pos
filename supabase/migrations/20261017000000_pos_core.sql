-- SaborAI POS - Fase 1: núcleo operativo centralizado
-- Esta migración es aditiva: no reemplaza las tablas existentes de autenticación.

create extension if not exists pgcrypto;

create table if not exists public.pos_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  code varchar(3) not null,
  address text,
  timezone text not null default 'America/Costa_Rica',
  currency varchar(3) not null default 'CRC' check (currency in ('CRC', 'USD')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.pos_cash_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete cascade,
  name text not null,
  terminal_code varchar(5) not null,
  allows_billing boolean not null default true,
  allows_ordering boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, terminal_code)
);

create table if not exists public.pos_cash_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  opened_by uuid,
  closed_by uuid,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'VOIDED')),
  opening_float numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null default 0,
  counted_cash numeric(14,2),
  difference numeric(14,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists pos_one_open_shift_per_register
  on public.pos_cash_shifts(cash_register_id) where status = 'OPEN';

create table if not exists public.pos_menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid references public.pos_branches(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, branch_id, name)
);

create table if not exists public.pos_menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid references public.pos_branches(id) on delete cascade,
  category_id uuid references public.pos_menu_categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(14,2) not null default 0 check (price >= 0),
  tax_rate numeric(5,4) not null default 0.13,
  cabys_code text,
  station text not null default 'Cocina' check (station in ('Cocina', 'Bar', 'Postres')),
  prep_time_minutes integer,
  is_available boolean not null default true,
  modifiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid references public.pos_branches(id) on delete cascade,
  name text not null,
  unit text not null,
  current_stock numeric(14,4) not null default 0,
  minimum_stock numeric(14,4) not null default 0,
  average_cost numeric(14,4) not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, branch_id, name)
);

create table if not exists public.pos_recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  menu_item_id uuid not null references public.pos_menu_items(id) on delete cascade,
  ingredient_id uuid not null references public.pos_ingredients(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  unique (menu_item_id, ingredient_id)
);

create table if not exists public.pos_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete cascade,
  name text not null,
  table_number integer,
  zone text not null default 'Principal',
  seats integer not null default 2 check (seats > 0),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'OCCUPIED', 'PRE_CHECK', 'RESERVED')),
  position jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  table_id uuid references public.pos_tables(id) on delete set null,
  cash_shift_id uuid references public.pos_cash_shifts(id) on delete set null,
  order_number text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED', 'CANCELLED', 'CLOSED')),
  service_type text not null default 'DINE_IN' check (service_type in ('DINE_IN', 'TAKEAWAY', 'DELIVERY')),
  opened_by uuid,
  server_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  idempotency_key text not null,
  unique (tenant_id, idempotency_key)
);

create table if not exists public.pos_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  menu_item_id uuid references public.pos_menu_items(id) on delete set null,
  name_snapshot text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(5,4) not null default 0.13,
  modifiers jsonb not null default '[]'::jsonb,
  notes text,
  station text,
  kds_status text not null default 'PENDING' check (kds_status in ('PENDING', 'IN_PREPARATION', 'READY', 'SERVED')),
  created_at timestamptz not null default now()
);

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references public.pos_orders(id) on delete restrict,
  cash_shift_id uuid references public.pos_cash_shifts(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('CASH', 'CARD', 'SINPE', 'MIXED', 'CREDIT')),
  provider text,
  provider_transaction_id text,
  status text not null default 'PENDING' check (status in ('PENDING', 'AUTHORIZED', 'FAILED', 'REFUNDED')),
  idempotency_key text not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create table if not exists public.pos_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  order_id uuid references public.pos_orders(id) on delete set null,
  payment_id uuid references public.pos_payments(id) on delete set null,
  clave varchar(50) not null,
  consecutivo varchar(20) not null,
  document_type text not null check (document_type in ('FE', 'TE', 'NC', 'ND')),
  hacienda_status text not null default 'PENDING' check (hacienda_status in ('PENDING', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'VOIDED')),
  total numeric(14,2) not null default 0,
  xml_content text,
  signed_xml_content text,
  error_message text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, clave),
  unique (tenant_id, consecutivo)
);

create table if not exists public.pos_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid references public.pos_branches(id) on delete set null,
  ingredient_id uuid references public.pos_ingredients(id) on delete restrict,
  order_id uuid references public.pos_orders(id) on delete set null,
  movement_type text not null check (movement_type in ('SALE', 'RESTOCK', 'WASTE', 'ADJUSTMENT')),
  quantity numeric(14,4) not null,
  unit_cost numeric(14,4),
  reason text,
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create table if not exists public.pos_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  branch_id uuid,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pos_orders_tenant_status_idx on public.pos_orders(tenant_id, status, created_at desc);
create index if not exists pos_payments_tenant_date_idx on public.pos_payments(tenant_id, created_at desc);
create index if not exists pos_invoices_tenant_date_idx on public.pos_invoices(tenant_id, created_at desc);
create index if not exists pos_inventory_tenant_date_idx on public.pos_inventory_movements(tenant_id, created_at desc);
create index if not exists pos_audit_tenant_date_idx on public.pos_audit_events(tenant_id, created_at desc);

-- Los endpoints actuales usan service_role y aplican tenant scope en backend.
-- RLS se habilita como defensa adicional para futuras rutas con Supabase Auth.
alter table public.pos_branches enable row level security;
alter table public.pos_cash_registers enable row level security;
alter table public.pos_cash_shifts enable row level security;
alter table public.pos_menu_categories enable row level security;
alter table public.pos_menu_items enable row level security;
alter table public.pos_ingredients enable row level security;
alter table public.pos_recipes enable row level security;
alter table public.pos_tables enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_items enable row level security;
alter table public.pos_payments enable row level security;
alter table public.pos_invoices enable row level security;
alter table public.pos_inventory_movements enable row level security;
alter table public.pos_audit_events enable row level security;
