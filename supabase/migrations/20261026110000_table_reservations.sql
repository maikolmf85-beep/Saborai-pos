create table if not exists public.pos_table_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_id text not null,
  table_name text not null,
  zone text not null default '',
  customer_name text not null check (char_length(btrim(customer_name)) > 0),
  customer_phone text not null check (char_length(btrim(customer_phone)) > 0),
  customer_email text,
  reserved_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  party_size integer not null check (party_size between 1 and 100),
  status text not null default 'CONFIRMED'
    check (status in ('CONFIRMED', 'ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW')),
  notes text not null default '',
  arrived_at timestamptz,
  seated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_table_reservations_tenant_reserved_at_idx
  on public.pos_table_reservations (tenant_id, reserved_at);

create index if not exists pos_table_reservations_tenant_status_reserved_at_idx
  on public.pos_table_reservations (tenant_id, status, reserved_at);

create index if not exists pos_table_reservations_tenant_table_reserved_at_idx
  on public.pos_table_reservations (tenant_id, table_id, reserved_at);

alter table public.pos_table_reservations enable row level security;

drop policy if exists pos_table_reservations_tenant_select on public.pos_table_reservations;
create policy pos_table_reservations_tenant_select
  on public.pos_table_reservations for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_reservations_tenant_insert on public.pos_table_reservations;
create policy pos_table_reservations_tenant_insert
  on public.pos_table_reservations for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_reservations_tenant_update on public.pos_table_reservations;
create policy pos_table_reservations_tenant_update
  on public.pos_table_reservations for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_reservations_tenant_delete on public.pos_table_reservations;
create policy pos_table_reservations_tenant_delete
  on public.pos_table_reservations for delete to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.pos_table_reservations to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pos_table_reservations'
  ) then
    alter publication supabase_realtime add table public.pos_table_reservations;
  end if;
end
$$;
