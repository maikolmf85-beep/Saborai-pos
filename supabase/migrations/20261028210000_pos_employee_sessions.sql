-- Employee identities for server-issued POS sessions.
-- This migration is intentionally local-only until explicitly approved.

create table if not exists public.pos_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_id text not null check (length(btrim(external_id)) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 120),
  email text,
  phone text,
  role text not null check (role in ('ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER')),
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_id)
);

create index if not exists pos_employees_tenant_active_idx
  on public.pos_employees (tenant_id, is_active);

alter table public.pos_employees enable row level security;
revoke all on public.pos_employees from public, anon, authenticated;
grant all on public.pos_employees to service_role;

alter table public.pos_audit_events
  add column if not exists actor_employee_id uuid references public.pos_employees(id) on delete set null;

create index if not exists pos_audit_events_tenant_employee_date_idx
  on public.pos_audit_events (tenant_id, actor_employee_id, created_at desc)
  where actor_employee_id is not null;
