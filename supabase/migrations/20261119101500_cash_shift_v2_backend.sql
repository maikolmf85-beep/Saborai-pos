-- SaborAI POS Cash Shift V2 backend review migration
-- V2 is OFF by default. Additive only; no backfill, no legacy shift_number semantics.
-- NOT READY FOR APPLY: Postgres runtime/clon verification, Hacienda/UI legacy integration and explicit deployment requirements remain blockers. V2 stays OFF by default and this migration must not be applied.
-- Required preceding migrations (metadata-only preflight below):
--   20261017000000_pos_core.sql
--   20261026000000_phase8_central_cash_registers.sql
--   20261026010000_phase2_cash_control_sync.sql
--   20261105170000_shift_and_daily_cash_closures.sql
--   20261106100000_daily_cash_openings.sql
--   20261118120000_daily_cash_opening_session_persistence.sql
--   20261028210000_pos_employee_sessions.sql
-- No SQL is executed by review tooling; apply only after independent review.

begin;

-- -----------------------------------------------------------------------------
-- Metadata-only dependency preflight. It reads catalog metadata only.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('pos_branches','id'),('pos_branches','tenant_id'),('pos_branches','timezone'),('pos_branches','is_active'),
    ('pos_cash_registers','id'),('pos_cash_registers','tenant_id'),('pos_cash_registers','branch_id'),('pos_cash_registers','is_active'),
    ('pos_cash_shifts','id'),('pos_cash_shifts','tenant_id'),('pos_cash_shifts','branch_id'),('pos_cash_shifts','cash_register_id'),('pos_cash_shifts','status'),('pos_cash_shifts','opening_float'),('pos_cash_shifts','opened_at'),('pos_cash_shifts','closed_at'),('pos_cash_shifts','closed_by'),('pos_cash_shifts','counted_cash'),('pos_cash_shifts','expected_cash'),('pos_cash_shifts','difference'),
    ('pos_tables','id'),('pos_tables','tenant_id'),('pos_tables','branch_id'),('pos_tables','status'),('pos_tables','zone'),('pos_tables','updated_at'),
    ('pos_orders','id'),('pos_orders','tenant_id'),('pos_orders','branch_id'),('pos_orders','table_id'),('pos_orders','status'),('pos_orders','service_type'),('pos_orders','cash_shift_id'),('pos_orders','order_number'),('pos_orders','opened_by'),('pos_orders','server_name'),('pos_orders','idempotency_key'),
    ('pos_order_items','id'),('pos_order_items','tenant_id'),('pos_order_items','order_id'),('pos_order_items','menu_item_id'),('pos_order_items','name_snapshot'),('pos_order_items','quantity'),('pos_order_items','unit_price'),('pos_order_items','tax_rate'),('pos_order_items','modifiers'),('pos_order_items','notes'),('pos_order_items','station'),('pos_order_items','kds_status'),
    ('pos_payments','id'),('pos_payments','tenant_id'),('pos_payments','order_id'),('pos_payments','cash_shift_id'),('pos_payments','amount'),('pos_payments','method'),('pos_payments','status'),('pos_payments','paid_at'),
    ('pos_invoices','id'),('pos_invoices','tenant_id'),('pos_invoices','branch_id'),('pos_invoices','payment_id'),
    ('pos_menu_items','id'),('pos_menu_items','tenant_id'),('pos_menu_items','branch_id'),('pos_menu_items','category_id'),('pos_menu_items','name'),('pos_menu_items','price'),('pos_menu_items','tax_rate'),('pos_menu_items','station'),('pos_menu_items','is_available'),
    ('pos_menu_categories','id'),('pos_menu_categories','tenant_id'),('pos_employees','id'),('pos_employees','tenant_id'),('pos_employees','is_active'),('pos_employees','role'),('pos_employees','name'),('pos_employees','pin_hash'),
    ('pos_daily_cash_openings','id'),('pos_daily_cash_openings','tenant_id'),('pos_daily_cash_openings','branch_id'),('pos_daily_cash_openings','cash_register_id'),('pos_daily_cash_openings','business_date'),('pos_daily_cash_openings','opened_by'),('pos_daily_cash_openings','opened_at'),
    ('pos_daily_cash_closures','id'),('pos_daily_cash_closures','tenant_id'),('pos_daily_cash_closures','branch_id'),('pos_daily_cash_closures','cash_register_id'),('pos_daily_cash_closures','business_date'),('pos_daily_cash_closures','timezone'),('pos_daily_cash_closures','closed_by'),('pos_daily_cash_closures','summary'),('pos_daily_cash_closures','closed_at')
  ) x(table_name,column_name) loop
    if not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name) then
      raise exception using errcode='42703', message=format('Cash Shift V2 dependency missing: public.%s.%s',r.table_name,r.column_name);
    end if;
  end loop;
  if to_regprocedure('public.pos_open_daily_cash(uuid,uuid,uuid)') is null
     or to_regprocedure('public.pos_close_daily_cash(uuid,uuid,date,uuid)') is null then
    raise exception using errcode='42883', message='Cash Shift V2 dependency missing: legacy daily opening/close RPC.';
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto;
do $$
declare crypto_schema text;
begin
  select n.nspname into crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if crypto_schema is null or crypto_schema not in ('public','extensions') then raise exception using errcode='42883',message='Cash Shift V2 pgcrypto must reside in public or extensions.'; end if;
  if has_schema_privilege('anon',crypto_schema,'CREATE') or has_schema_privilege('authenticated',crypto_schema,'CREATE') or has_schema_privilege('service_role',crypto_schema,'CREATE') then raise exception using errcode='42501',message='Cash Shift V2 pgcrypto schema CREATE privilege must be denied.'; end if;
  if has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE') or has_schema_privilege('service_role','public','CREATE') then raise exception using errcode='42501',message='Cash Shift V2 SECURITY DEFINER search_path schema public must not be writable by application roles.'; end if;
  if to_regprocedure(format('%I.crypt(text,text)',crypto_schema)) is null or to_regprocedure(format('%I.digest(text,text)',crypto_schema)) is null then raise exception using errcode='42883',message='Cash Shift V2 dependency missing: pgcrypto crypt/digest.'; end if;
end $$;

-- -----------------------------------------------------------------------------
-- V2 control plane and parallel numeric(18,5) ledger. There is deliberately no
-- INSERT/UPDATE backfill of legacy rows.
-- -----------------------------------------------------------------------------
create table if not exists public.pos_cash_v2_branch_controls (
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  state text not null default 'OFF' check (state in ('OFF','PREPARED','ACTIVE','QUIESCING','FROZEN')),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid,
  primary key (tenant_id,branch_id)
);
create table if not exists public.pos_cash_v2_branch_fiscal_profiles (
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  authority text not null default 'SERVER' check (authority='SERVER'),
  tax_regime text not null check (tax_regime in ('IVA_13','IVA_0')),
  currency text not null check (currency in ('CRC','USD')),
  price_basis text not null default 'EXCLUSIVE_OF_VAT' check (price_basis='EXCLUSIVE_OF_VAT'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,branch_id)
);
create table if not exists public.pos_employee_branch_memberships (
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  employee_id uuid not null references public.pos_employees(id) on delete restrict,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED')),
  granted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (tenant_id,branch_id,employee_id)
);
create table if not exists public.pos_cash_v2_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  pos_cash_shift_id uuid not null unique references public.pos_cash_shifts(id) on delete restrict,
  business_date date not null,
  logical_shift smallint not null check(logical_shift in (1,2)),
  status text not null default 'OPEN' check(status in ('OPEN','CLOSING','CLOSED')),
  opening_float numeric(18,5) not null check(opening_float>=0),
  counted_cash numeric(18,5),
  opened_by_user_id uuid not null,
  opened_by_employee_id uuid,
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by_user_id uuid,
  closed_by_employee_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,branch_id,cash_register_id,business_date,logical_shift),
  check((status='CLOSED')=(closed_at is not null and counted_cash is not null)),
  check(status<>'CLOSED' or closed_at>opened_at)
);
create table if not exists public.pos_cash_v2_orders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  business_date date not null,
  legacy_order_id uuid references public.pos_orders(id) on delete set null,
  table_id uuid not null references public.pos_tables(id) on delete restrict,
  table_name_snapshot text not null,
  origin_session_id uuid not null references public.pos_cash_v2_sessions(id) on delete restrict,
  serving_session_id uuid not null references public.pos_cash_v2_sessions(id) on delete restrict,
  waiter_employee_id uuid not null references public.pos_employees(id) on delete restrict,
  waiter_name_snapshot text not null,
  status text not null default 'OPEN' check(status in ('OPEN','HELD','CLOSED','CANCELLED')),
  currency text not null check(currency in ('CRC','USD')),
  tax_regime text not null check(tax_regime in ('IVA_13','IVA_0')),
  price_basis text not null check(price_basis='EXCLUSIVE_OF_VAT'),
  subtotal numeric(18,5) not null check(subtotal>=0), vat_total numeric(18,5) not null check(vat_total>=0),
  service_rate numeric(5,4) not null default 0.1000 check(service_rate=0.1000), service_amount numeric(18,5) not null check(service_amount>=0), total numeric(18,5) not null check(total>=0),
  authorized_paid_amount numeric(18,5) not null default 0 check(authorized_paid_amount>=0),
  balance_amount numeric(18,5) not null check(balance_amount>=0),
  captured_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,legacy_order_id)
);
create table if not exists public.pos_cash_v2_order_lines (
  id uuid primary key default pg_catalog.gen_random_uuid(), order_id uuid not null references public.pos_cash_v2_orders(id) on delete cascade,
  legacy_item_id uuid,
  line_key text not null, menu_item_id uuid references public.pos_menu_items(id) on delete set null, item_name_snapshot text not null,
  quantity numeric(12,3) not null check(quantity>0), unit_price numeric(18,5) not null check(unit_price>=0), tax_rate numeric(5,4) not null check(tax_rate in (0.0000,0.0100,0.0200,0.0400,0.1300)),
  resolution_state text not null default 'VALID' check(resolution_state in ('VALID','PRICE_REVIEW','MISSING_ITEM','VOIDED')), void_reason text,
  line_subtotal numeric(18,5) not null check(line_subtotal>=0), line_vat numeric(18,5) not null check(line_vat>=0), line_total numeric(18,5) not null check(line_total>=0),
  unique(order_id,line_key)
);

-- A legacy roster write may not invalidate a waiter assigned to an open V2 order.
create or replace function public.pos_cash_v2_employee_deactivation_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare emp uuid; ten uuid;
begin
  if tg_op='DELETE' then emp:=old.id; ten:=old.tenant_id;
  elsif old.is_active and not new.is_active then emp:=old.id; ten:=old.tenant_id;
  else return new;
  end if;
  if exists(select 1 from public.pos_cash_v2_orders o join public.pos_cash_v2_branch_controls bc on bc.tenant_id=o.tenant_id and bc.branch_id=o.branch_id join public.pos_employee_branch_memberships eb on eb.tenant_id=o.tenant_id and eb.branch_id=o.branch_id and eb.employee_id=emp and eb.status='ACTIVE' where o.tenant_id=ten and o.waiter_employee_id=emp and o.status in ('OPEN','HELD') and bc.state in ('ACTIVE','QUIESCING','FROZEN')) then raise exception using errcode='55000',message='WAITER_HAS_OPEN_V2_ORDER'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.pos_cash_v2_employee_deactivation_guard() from public,anon,authenticated,service_role;
drop trigger if exists pos_cash_v2_employee_deactivation_guard on public.pos_employees;
create trigger pos_cash_v2_employee_deactivation_guard before update of is_active or delete on public.pos_employees for each row execute function public.pos_cash_v2_employee_deactivation_guard();

create or replace function public.pos_cash_v2_membership_revocation_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' or (old.status='ACTIVE' and new.status is distinct from 'ACTIVE') then
    if exists(select 1 from public.pos_cash_v2_orders o join public.pos_cash_v2_branch_controls bc on bc.tenant_id=o.tenant_id and bc.branch_id=o.branch_id where o.tenant_id=old.tenant_id and o.branch_id=old.branch_id and o.waiter_employee_id=old.employee_id and o.status in ('OPEN','HELD') and bc.state in ('ACTIVE','QUIESCING','FROZEN')) then raise exception using errcode='55000',message='WAITER_MEMBERSHIP_HAS_OPEN_V2_ORDER'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.pos_cash_v2_membership_revocation_guard() from public,anon,authenticated,service_role;
drop trigger if exists pos_cash_v2_membership_revocation_guard on public.pos_employee_branch_memberships;
create trigger pos_cash_v2_membership_revocation_guard before update of status or delete on public.pos_employee_branch_memberships for each row execute function public.pos_cash_v2_membership_revocation_guard();

create table if not exists public.pos_cash_v2_payments (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, order_id uuid not null references public.pos_cash_v2_orders(id) on delete restrict,
  receiving_session_id uuid not null references public.pos_cash_v2_sessions(id) on delete restrict,
  method text not null check(method in ('CASH','SINPE')), status text not null default 'AUTHORIZED' check(status in ('PENDING','AUTHORIZED','FAILED','REFUNDED','CANCELLED')),
  source_amount numeric(18,5) not null check(source_amount>0), source_currency text not null check(source_currency in ('CRC','USD')), branch_currency text not null check(branch_currency in ('CRC','USD')),
  fx_rate numeric(18,5) not null check(fx_rate>0), converted_amount numeric(18,5) not null check(converted_amount>0), applied_amount numeric(18,5) not null check(applied_amount>0), change_amount numeric(18,5) not null check(change_amount>=0),
  actor_user_id uuid not null, actor_employee_id uuid, authorized_at timestamptz not null default clock_timestamp(), external_reference text, idempotency_key text not null,
  unique(tenant_id,idempotency_key), check(method<>'SINPE' or change_amount=0)
);
create table if not exists public.pos_cash_v2_sinpe_evidence (
  payment_id uuid primary key references public.pos_cash_v2_payments(id) on delete restrict, tenant_id uuid not null, branch_id uuid not null, external_reference text not null, recorded_by_user_id uuid not null, recorded_by_employee_id uuid, recorded_at timestamptz not null default clock_timestamp(), append_only boolean not null default true check(append_only)
);
create table if not exists public.pos_cash_v2_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, cash_register_id uuid, business_date date not null,
  coverage text not null check(coverage in ('REGISTER','T1_TO_T2_HANDOFF','COMPLETE_BRANCH_BUSINESS_DATE')),
  snapshot_kind text not null check(snapshot_kind in ('SESSION','T1_HANDOFF','DAILY')),
  required_register_ids uuid[] not null default '{}'::uuid[], covered_session_ids uuid[] not null default '{}'::uuid[],
  captured_at timestamptz not null default clock_timestamp(), captured_by uuid not null, payload jsonb not null check(jsonb_typeof(payload)='object')
);
create table if not exists public.pos_cash_v2_closures (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, cash_register_id uuid not null, business_date date not null, session_id uuid references public.pos_cash_v2_sessions(id) on delete restrict,
  closed_by_user_id uuid not null, closed_by_employee_id uuid, counted_cash numeric(18,5), expected_cash numeric(18,5), difference numeric(18,5), summary jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp(), unique(tenant_id,session_id), unique(tenant_id,branch_id,cash_register_id,business_date)
);
create table if not exists public.pos_cash_v2_idempotency (
  tenant_id uuid not null, branch_id uuid not null, cash_register_id uuid not null, business_date date not null, actor_user_id uuid not null, actor_employee_id uuid, actor_role text not null, idempotency_key text not null, operation text not null, request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'), response jsonb not null, created_at timestamptz not null default clock_timestamp(), primary key(tenant_id,idempotency_key)
);
create table if not exists public.pos_cash_v2_audit_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, actor_user_id uuid not null, actor_employee_id uuid, actor_role text not null, operation text not null, entity_type text not null, entity_id uuid, request_id text not null, request_sha256 text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp()
);

create index if not exists pos_cash_v2_sessions_day_idx on public.pos_cash_v2_sessions(tenant_id,branch_id,business_date,status);
create index if not exists pos_cash_v2_orders_day_idx on public.pos_cash_v2_orders(tenant_id,branch_id,business_date,status);
create index if not exists pos_cash_v2_payments_session_idx on public.pos_cash_v2_payments(tenant_id,receiving_session_id,status);
create index if not exists pos_cash_v2_audit_day_idx on public.pos_cash_v2_audit_events(tenant_id,branch_id,created_at desc);

-- RLS/forced RLS and no direct browser DML. Service-role executes only approved RPCs.
do $$ declare t text; begin
  foreach t in array array['pos_cash_v2_branch_controls','pos_cash_v2_branch_fiscal_profiles','pos_employee_branch_memberships','pos_cash_v2_sessions','pos_cash_v2_orders','pos_cash_v2_order_lines','pos_cash_v2_payments','pos_cash_v2_sinpe_evidence','pos_cash_v2_snapshots','pos_cash_v2_closures','pos_cash_v2_idempotency','pos_cash_v2_audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('revoke all on table public.%I from service_role',t);
  end loop;
end $$;

-- Append-only protections for evidence, audit and immutable snapshots.
create or replace function public.pos_cash_v2_append_only_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin raise exception using errcode='55000',message='CASH_V2_APPEND_ONLY'; end $$;
revoke all on function public.pos_cash_v2_append_only_guard() from public,anon,authenticated;
drop trigger if exists pos_cash_v2_sinpe_append_only on public.pos_cash_v2_sinpe_evidence;
create trigger pos_cash_v2_sinpe_append_only before update or delete on public.pos_cash_v2_sinpe_evidence for each row execute function public.pos_cash_v2_append_only_guard();
drop trigger if exists pos_cash_v2_audit_append_only on public.pos_cash_v2_audit_events;
create trigger pos_cash_v2_audit_append_only before update or delete on public.pos_cash_v2_audit_events for each row execute function public.pos_cash_v2_append_only_guard();
drop trigger if exists pos_cash_v2_snapshot_append_only on public.pos_cash_v2_snapshots;
create trigger pos_cash_v2_snapshot_append_only before update or delete on public.pos_cash_v2_snapshots for each row execute function public.pos_cash_v2_append_only_guard();


-- Private transaction context. It is a table, not a forgeable GUC.  Rows are
-- keyed by txid_current() and exact table/entity/tenant/branch; direct DML,
-- including service_role DML, cannot create or alter context rows.
create table if not exists public.pos_cash_v2_private_context (
  txid bigint not null,
  table_name text not null,
  entity_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique nulls not distinct (txid,table_name,entity_id,tenant_id,branch_id)
);
alter table public.pos_cash_v2_private_context drop constraint if exists pos_cash_v2_private_context_pkey;
alter table public.pos_cash_v2_private_context drop constraint if exists pos_cash_v2_private_context_txid_table_name_entity_id_tenant_id_branch_id_key;
alter table public.pos_cash_v2_private_context add constraint pos_cash_v2_private_context_scope_key unique nulls not distinct (txid,table_name,entity_id,tenant_id,branch_id);
alter table public.pos_cash_v2_private_context enable row level security;
alter table public.pos_cash_v2_private_context force row level security;
revoke all on table public.pos_cash_v2_private_context from public,anon,authenticated,service_role;

create or replace function public.pos_cash_v2_set_context(p_table text,p_entity uuid,p_tenant uuid,p_branch uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_table is null or p_entity is null or p_tenant is null then raise exception using errcode='22004',message='CASH_V2_CONTEXT_INCOMPLETE'; end if;
  insert into public.pos_cash_v2_private_context(txid,table_name,entity_id,tenant_id,branch_id)
  values(txid_current(),p_table,p_entity,p_tenant,p_branch)
  on conflict (txid,table_name,entity_id,tenant_id,branch_id) do nothing;
end $$;
create or replace function public.pos_cash_v2_clear_context() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ begin null; end $$;

create or replace function public.pos_cash_v2_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_tenant uuid; new_tenant uuid; old_branch uuid; new_branch uuid; old_entity uuid; new_entity uuid; state text; ok boolean;
begin
  old_tenant:=case when tg_op in ('UPDATE','DELETE') then old.tenant_id end; new_tenant:=case when tg_op in ('UPDATE','INSERT') then new.tenant_id end;
  old_entity:=case when tg_op in ('UPDATE','DELETE') then old.id end; new_entity:=case when tg_op in ('UPDATE','INSERT') then new.id end;
  old_branch:=case when tg_op in ('UPDATE','DELETE') then case when tg_table_name in ('pos_payments','pos_order_items') then (select o.branch_id from public.pos_orders o where o.id=old.order_id and o.tenant_id=old.tenant_id) when tg_table_name='pos_recipes' then (select m.branch_id from public.pos_menu_items m where m.id=old.menu_item_id and m.tenant_id=old.tenant_id) when tg_table_name='pos_employees' then null else old.branch_id end end;
  new_branch:=case when tg_op in ('UPDATE','INSERT') then case when tg_table_name in ('pos_payments','pos_order_items') then (select o.branch_id from public.pos_orders o where o.id=new.order_id and o.tenant_id=new.tenant_id) when tg_table_name='pos_recipes' then (select m.branch_id from public.pos_menu_items m where m.id=new.menu_item_id and m.tenant_id=new.tenant_id) when tg_table_name='pos_employees' then null else new.branch_id end end;
  if tg_table_name='pos_menu_items' and (old_branch is null or new_branch is null) and exists(select 1 from public.pos_cash_v2_branch_controls bc join public.pos_cash_v2_order_lines l on l.menu_item_id=coalesce(new_entity,old_entity) join public.pos_cash_v2_orders vo on vo.id=l.order_id and vo.tenant_id=bc.tenant_id and vo.branch_id=bc.branch_id where bc.tenant_id=coalesce(new_tenant,old_tenant) and bc.state in ('ACTIVE','QUIESCING','FROZEN')) then
    if not exists(select 1 from public.pos_cash_v2_private_context c where c.txid=txid_current() and c.table_name=tg_table_name and c.entity_id=coalesce(new_entity,old_entity) and c.tenant_id=coalesce(new_tenant,old_tenant) and c.branch_id is null) then raise exception using errcode='55000',message='CASH_V2_GLOBAL_CATALOG_CONTEXT_REQUIRED'; end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    select bc.state into state from public.pos_cash_v2_branch_controls bc where bc.tenant_id=old_tenant and bc.branch_id=old_branch;
    if coalesce(state,'OFF') not in ('OFF','PREPARED') then
      select exists(select 1 from public.pos_cash_v2_private_context c where c.txid=txid_current() and c.table_name=tg_table_name and c.entity_id=old_entity and c.tenant_id=old_tenant and c.branch_id is not distinct from old_branch) into ok;
      if not ok then raise exception using errcode='55000',message='CASH_V2_OLD_PRIVATE_CONTEXT_REQUIRED'; end if;
    end if;
  end if;
  select bc.state into state from public.pos_cash_v2_branch_controls bc where bc.tenant_id=new_tenant and bc.branch_id=new_branch;
  if coalesce(state,'OFF') in ('OFF','PREPARED') then return case when tg_op='DELETE' then old else new end; end if;
  select exists(select 1 from public.pos_cash_v2_private_context c where c.txid=txid_current() and c.table_name=tg_table_name and c.entity_id=new_entity and c.tenant_id=new_tenant and c.branch_id is not distinct from new_branch) into ok;
  if not ok then raise exception using errcode='55000',message='CASH_V2_NEW_PRIVATE_CONTEXT_REQUIRED'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.pos_cash_v2_set_context(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pos_cash_v2_clear_context() from public,anon,authenticated,service_role;
revoke all on function public.pos_cash_v2_gate() from public,anon,authenticated,service_role;

do $$ declare t text; begin
  foreach t in array array['pos_tables','pos_orders','pos_order_items','pos_payments','pos_cash_shifts','pos_daily_cash_closures','pos_invoices','pos_menu_items'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists pos_cash_v2_gate_%I on public.%I',t,t);
      execute format('create trigger pos_cash_v2_gate_%I before insert or update or delete on public.%I for each row execute function public.pos_cash_v2_gate()',t,t);
      execute format('revoke truncate on table public.%I from public,anon,authenticated,service_role',t);
    end if;
  end loop;
end $$;

-- V2 table DML is private to SECURITY DEFINER RPCs.  The API preflight gets
-- read-only access only to the three control/profile/membership tables.
do $$ declare t text; begin
  foreach t in array array['pos_cash_v2_branch_controls','pos_cash_v2_branch_fiscal_profiles','pos_employee_branch_memberships','pos_cash_v2_sessions','pos_cash_v2_orders','pos_cash_v2_order_lines','pos_cash_v2_payments','pos_cash_v2_sinpe_evidence','pos_cash_v2_snapshots','pos_cash_v2_closures','pos_cash_v2_idempotency','pos_cash_v2_audit_events'] loop
    execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t); execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
grant select on public.pos_cash_v2_branch_controls,public.pos_cash_v2_branch_fiscal_profiles,public.pos_employee_branch_memberships to service_role;

create or replace function public.pos_cash_v2_append_only_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin raise exception using errcode='55000',message='CASH_V2_APPEND_ONLY'; end $$;
revoke all on function public.pos_cash_v2_append_only_guard() from public,anon,authenticated,service_role;
drop trigger if exists pos_cash_v2_sinpe_append_only on public.pos_cash_v2_sinpe_evidence;
create trigger pos_cash_v2_sinpe_append_only before update or delete on public.pos_cash_v2_sinpe_evidence for each row execute function public.pos_cash_v2_append_only_guard();
drop trigger if exists pos_cash_v2_audit_append_only on public.pos_cash_v2_audit_events;
create trigger pos_cash_v2_audit_append_only before update or delete on public.pos_cash_v2_audit_events for each row execute function public.pos_cash_v2_append_only_guard();
drop trigger if exists pos_cash_v2_snapshot_append_only on public.pos_cash_v2_snapshots;
create trigger pos_cash_v2_snapshot_append_only before update or delete on public.pos_cash_v2_snapshots for each row execute function public.pos_cash_v2_append_only_guard();

-- A session has one closure; a register/day may have T1 and T2 closures.
alter table public.pos_cash_v2_closures drop constraint if exists pos_cash_v2_closures_tenant_id_branch_id_cash_register_id_business_date_key;

create or replace function public.pos_cash_v2_assert_scope(p_command jsonb,p_tenant uuid,p_branch uuid,p_register uuid,p_date date,p_key text,p_sha text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if jsonb_typeof(p_command) <> 'object'
     or jsonb_typeof(p_command->'scope') <> 'object'
     or p_command->'scope'->>'tenantId' is distinct from p_tenant::text
     or p_command->'scope'->>'branchId' is distinct from p_branch::text
     or p_command->'scope'->>'cashRegisterId' is distinct from p_register::text
     or p_command->'scope'->>'businessDate' is distinct from p_date::text
     or jsonb_typeof(p_command->'request') <> 'object'
     or p_command->'request'->>'idempotencyKey' is distinct from p_key
     or p_command->'request'->>'requestSha256' is distinct from p_sha then
    raise exception using errcode='42501',message='COMMAND_SCOPE_OR_REQUEST_REQUIRED';
  end if;
end $$;

create or replace function public.pos_cash_v2_require_scope(p_tenant uuid,p_branch uuid,p_register uuid,p_date date,p_user uuid,p_employee uuid,p_role text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare st text; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; o public.pos_daily_cash_openings%rowtype; r public.pos_cash_registers%rowtype; b public.pos_branches%rowtype; er text;
begin
  select * into b from public.pos_branches where tenant_id=p_tenant and id=p_branch and is_active for update; if not found then raise exception using errcode='P0002',message='BRANCH_NOT_AVAILABLE'; end if;
  select state into st from public.pos_cash_v2_branch_controls where tenant_id=p_tenant and branch_id=p_branch;
  if st is null or st is distinct from 'ACTIVE' then raise exception using errcode='55000',message='BRANCH_V2_NOT_ACTIVE'; end if;
  select * into r from public.pos_cash_registers where tenant_id=p_tenant and id=p_register and branch_id=p_branch and is_active for update; if not found then raise exception using errcode='P0002',message='REGISTER_NOT_AVAILABLE'; end if;
  select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant and branch_id=p_branch; if not found then raise exception using errcode='55000',message='FISCAL_PROFILE_MISSING'; end if;
  select * into o from public.pos_daily_cash_openings where tenant_id=p_tenant and branch_id=p_branch and cash_register_id=p_register and opened_at<=clock_timestamp() order by opened_at desc,id desc limit 1 for update; if not found then raise exception using errcode='55000',message='DAILY_OPENING_REQUIRED'; end if;
  if exists(select 1 from public.pos_daily_cash_closures c where c.tenant_id=p_tenant and c.branch_id=p_branch and c.cash_register_id=p_register and c.business_date=o.business_date) then raise exception using errcode='55000',message='DAILY_CASH_CLOSED'; end if;
  if p_employee is null then if p_role<>'OWNER' then raise exception using errcode='42501',message='OWNER_ROLE_REQUIRED'; end if; else select e.role into er from public.pos_employees e join public.pos_employee_branch_memberships eb on eb.employee_id=e.id and eb.tenant_id=e.tenant_id where e.tenant_id=p_tenant and e.id=p_employee and e.is_active and eb.branch_id=p_branch and eb.status='ACTIVE'; if not found then raise exception using errcode='42501',message='BRANCH_MEMBERSHIP_REQUIRED'; end if; if er is distinct from p_role then raise exception using errcode='42501',message='EMPLOYEE_ROLE_MISMATCH'; end if; end if;
  return jsonb_build_object('business_date',o.business_date,'opened_by',o.opened_by,'currency',f.currency,'tax_regime',f.tax_regime,'price_basis',f.price_basis);
end $$;

create or replace function public.pos_cash_v2_idempotent(p_tenant uuid,p_branch uuid,p_register uuid,p_date date,p_user uuid,p_employee uuid,p_role text,p_key text,p_op text,p_sha text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare x public.pos_cash_v2_idempotency%rowtype;
begin
  if p_key is null or length(p_key)<1 or length(p_key)>200 or p_sha !~ '^[0-9a-f]{64}$' or p_tenant is null or p_branch is null or p_register is null or p_date is null or p_user is null or p_role is null then raise exception using errcode='22023',message='INVALID_IDEMPOTENCY_SCOPE_ACTOR'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||chr(0)||p_key,0));
  select * into x from public.pos_cash_v2_idempotency where tenant_id=p_tenant and idempotency_key=p_key for update;
  if found then
    if x.operation is distinct from p_op or x.request_sha256 is distinct from p_sha or x.branch_id is distinct from p_branch or x.cash_register_id is distinct from p_register or x.business_date is distinct from p_date or x.actor_user_id is distinct from p_user or x.actor_employee_id is distinct from p_employee or x.actor_role is distinct from p_role then
      raise exception using errcode='23505',message='IDEMPOTENCY_KEY_REUSE';
    end if;
    return x.response;
  end if;
  return null;
end $$;
create or replace function public.pos_cash_v2_finish_idempotent(p_tenant uuid,p_branch uuid,p_register uuid,p_date date,p_user uuid,p_employee uuid,p_role text,p_key text,p_op text,p_sha text,p_response jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||chr(0)||p_key,0));
  r:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(p_response,'{}'::jsonb),'tenantId',to_jsonb(p_tenant::text),true),'branchId',to_jsonb(p_branch::text),true),'cashRegisterId',to_jsonb(p_register::text),true),'businessDate',to_jsonb(p_date::text),true),'actorUserId',to_jsonb(p_user::text),true),'actorRole',to_jsonb(p_role),true);
  r:=jsonb_set(r,'actorEmployeeId',coalesce(to_jsonb(p_employee::text),'null'::jsonb),true);
  insert into public.pos_cash_v2_idempotency(tenant_id,branch_id,cash_register_id,business_date,actor_user_id,actor_employee_id,actor_role,idempotency_key,operation,request_sha256,response) values(p_tenant,p_branch,p_register,p_date,p_user,p_employee,p_role,p_key,p_op,p_sha,r);
end $$;
create or replace function public.pos_cash_v2_audit(p_tenant uuid,p_branch uuid,p_user uuid,p_employee uuid,p_role text,p_op text,p_type text,p_id uuid,p_key text,p_sha text,p_meta jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin insert into public.pos_cash_v2_audit_events(tenant_id,branch_id,actor_user_id,actor_employee_id,actor_role,operation,entity_type,entity_id,request_id,request_sha256,metadata) values(p_tenant,p_branch,p_user,p_employee,p_role,p_op,p_type,p_id,p_key,p_sha,coalesce(p_meta,'{}')); end $$;

create or replace function public.pos_cash_v2_t1_handoff_snapshot(
  p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,
  p_target_t1_session_id uuid,p_target_t2_session_id uuid,p_captured_by uuid,
  p_idempotency_key text,p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_register_ids uuid[]; v_session_ids uuid[]; v_t1_session_ids uuid[]; v_order_ids uuid[];
  v_t1 public.pos_cash_v2_sessions%rowtype; v_t2 public.pos_cash_v2_sessions%rowtype;
  v_open_orders jsonb; v_open_tables jsonb; v_waiters jsonb; v_lines jsonb; v_payments jsonb;
  v_handoff jsonb; v_payload jsonb; v_snapshot_id uuid:=pg_catalog.gen_random_uuid(); v_rows int;
begin
  -- This helper is called from OPEN_SHIFT after the branch row has already been
  -- locked. Re-locking it here makes the helper safe against accidental reuse.
  perform 1 from public.pos_branches where tenant_id=p_tenant_id and id=p_branch_id and is_active for update;
  if not found then raise exception using errcode='P0002',message='BRANCH_NOT_AVAILABLE'; end if;
  perform rr.id from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active order by rr.id for update;
  select array_agg(rr.id order by rr.id) into v_register_ids from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active;
  if coalesce(cardinality(v_register_ids),0)=0 or not (p_cash_register_id=any(v_register_ids)) then raise exception using errcode='55000',message='ACTIVE_REGISTER_ROSTER_EMPTY_OR_INVALID'; end if;
  perform ss.id from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date order by ss.cash_register_id,ss.logical_shift,ss.id for update;
  select array_agg(ss.id order by ss.cash_register_id,ss.logical_shift,ss.id) into v_session_ids from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date;
  if exists(select 1 from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date and not (ss.cash_register_id=any(v_register_ids))) then raise exception using errcode='55000',message='SESSION_OUTSIDE_ACTIVE_REGISTER_ROSTER'; end if;
  select array_agg(ss.id order by ss.cash_register_id,ss.id) into v_t1_session_ids from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date and ss.logical_shift=1 and ss.status='CLOSED' and ss.counted_cash is not null and ss.cash_register_id=any(v_register_ids);
  if coalesce(cardinality(v_t1_session_ids),0)<>cardinality(v_register_ids) or exists(select 1 from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active and not exists(select 1 from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.cash_register_id=rr.id and ss.business_date=p_business_date and ss.logical_shift=1 and ss.status='CLOSED' and ss.counted_cash is not null)) then raise exception using errcode='55000',message='T2_REQUIRES_BRANCHWIDE_CLOSED_T1'; end if;
  select * into v_t1 from public.pos_cash_v2_sessions where id=p_target_t1_session_id and tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=1 and status='CLOSED' and counted_cash is not null;
  if not found then raise exception using errcode='55000',message='TARGET_T1_SESSION_UNVERIFIABLE'; end if;
  select * into v_t2 from public.pos_cash_v2_sessions where id=p_target_t2_session_id and tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=2 and status='OPEN';
  if not found then raise exception using errcode='55000',message='TARGET_T2_SESSION_UNVERIFIABLE'; end if;

  -- Canonical V2 lock order after branch/register/session: orders, tables, lines,
  -- then payments. Legacy mirrors can only be written through these V2 RPCs.
  perform vo.id from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status in ('OPEN','HELD') order by vo.id for update;
  perform t.id from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=p_branch_id and (t.status in ('OCCUPIED','BUSY','PRE_CHECK') or exists(select 1 from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.table_id=t.id and vo.status in ('OPEN','HELD'))) order by t.id for update;
  perform lo.id from public.pos_orders lo join public.pos_cash_v2_orders vo on vo.legacy_order_id=lo.id and vo.tenant_id=lo.tenant_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status in ('OPEN','HELD') order by lo.id for update of lo;
  perform ol.id from public.pos_cash_v2_order_lines ol join public.pos_cash_v2_orders vo on vo.id=ol.order_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status in ('OPEN','HELD') order by ol.order_id,ol.id for update of ol;
  perform p.id from public.pos_cash_v2_payments p where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and (p.order_id in (select vo.id from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status in ('OPEN','HELD')) or p.receiving_session_id=any(coalesce(v_session_ids,'{}'::uuid[]))) order by p.id for update;

  if exists(select 1 from public.pos_cash_v2_orders vo left join public.pos_tables t on t.id=vo.table_id and t.tenant_id=vo.tenant_id and t.branch_id=vo.branch_id left join public.pos_orders lo on lo.id=vo.legacy_order_id and lo.tenant_id=vo.tenant_id and lo.branch_id=vo.branch_id left join public.pos_cash_v2_sessions os on os.id=vo.origin_session_id left join public.pos_cash_v2_sessions ss on ss.id=vo.serving_session_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status in ('OPEN','HELD') and (vo.status<>'OPEN' or vo.legacy_order_id is null or lo.id is null or lo.status not in ('OPEN','SENT','IN_PREPARATION','READY','SERVED') or lo.table_id is distinct from vo.table_id or t.id is null or t.status not in ('OCCUPIED','BUSY','PRE_CHECK') or not (vo.cash_register_id=any(v_register_ids)) or os.id is null or os.tenant_id is distinct from vo.tenant_id or os.branch_id is distinct from vo.branch_id or os.cash_register_id is distinct from vo.cash_register_id or os.business_date is distinct from vo.business_date or ss.id is null or ss.tenant_id is distinct from vo.tenant_id or ss.branch_id is distinct from vo.branch_id or ss.cash_register_id is distinct from vo.cash_register_id or ss.business_date is distinct from vo.business_date or ss.status not in ('OPEN','CLOSED') or not exists(select 1 from public.pos_employee_branch_memberships eb join public.pos_employees e on e.id=eb.employee_id and e.tenant_id=eb.tenant_id where eb.tenant_id=vo.tenant_id and eb.branch_id=vo.branch_id and eb.employee_id=vo.waiter_employee_id and eb.status='ACTIVE' and e.is_active and e.name=vo.waiter_name_snapshot) or not exists(select 1 from public.pos_cash_v2_order_lines ol where ol.order_id=vo.id) or exists(select 1 from public.pos_cash_v2_order_lines ol where ol.order_id=vo.id and (ol.resolution_state<>'VALID' or ol.line_subtotal<>round(ol.quantity*ol.unit_price,5) or ol.line_vat<>round(ol.line_subtotal*ol.tax_rate,5) or ol.line_total<>ol.line_subtotal+ol.line_vat)) or vo.subtotal is distinct from (select coalesce(sum(ol.line_subtotal),0) from public.pos_cash_v2_order_lines ol where ol.order_id=vo.id) or vo.vat_total is distinct from (select coalesce(sum(ol.line_vat),0) from public.pos_cash_v2_order_lines ol where ol.order_id=vo.id) or vo.service_rate<>0.1000 or vo.service_amount is distinct from round(vo.subtotal*0.1000,5) or vo.total is distinct from vo.subtotal+vo.vat_total+vo.service_amount or vo.authorized_paid_amount is distinct from (select coalesce(sum(p.applied_amount),0) from public.pos_cash_v2_payments p join public.pos_cash_v2_sessions rs on rs.id=p.receiving_session_id where p.tenant_id=vo.tenant_id and p.branch_id=vo.branch_id and p.order_id=vo.id and p.status='AUTHORIZED' and rs.tenant_id=vo.tenant_id and rs.branch_id=vo.branch_id and rs.cash_register_id=vo.cash_register_id and rs.business_date=vo.business_date) or vo.balance_amount is distinct from greatest(vo.total-vo.authorized_paid_amount,0))) then raise exception using errcode='55000',message='OPEN_ORDER_OR_WAITER_OR_TOTAL_UNVERIFIABLE'; end if;
  if exists(select 1 from public.pos_cash_v2_payments p left join public.pos_cash_v2_sessions rs on rs.id=p.receiving_session_id where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and (p.status in ('PENDING','REFUNDED') or rs.id is null or rs.tenant_id is distinct from p.tenant_id or rs.branch_id is distinct from p.branch_id or rs.business_date is distinct from p_business_date or p.branch_currency is distinct from (select fp.currency from public.pos_cash_v2_branch_fiscal_profiles fp where fp.tenant_id=p_tenant_id and fp.branch_id=p_branch_id) or (p.status='AUTHORIZED' and p.method='SINPE' and not exists(select 1 from public.pos_cash_v2_sinpe_evidence se where se.payment_id=p.id and se.tenant_id=p.tenant_id and se.branch_id=p.branch_id and se.append_only)))) then raise exception using errcode='55000',message='PAYMENT_RECEIVING_SESSION_OR_EVIDENCE_UNVERIFIABLE'; end if;
  if exists(select 1 from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=p_branch_id and t.status in ('OCCUPIED','BUSY','PRE_CHECK') and (select count(*) from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.table_id=t.id and vo.status='OPEN')<>1) or exists(select 1 from public.pos_cash_v2_orders vo join public.pos_tables t on t.id=vo.table_id and t.tenant_id=vo.tenant_id and t.branch_id=vo.branch_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status='OPEN' and t.status not in ('OCCUPIED','BUSY','PRE_CHECK')) then raise exception using errcode='55000',message='ORPHAN_OCCUPIED_TABLE_OR_ORDER'; end if;
  if exists(select 1 from public.pos_orders lo where lo.tenant_id=p_tenant_id and lo.branch_id=p_branch_id and lo.status in ('OPEN','SENT','IN_PREPARATION','READY','SERVED') and not exists(select 1 from public.pos_cash_v2_orders vo where vo.tenant_id=lo.tenant_id and vo.branch_id=lo.branch_id and vo.legacy_order_id=lo.id and vo.business_date=p_business_date and vo.status='OPEN')) then raise exception using errcode='55000',message='UNMAPPED_LEGACY_OPEN_ORDER'; end if;
  if exists(select 1 from public.pos_payments lp join public.pos_orders lo on lo.id=lp.order_id and lo.tenant_id=lp.tenant_id where lp.tenant_id=p_tenant_id and lo.branch_id=p_branch_id and lp.status in ('PENDING','AUTHORIZED')) or exists(select 1 from public.pos_payments lp where lp.tenant_id=p_tenant_id and not exists(select 1 from public.pos_orders lo where lo.id=lp.order_id and lo.tenant_id=lp.tenant_id)) then raise exception using errcode='55000',message='UNRESOLVED_LEGACY_PAYMENT'; end if;

  select coalesce(array_agg(vo.id order by vo.id),'{}'::uuid[]) into v_order_ids from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.cash_register_id=p_cash_register_id and vo.serving_session_id=p_target_t1_session_id and vo.status='OPEN';
  select coalesce(jsonb_agg(to_jsonb(vo) order by vo.id),'[]'::jsonb) into v_open_orders from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status='OPEN';
  select coalesce(jsonb_agg(jsonb_build_object('table',to_jsonb(t),'openOrderIds',(select coalesce(jsonb_agg(vo.id order by vo.id),'[]'::jsonb) from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.table_id=t.id and vo.status='OPEN')) order by t.id),'[]'::jsonb) into v_open_tables from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=p_branch_id and t.status in ('OCCUPIED','BUSY','PRE_CHECK');
  select coalesce(jsonb_agg(jsonb_build_object('orderId',vo.id,'employeeId',e.id,'name',e.name,'role',e.role,'membershipStatus',eb.status) order by vo.id),'[]'::jsonb) into v_waiters from public.pos_cash_v2_orders vo join public.pos_employees e on e.id=vo.waiter_employee_id and e.tenant_id=vo.tenant_id join public.pos_employee_branch_memberships eb on eb.employee_id=e.id and eb.tenant_id=e.tenant_id and eb.branch_id=vo.branch_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status='OPEN';
  select coalesce(jsonb_agg(to_jsonb(ol) order by ol.order_id,ol.line_key),'[]'::jsonb) into v_lines from public.pos_cash_v2_order_lines ol join public.pos_cash_v2_orders vo on vo.id=ol.order_id where vo.tenant_id=p_tenant_id and vo.branch_id=p_branch_id and vo.business_date=p_business_date and vo.status='OPEN';
  select coalesce(jsonb_agg(jsonb_build_object('payment',to_jsonb(p),'receivingSession',jsonb_build_object('sessionId',rs.id,'tenantId',rs.tenant_id,'branchId',rs.branch_id,'cashRegisterId',rs.cash_register_id,'businessDate',rs.business_date,'logicalShift',rs.logical_shift)) order by p.authorized_at,p.id),'[]'::jsonb) into v_payments from public.pos_cash_v2_payments p join public.pos_cash_v2_sessions rs on rs.id=p.receiving_session_id where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and rs.tenant_id=p_tenant_id and rs.branch_id=p_branch_id and rs.business_date=p_business_date and p.status='AUTHORIZED';
  select coalesce(jsonb_agg(jsonb_build_object('orderId',vo.id,'tableId',vo.table_id,'originSessionId',vo.origin_session_id,'fromServingSessionId',vo.serving_session_id,'toServingSessionId',p_target_t2_session_id,'waiterEmployeeId',vo.waiter_employee_id,'subtotal',vo.subtotal,'vatTotal',vo.vat_total,'serviceAmount',vo.service_amount,'total',vo.total,'authorizedPaidAmount',vo.authorized_paid_amount,'balanceAmount',vo.balance_amount,'authorizedPaymentsByReceivingSession',(select coalesce(jsonb_agg(jsonb_build_object('paymentId',p.id,'receivingSessionId',p.receiving_session_id,'appliedAmount',p.applied_amount,'method',p.method) order by p.authorized_at,p.id),'[]'::jsonb) from public.pos_cash_v2_payments p where p.tenant_id=vo.tenant_id and p.branch_id=vo.branch_id and p.order_id=vo.id and p.status='AUTHORIZED')) order by vo.id),'[]'::jsonb) into v_handoff from public.pos_cash_v2_orders vo where vo.id=any(v_order_ids);
  v_payload:=jsonb_build_object('authority','SERVER','coverage','T1_TO_T2_HANDOFF','snapshotKind','T1_HANDOFF','tenantId',p_tenant_id,'branchId',p_branch_id,'businessDate',p_business_date,'activeRegisterIds',to_jsonb(v_register_ids),'requiredRegisterIds',to_jsonb(v_register_ids),'coveredSessionIds',to_jsonb(coalesce(v_session_ids,'{}'::uuid[])),'t1SessionIds',to_jsonb(v_t1_session_ids),'targetCashRegisterId',p_cash_register_id,'targetT1SessionId',p_target_t1_session_id,'targetT2SessionId',p_target_t2_session_id,'openOrders',v_open_orders,'occupiedTables',v_open_tables,'validatedWaiters',v_waiters,'orderLines',v_lines,'authorizedPaymentsByReceivingSession',v_payments,'handoffOrders',v_handoff,'completeBranchBusinessDate',false,'capturedAt',clock_timestamp(),'idempotencyKey',p_idempotency_key,'requestSha256',p_request_sha256);
  update public.pos_cash_v2_orders set serving_session_id=p_target_t2_session_id,updated_at=clock_timestamp() where id=any(v_order_ids) and tenant_id=p_tenant_id and branch_id=p_branch_id and business_date=p_business_date and status='OPEN'; get diagnostics v_rows=row_count;
  if v_rows<>cardinality(v_order_ids) then raise exception using errcode='55000',message='T1_T2_HANDOFF_ORDER_SET_CHANGED'; end if;
  insert into public.pos_cash_v2_snapshots(id,tenant_id,branch_id,cash_register_id,business_date,coverage,snapshot_kind,required_register_ids,covered_session_ids,captured_by,payload) values(v_snapshot_id,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,'T1_TO_T2_HANDOFF','T1_HANDOFF',v_register_ids,coalesce(v_session_ids,'{}'::uuid[]),p_captured_by,v_payload);
  return jsonb_build_object('snapshotId',v_snapshot_id,'targetT1SessionId',p_target_t1_session_id,'targetT2SessionId',p_target_t2_session_id,'handedOffOrderIds',to_jsonb(v_order_ids),'payload',v_payload);
end $$;

create or replace function public.pos_cash_v2_open_shift(p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text,p_idempotency_key text,p_request_sha256 text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; z jsonb; n int; fl numeric; sid uuid:=pg_catalog.gen_random_uuid(); sh public.pos_cash_shifts%rowtype; s public.pos_cash_v2_sessions%rowtype; s1 public.pos_cash_v2_sessions%rowtype; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; v_register_ids uuid[]; handoff jsonb; out jsonb;
begin
  perform public.pos_cash_v2_assert_scope(p_command,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_idempotency_key,p_request_sha256);
  q:=public.pos_cash_v2_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'OPEN_SHIFT',p_request_sha256); if q is not null then return q; end if;
  z:=public.pos_cash_v2_require_scope(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role); if p_actor_role not in ('OWNER','ADMIN','CAJERO') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if;
  n:=coalesce((p_command->>'logicalShift')::int,1); fl:=(p_command->>'openingFloat')::numeric; if n not in (1,2) or fl is null or fl<0 or fl<>round(fl,5) then raise exception using errcode='22023',message='INVALID_OPENING_FLOAT'; end if;
  select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=p_branch_id; if not found then raise exception using errcode='55000',message='FISCAL_PROFILE_MISSING'; end if;
  if (f.currency='CRC' and fl<>trunc(fl)) or (f.currency='USD' and fl*100<>trunc(fl*100)) then raise exception using errcode='22023',message='OPENING_FLOAT_MINOR_UNIT_REQUIRED'; end if;
  perform 1 from public.pos_branches where tenant_id=p_tenant_id and id=p_branch_id and is_active for update;
  if n=2 then
    perform rr.id from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active order by rr.id for update;
    select array_agg(rr.id order by rr.id) into v_register_ids from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active;
    if coalesce(cardinality(v_register_ids),0)=0 or not (p_cash_register_id=any(v_register_ids)) then raise exception using errcode='55000',message='ACTIVE_REGISTER_ROSTER_EMPTY_OR_INVALID'; end if;
    perform ss.id from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date order by ss.cash_register_id,ss.logical_shift,ss.id for update;
    if exists(select 1 from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date and not (ss.cash_register_id=any(v_register_ids))) or exists(select 1 from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.business_date=p_business_date and ss.logical_shift=1 and ss.status<>'CLOSED') or exists(select 1 from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=p_branch_id and rr.is_active and not exists(select 1 from public.pos_cash_v2_sessions ss where ss.tenant_id=p_tenant_id and ss.branch_id=p_branch_id and ss.cash_register_id=rr.id and ss.business_date=p_business_date and ss.logical_shift=1 and ss.status='CLOSED' and ss.counted_cash is not null)) then raise exception using errcode='55000',message='T2_REQUIRES_BRANCHWIDE_CLOSED_T1'; end if;
    if exists(select 1 from public.pos_cash_shifts cs where cs.tenant_id=p_tenant_id and cs.branch_id=p_branch_id and cs.status='OPEN') then raise exception using errcode='55000',message='UNMAPPED_LEGACY_OPEN_SHIFT'; end if;
    if exists(select 1 from public.pos_cash_v2_sessions where tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=2) then raise exception using errcode='23505',message='T2_SESSION_ALREADY_EXISTS'; end if;
    select * into s1 from public.pos_cash_v2_sessions where tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=1 for update;
    if not found or s1.status<>'CLOSED' or fl<>s1.counted_cash then raise exception using errcode='55000',message='T2_REQUIRES_CLOSED_T1_COUNTED_FLOAT'; end if;
  else
    if exists(select 1 from public.pos_cash_v2_sessions where tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=1) then raise exception using errcode='23505',message='T1_SESSION_ALREADY_EXISTS'; end if;
  end if;
  if exists(select 1 from public.pos_cash_shifts where tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and status='OPEN') then raise exception using errcode='55000',message='LEGACY_OPEN_SHIFT'; end if;
  perform public.pos_cash_v2_set_context('pos_cash_shifts',sid,p_tenant_id,p_branch_id); insert into public.pos_cash_shifts(id,tenant_id,branch_id,cash_register_id,opened_by,status,opening_float,opened_at) values(sid,p_tenant_id,p_branch_id,p_cash_register_id,p_actor_user_id,'OPEN',fl,clock_timestamp()) returning * into sh;
  insert into public.pos_cash_v2_sessions(tenant_id,branch_id,cash_register_id,pos_cash_shift_id,business_date,logical_shift,opening_float,opened_by_user_id,opened_by_employee_id) values(p_tenant_id,p_branch_id,p_cash_register_id,sid,p_business_date,n,fl,p_actor_user_id,p_actor_employee_id) returning * into s;
  if n=2 then handoff:=public.pos_cash_v2_t1_handoff_snapshot(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,s1.id,s.id,p_actor_user_id,p_idempotency_key,p_request_sha256); end if;
  out:=jsonb_build_object('authority','SERVER','sessionId',s.id,'posCashShiftId',sid,'tenantId',p_tenant_id,'branchId',p_branch_id,'cashRegisterId',p_cash_register_id,'businessDate',p_business_date,'logicalShift',n,'status','OPEN','openingFloat',fl,'openedAt',s.opened_at,'currency',f.currency,'handoff',handoff);
  perform public.pos_cash_v2_clear_context(); perform public.pos_cash_v2_audit(p_tenant_id,p_branch_id,p_actor_user_id,p_actor_employee_id,p_actor_role,'OPEN_SHIFT','SESSION',s.id,p_idempotency_key,p_request_sha256,out); perform public.pos_cash_v2_finish_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'OPEN_SHIFT',p_request_sha256,out); return out;
end $$;

create or replace function public.pos_cash_v2_sync_order(p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text,p_idempotency_key text,p_request_sha256 text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; z jsonb; item_id uuid; line_map jsonb:='{}'::jsonb; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; s public.pos_cash_v2_sessions%rowtype; o public.pos_cash_v2_orders%rowtype; item jsonb; mi public.pos_menu_items%rowtype; oid uuid; legacy_id uuid; tid uuid; wid uuid; prior_waiter uuid; old_tid uuid; submitted numeric; current numeric; qty numeric; lsub numeric; lvat numeric; subtotal numeric:=0; vat numeric:=0; total numeric; service numeric; held boolean:=false; out jsonb; line_state text; ls jsonb:=p_command->'lines'; legacy_status text; legacy_order_number text; order_exists boolean; crypto_schema text;
begin
  select n.nspname into crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'; perform set_config('search_path','pg_catalog,'||quote_ident(crypto_schema),true);
  perform public.pos_cash_v2_assert_scope(p_command,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_idempotency_key,p_request_sha256); q:=public.pos_cash_v2_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'SYNC_ORDER',p_request_sha256); if q is not null then return q; end if; z:=public.pos_cash_v2_require_scope(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role); if p_actor_role not in ('OWNER','ADMIN','SALONERO','SALONERO_CAJA','WAITER','CAJERO') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if;
  select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=p_branch_id; if exists(select 1 from jsonb_array_elements(ls) x where nullif(x->>'taxRate','')::numeric not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and nullif(x->>'taxRate','')::numeric is distinct from 0)) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; if jsonb_typeof(ls)<>'array' or jsonb_array_length(ls)=0 then raise exception using errcode='22023',message='ORDER_LINES_REQUIRED'; end if; tid:=nullif(p_command->>'tableId','')::uuid; wid:=nullif(p_command->>'waiterEmployeeId','')::uuid; if tid is null or wid is null then raise exception using errcode='22023',message='INVALID_ORDER_SCOPE'; end if; select * into s from public.pos_cash_v2_sessions where id=nullif(p_command->>'sessionId','')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date for update; if not found or s.status<>'OPEN' then raise exception using errcode='55000',message='SERVING_SESSION_NOT_OPEN'; end if; oid:=coalesce(nullif(p_command->>'orderId','')::uuid,pg_catalog.gen_random_uuid()); select * into o from public.pos_cash_v2_orders where id=oid and tenant_id=p_tenant_id and branch_id=p_branch_id for update; order_exists:=found; if not order_exists and exists(select 1 from public.pos_orders lo where lo.id=oid and lo.tenant_id=p_tenant_id and lo.branch_id=p_branch_id) then raise exception using errcode='55000',message='LEGACY_ORDER_MAPPING_REQUIRED'; end if; if order_exists and o.authorized_paid_amount>0 then raise exception using errcode='55000',message='ORDER_HAS_AUTHORIZED_PAYMENTS'; end if; select 1 into z from public.pos_tables where id=tid and tenant_id=p_tenant_id and branch_id=p_branch_id for update; if not found then raise exception using errcode='23503',message='TABLE_BRANCH_MISMATCH'; end if; if not exists(select 1 from public.pos_employee_branch_memberships eb join public.pos_employees e on e.id=eb.employee_id and e.tenant_id=eb.tenant_id where eb.tenant_id=p_tenant_id and eb.branch_id=p_branch_id and eb.employee_id=wid and eb.status='ACTIVE' and e.is_active and e.role in ('WAITER','SALONERO','SALONERO_CAJA','ADMIN','CAJERO')) then raise exception using errcode='42501',message='WAITER_MEMBERSHIP_REQUIRED'; end if;
  if order_exists then old_tid:=o.table_id; prior_waiter:=o.waiter_employee_id; if prior_waiter is distinct from wid then if nullif(p_command->>'currentWaiterPin','') is null then raise exception using errcode='42501',message='CURRENT_WAITER_PIN_REQUIRED'; end if; if p_actor_employee_id is distinct from prior_waiter or p_actor_role not in ('WAITER','SALONERO','SALONERO_CAJA') then raise exception using errcode='42501',message='CURRENT_WAITER_ACTOR_REQUIRED'; end if; if not exists(select 1 from public.pos_employees e where e.tenant_id=p_tenant_id and e.id=prior_waiter and e.is_active and crypt(p_command->>'currentWaiterPin',e.pin_hash)=e.pin_hash) then raise exception using errcode='42501',message='CURRENT_WAITER_PIN_INVALID'; end if; end if; end if;
  for item in select value from jsonb_array_elements(ls) loop qty:=(item->>'quantity')::numeric; if qty is null or qty<=0 or nullif(item->>'lineId','') is null then raise exception using errcode='22023',message='INVALID_LINE_ID_OR_QUANTITY'; end if; item_id:=pg_catalog.gen_random_uuid(); line_map:=jsonb_set(line_map,array[item->>'lineId'],to_jsonb(item_id::text),true); select * into mi from public.pos_menu_items where tenant_id=p_tenant_id and id=nullif(item->>'menuItemId','')::uuid and (branch_id=p_branch_id or branch_id is null) and is_available for update; submitted:=nullif(item->>'unitPrice','')::numeric; if found and (mi.tax_rate not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and mi.tax_rate<>0)) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; if not found then held:=true; line_state:='MISSING_ITEM'; current:=0; lsub:=0; lvat:=0; else current:=round(mi.price,5); if submitted is distinct from current or nullif(item->>'itemName','') is distinct from mi.name or nullif(item->>'taxRate','')::numeric is distinct from mi.tax_rate then held:=true; line_state:='PRICE_REVIEW'; end if; lsub:=round(qty*current,5); lvat:=round(lsub*mi.tax_rate,5); end if; if coalesce(item->>'resolutionState','')='VOIDED' then if nullif(item->>'voidReason','') is null then raise exception using errcode='22023',message='VOID_REASON_REQUIRED'; end if; lsub:=0; lvat:=0; end if; subtotal:=subtotal+lsub; vat:=vat+lvat; end loop;
  service:=round(subtotal*0.1000,5); total:=subtotal+vat+service; legacy_id:=oid; legacy_status:=case when held then 'OPEN' else 'OPEN' end; legacy_order_number:=coalesce(nullif(p_command->>'orderId',''),oid::text); perform public.pos_cash_v2_set_context('pos_orders',legacy_id,p_tenant_id,p_branch_id); insert into public.pos_orders(id,tenant_id,branch_id,table_id,cash_shift_id,order_number,status,service_type,opened_by,server_name,idempotency_key) values(legacy_id,p_tenant_id,p_branch_id,tid,null,legacy_order_number,legacy_status,'DINE_IN',p_actor_user_id,(select name from public.pos_employees where id=wid),p_idempotency_key) on conflict (id) do update set branch_id=excluded.branch_id,table_id=excluded.table_id,status=excluded.status,server_name=excluded.server_name; for item in select id from public.pos_order_items where tenant_id=p_tenant_id and order_id=legacy_id loop perform public.pos_cash_v2_set_context('pos_order_items',item.id,p_tenant_id,p_branch_id); end loop; delete from public.pos_order_items where tenant_id=p_tenant_id and order_id=legacy_id; for item in select value from jsonb_array_elements(ls) loop qty:=(item->>'quantity')::numeric; select * into mi from public.pos_menu_items where tenant_id=p_tenant_id and id=nullif(item->>'menuItemId','')::uuid and (branch_id=p_branch_id or branch_id is null) and is_available; if found and (mi.tax_rate not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and mi.tax_rate<>0)) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; current:=case when found then round(mi.price,2) else 0 end; item_id:=(line_map->>(item->>'lineId'))::uuid; perform public.pos_cash_v2_set_context('pos_order_items',item_id,p_tenant_id,p_branch_id); insert into public.pos_order_items(id,tenant_id,order_id,menu_item_id,name_snapshot,quantity,unit_price,tax_rate,modifiers,notes,station,kds_status) values(item_id,p_tenant_id,legacy_id,case when found then mi.id else null end,case when found then mi.name else coalesce(item->>'itemName','') end,qty,round(current,2),case when found then mi.tax_rate else 0 end,coalesce(item->'modifiers','[]'::jsonb),item->>'notes',case when found then mi.station else null end,'PENDING'); end loop; if old_tid is not null and old_tid is distinct from tid then perform public.pos_cash_v2_set_context('pos_tables',old_tid,p_tenant_id,p_branch_id); update public.pos_tables set status='AVAILABLE',updated_at=clock_timestamp() where id=old_tid and not exists(select 1 from public.pos_orders where tenant_id=p_tenant_id and table_id=old_tid and status in ('OPEN','SENT','IN_PREPARATION','READY','SERVED')); end if; perform public.pos_cash_v2_set_context('pos_tables',tid,p_tenant_id,p_branch_id); update public.pos_tables set status=case when held or total>0 then 'OCCUPIED' else 'AVAILABLE' end,updated_at=clock_timestamp() where id=tid;
  if order_exists and o.authorized_paid_amount=0 then update public.pos_cash_v2_orders set legacy_order_id=legacy_id,serving_session_id=s.id,table_id=tid,table_name_snapshot=coalesce(p_command->>'tableName',''),waiter_employee_id=wid,waiter_name_snapshot=(select name from public.pos_employees where id=wid),subtotal=subtotal,vat_total=vat,service_amount=service,total=total,status=case when held then 'HELD' else 'OPEN' end,balance_amount=greatest(total-authorized_paid_amount,0),updated_at=clock_timestamp() where id=oid returning * into o; elsif not order_exists then insert into public.pos_cash_v2_orders(id,tenant_id,branch_id,cash_register_id,business_date,legacy_order_id,table_id,table_name_snapshot,origin_session_id,serving_session_id,waiter_employee_id,waiter_name_snapshot,status,currency,tax_regime,price_basis,subtotal,vat_total,service_amount,total,authorized_paid_amount,balance_amount,captured_at) values(oid,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,legacy_id,tid,coalesce(p_command->>'tableName',''),s.id,s.id,wid,(select name from public.pos_employees where id=wid),case when held then 'HELD' else 'OPEN' end,f.currency,f.tax_regime,f.price_basis,subtotal,vat,service,total,0,total,coalesce((p_command->>'capturedAt')::timestamptz,clock_timestamp())) returning * into o; end if;
  delete from public.pos_cash_v2_order_lines where order_id=oid; for item in select value from jsonb_array_elements(ls) loop select * into mi from public.pos_menu_items where tenant_id=p_tenant_id and id=nullif(item->>'menuItemId','')::uuid and (branch_id=p_branch_id or branch_id is null) and is_available; if found and (mi.tax_rate not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and mi.tax_rate<>0)) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; qty:=(item->>'quantity')::numeric; current:=case when found then round(mi.price,5) else 0 end; lsub:=case when coalesce(item->>'resolutionState','')='VOIDED' then 0 else round(qty*current,5) end; lvat:=case when found and coalesce(item->>'resolutionState','')<>'VOIDED' then round(lsub*mi.tax_rate,5) else 0 end; insert into public.pos_cash_v2_order_lines(order_id,legacy_item_id,line_key,menu_item_id,item_name_snapshot,quantity,unit_price,tax_rate,resolution_state,void_reason,line_subtotal,line_vat,line_total) values(oid,(line_map->>(item->>'lineId'))::uuid,item->>'lineId',case when found then mi.id else null end,case when found then mi.name else coalesce(item->>'itemName','') end,qty,current,case when found then mi.tax_rate else 0 end,case when coalesce(item->>'resolutionState','')='VOIDED' then 'VOIDED' when found and current is not distinct from nullif(item->>'unitPrice','')::numeric and mi.name=coalesce(item->>'itemName','') and mi.tax_rate is not distinct from nullif(item->>'taxRate','')::numeric then 'VALID' when found then 'PRICE_REVIEW' else 'MISSING_ITEM' end,item->>'voidReason',lsub,lvat,lsub+lvat); end loop; perform public.pos_cash_v2_clear_context(); out:=jsonb_build_object('authority','SERVER','orderId',o.id,'legacyOrderId',legacy_id,'status',o.status,'currency',o.currency,'subtotal',o.subtotal,'vatTotal',o.vat_total,'serviceAmount',o.service_amount,'total',o.total,'authorizedPaidAmount',o.authorized_paid_amount,'balanceAmount',o.balance_amount,'priceReview',held); perform public.pos_cash_v2_audit(p_tenant_id,p_branch_id,p_actor_user_id,p_actor_employee_id,p_actor_role,'SYNC_ORDER','ORDER',o.id,p_idempotency_key,p_request_sha256,out); perform public.pos_cash_v2_finish_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'SYNC_ORDER',p_request_sha256,out); return out;
end $$;

create or replace function public.pos_cash_v2_capture_payment(p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text,p_idempotency_key text,p_request_sha256 text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; z jsonb; o public.pos_cash_v2_orders%rowtype; s public.pos_cash_v2_sessions%rowtype; p public.pos_cash_v2_payments%rowtype; method text:=p_command->>'method'; source numeric; rate numeric:=1; converted numeric; applied numeric; change numeric; source_curr text:=coalesce(p_command->>'sourceCurrency',p_command->>'currency'); target_curr text; fx jsonb:=p_command->'fx'; balance numeric; quantum numeric; out jsonb;
begin
  perform public.pos_cash_v2_assert_scope(p_command,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_idempotency_key,p_request_sha256); q:=public.pos_cash_v2_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'CAPTURE_PAYMENT',p_request_sha256); if q is not null then return q; end if; z:=public.pos_cash_v2_require_scope(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role); if p_actor_role not in ('OWNER','ADMIN','CAJERO') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if; if method is null or method not in('CASH','SINPE') then raise exception using errcode='22023',message='PAYMENT_METHOD_NOT_ALLOWED'; end if; if method='CASH' and coalesce(p_command->>'explicitCashConfirmation','false')<>'true' then raise exception using errcode='42501',message='CASH_REQUIRES_EXPLICIT_CONFIRMATION'; end if;
  select currency into target_curr from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=p_branch_id; source:=coalesce(nullif(p_command->>'sourceAmount','')::numeric,nullif(p_command->>'amount','')::numeric); if source is null or source<=0 or source_curr not in('CRC','USD') then raise exception using errcode='22023',message='INVALID_PAYMENT_AMOUNT'; end if; quantum:=case when source_curr='CRC' then 1 else .01 end; if mod(source,quantum)<>0 then raise exception using errcode='22023',message='INVALID_TENDER_MINOR_UNIT'; end if;
  if method='SINPE' and (source_curr<>target_curr or p_actor_role not in('ADMIN','CAJERO') or coalesce(p_command->>'explicitEvidenceConfirmation','false')<>'true' or coalesce(p_command->>'externalReference','')='') then raise exception using errcode='42501',message='SINPE_REQUIRES_SAME_CURRENCY_ADMIN_CAJERO_EVIDENCE'; end if;
  if source_curr<>target_curr then if method<>'CASH' or p_actor_role<>'CAJERO' or p_actor_employee_id is null or coalesce(fx->>'explicitConfirmation','false')<>'true' or fx->>'sourceCurrency'<>source_curr or fx->>'targetCurrency'<>target_curr then raise exception using errcode='42501',message='FX_REQUIRES_CAJERO_CONFIRMATION'; end if; rate:=(fx->>'rate')::numeric; if rate is null or rate<=0 then raise exception using errcode='22023',message='INVALID_FX_RATE'; end if; end if;
  select * into s from public.pos_cash_v2_sessions where id=nullif(p_command->>'receivingSessionId','')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date for update; if not found or s.status<>'OPEN' then raise exception using errcode='55000',message='RECEIVING_SESSION_NOT_OPEN'; end if; select * into o from public.pos_cash_v2_orders where id=nullif(p_command->>'orderId','')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id for update; if not found or o.status='HELD' then raise exception using errcode='55000',message='ORDER_NOT_PAYABLE'; end if;
  converted:=case when target_curr='CRC' then round(source*rate,0) else round(source*rate,2) end; balance:=o.balance_amount; quantum:=case when target_curr='CRC' then 1 else .01 end; applied:=least(converted,floor(balance/quantum)*quantum); change:=converted-applied; if applied<=0 or (method='SINPE' and change<>0) then raise exception using errcode='22023',message='PAYMENT_RESIDUAL_OR_CHANGE_NOT_ALLOWED'; end if;
  insert into public.pos_cash_v2_payments(tenant_id,branch_id,order_id,receiving_session_id,method,status,source_amount,source_currency,branch_currency,fx_rate,converted_amount,applied_amount,change_amount,actor_user_id,actor_employee_id,external_reference,idempotency_key) values(p_tenant_id,p_branch_id,o.id,s.id,method,'AUTHORIZED',source,source_curr,target_curr,rate,converted,applied,change,p_actor_user_id,p_actor_employee_id,nullif(p_command->>'externalReference',''),p_idempotency_key) returning * into p;
  if method='SINPE' then insert into public.pos_cash_v2_sinpe_evidence(payment_id,tenant_id,branch_id,external_reference,recorded_by_user_id,recorded_by_employee_id) values(p.id,p_tenant_id,p_branch_id,p.external_reference,p_actor_user_id,p_actor_employee_id); end if; update public.pos_cash_v2_orders set authorized_paid_amount=authorized_paid_amount+applied,balance_amount=greatest(balance_amount-applied,0),status=case when balance_amount-applied=0 then 'CLOSED' else status end,updated_at=clock_timestamp() where id=o.id; out:=jsonb_build_object('authority','SERVER','id',p.id,'orderId',p.order_id,'receivingSessionId',p.receiving_session_id,'method',p.method,'status',p.status,'sourceAmount',p.source_amount,'sourceCurrency',p.source_currency,'targetCurrency',p.branch_currency,'fxRate',p.fx_rate,'convertedAmount',p.converted_amount,'appliedAmount',p.applied_amount,'changeAmount',p.change_amount); perform public.pos_cash_v2_audit(p_tenant_id,p_branch_id,p_actor_user_id,p_actor_employee_id,p_actor_role,'CAPTURE_PAYMENT','PAYMENT',p.id,p_idempotency_key,p_request_sha256,out); perform public.pos_cash_v2_finish_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'CAPTURE_PAYMENT',p_request_sha256,out); return out;
end $$;

create or replace function public.pos_cash_v2_close_shift(p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text,p_idempotency_key text,p_request_sha256 text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; s public.pos_cash_v2_sessions%rowtype; counted numeric; cash numeric; sinpe numeric; applied_total numeric; expected numeric; quantum numeric; payment_ids jsonb; shid uuid; out jsonb;
begin
  perform public.pos_cash_v2_assert_scope(p_command,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_idempotency_key,p_request_sha256); q:=public.pos_cash_v2_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'CLOSE_SHIFT',p_request_sha256); if q is not null then return q; end if; perform public.pos_cash_v2_require_scope(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role); select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=p_branch_id; if p_actor_role not in ('OWNER','ADMIN','CAJERO') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if; select * into s from public.pos_cash_v2_sessions where id=nullif(p_command->>'sessionId','')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date and logical_shift=(p_command->>'logicalShift')::int for update; if not found or s.status<>'OPEN' then raise exception using errcode='55000',message='SESSION_NOT_OPEN'; end if;
  if (s.logical_shift=2 and (exists(select 1 from public.pos_cash_v2_orders where tenant_id=p_tenant_id and branch_id=p_branch_id and business_date=p_business_date and status in ('OPEN','HELD')) or exists(select 1 from public.pos_cash_v2_payments where tenant_id=p_tenant_id and branch_id=p_branch_id and status='PENDING' and exists(select 1 from public.pos_cash_v2_sessions ps where ps.id=receiving_session_id and ps.business_date=p_business_date)) or exists(select 1 from public.pos_payments lp join public.pos_orders lo on lo.id=lp.order_id and lo.tenant_id=lp.tenant_id where lp.tenant_id=p_tenant_id and lo.branch_id=p_branch_id and lp.status in ('PENDING','AUTHORIZED')))
     or exists(select 1 from public.pos_orders where tenant_id=p_tenant_id and branch_id=p_branch_id and status in ('OPEN','SENT','IN_PREPARATION','READY','SERVED'))
     or exists(select 1 from public.pos_tables where tenant_id=p_tenant_id and branch_id=p_branch_id and status in ('OCCUPIED','BUSY')))
     or (s.logical_shift=1 and (exists(select 1 from public.pos_cash_v2_orders where tenant_id=p_tenant_id and branch_id=p_branch_id and serving_session_id=s.id and status in ('OPEN','HELD')) or exists(select 1 from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=p_branch_id and t.status in ('OCCUPIED','BUSY') and exists(select 1 from public.pos_cash_v2_orders vo where vo.table_id=t.id and vo.serving_session_id=s.id and vo.status in ('OPEN','HELD'))))) then
    raise exception using errcode='55000',message=case when s.logical_shift=2 then 'T2_BRANCHWIDE_OPEN_ORDER_OCCUPIED_OR_PENDING' else 'T1_SESSION_OPEN_ORDER_OCCUPIED' end;
  end if;
  counted:=(p_command->>'countedCash')::numeric; quantum:=case when f.currency='CRC' then 1 else .01 end;
  if counted is null or counted<0 or mod(counted,quantum)<>0 then raise exception using errcode='22023',message='INVALID_COUNTED_CASH_MINOR_UNIT'; end if;
  if exists(select 1 from public.pos_cash_v2_payments p where p.receiving_session_id=s.id and (p.tenant_id is distinct from p_tenant_id or p.branch_id is distinct from p_branch_id or p.branch_currency is distinct from f.currency or exists(select 1 from public.pos_cash_v2_sessions ps where ps.id=p.receiving_session_id and (ps.tenant_id is distinct from p_tenant_id or ps.branch_id is distinct from p_branch_id or ps.business_date is distinct from p_business_date)))) then raise exception using errcode='55000',message='PAYMENT_SCOPE_OR_CURRENCY_MISMATCH'; end if;
  select coalesce(sum(p.applied_amount) filter(where p.method='CASH'),0),coalesce(sum(p.applied_amount) filter(where p.method='SINPE'),0),coalesce(sum(p.applied_amount),0),coalesce(jsonb_agg(to_jsonb(p.id) order by p.authorized_at),'[]'::jsonb) into cash,sinpe,applied_total,payment_ids from public.pos_cash_v2_payments p where p.receiving_session_id=s.id and p.status='AUTHORIZED';
  expected:=s.opening_float+cash;
  insert into public.pos_cash_v2_snapshots(tenant_id,branch_id,cash_register_id,business_date,coverage,snapshot_kind,captured_by,payload) values(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,'REGISTER','SESSION',p_actor_user_id,jsonb_build_object('session',to_jsonb(s),'payments',jsonb_build_object('cashApplied',cash,'sinpeApplied',sinpe,'totalApplied',applied_total,'paymentIds',payment_ids),'cashSales',cash));
  perform public.pos_cash_v2_set_context('pos_cash_shifts',s.pos_cash_shift_id,p_tenant_id,p_branch_id); update public.pos_cash_shifts set status='CLOSED',closed_by=p_actor_user_id,closed_at=clock_timestamp(),counted_cash=round(counted,2),expected_cash=round(expected,2),difference=round(counted-expected,2) where id=s.pos_cash_shift_id; update public.pos_cash_v2_sessions set status='CLOSED',closed_at=clock_timestamp(),counted_cash=counted,closed_by_user_id=p_actor_user_id,closed_by_employee_id=p_actor_employee_id where id=s.id returning * into s; perform public.pos_cash_v2_clear_context(); insert into public.pos_cash_v2_closures(tenant_id,branch_id,cash_register_id,business_date,session_id,closed_by_user_id,closed_by_employee_id,counted_cash,expected_cash,difference,summary) values(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,s.id,p_actor_user_id,p_actor_employee_id,counted,expected,counted-expected,jsonb_build_object('cashSales',cash,'sinpeApplied',sinpe,'totalApplied',applied_total,'paymentIds',payment_ids,'openingFloat',s.opening_float)); out:=jsonb_build_object('sessionId',s.id,'posCashShiftId',s.pos_cash_shift_id,'logicalShift',s.logical_shift,'status','CLOSED','openingFloat',s.opening_float,'countedCash',counted,'expectedCash',expected,'difference',counted-expected,'cashApplied',cash,'sinpeApplied',sinpe,'totalApplied',applied_total,'paymentIds',payment_ids,'closedAt',s.closed_at); perform public.pos_cash_v2_audit(p_tenant_id,p_branch_id,p_actor_user_id,p_actor_employee_id,p_actor_role,'CLOSE_SHIFT','SESSION',s.id,p_idempotency_key,p_request_sha256,out); perform public.pos_cash_v2_finish_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'CLOSE_SHIFT',p_request_sha256,out); return out;
end $$;

create or replace function public.pos_close_daily_cash_v2_aware(p_tenant_id uuid,p_cash_register_id uuid,p_business_date date,p_closed_by uuid,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  b public.pos_branches%rowtype; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; r public.pos_cash_registers%rowtype;
  o public.pos_daily_cash_openings%rowtype; c public.pos_daily_cash_closures%rowtype; ss public.pos_cash_v2_sessions%rowtype;
  v_register_ids uuid[]; v_session_ids uuid[]; v_expected_session_ids uuid[]; v_t1_session_ids uuid[]; v_t2_session_ids uuid[];
  v_handoff_snapshot_ids uuid[]; v_target_session_ids uuid[]; v_payment_ids uuid[];
  v_cash numeric(18,5); v_sinpe numeric(18,5); v_total numeric(18,5); v_expected_cash numeric(18,5);
  v_session_reconciliations jsonb; v_branch_payments jsonb; payload jsonb;
  snapid uuid:=pg_catalog.gen_random_uuid(); closureid uuid:=pg_catalog.gen_random_uuid();
begin
  perform public.pos_cash_v2_require_scope(p_tenant_id,(select branch_id from public.pos_cash_registers where tenant_id=p_tenant_id and id=p_cash_register_id),p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role);
  select * into b from public.pos_branches where tenant_id=p_tenant_id and id=(select branch_id from public.pos_cash_registers where tenant_id=p_tenant_id and id=p_cash_register_id) and is_active for update;
  if not found then raise exception using errcode='P0002',message='BRANCH_NOT_AVAILABLE'; end if;
  select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=b.id;
  if not found then raise exception using errcode='55000',message='FISCAL_PROFILE_MISSING'; end if;
  select * into r from public.pos_cash_registers where tenant_id=p_tenant_id and id=p_cash_register_id and branch_id=b.id and is_active for update;
  if not found then raise exception using errcode='P0002',message='REGISTER_NOT_AVAILABLE'; end if;
  perform rr.id from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=b.id and rr.is_active order by rr.id for update;
  select coalesce(array_agg(rr.id order by rr.id),'{}'::uuid[]) into v_register_ids from public.pos_cash_registers rr where rr.tenant_id=p_tenant_id and rr.branch_id=b.id and rr.is_active;
  if cardinality(v_register_ids)=0 or not (r.id=any(v_register_ids)) then raise exception using errcode='55000',message='ACTIVE_REGISTER_ROSTER_EMPTY_OR_INVALID'; end if;
  perform sx.id from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date order by sx.cash_register_id,sx.logical_shift,sx.id for update;
  select coalesce(array_agg(sx.id order by sx.cash_register_id,sx.logical_shift,sx.id),'{}'::uuid[]) into v_session_ids from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date;
  select coalesce(array_agg(sx.id order by sx.cash_register_id,sx.logical_shift,sx.id),'{}'::uuid[]) into v_expected_session_ids from public.pos_cash_registers rr join public.pos_cash_v2_sessions sx on sx.tenant_id=rr.tenant_id and sx.branch_id=rr.branch_id and sx.cash_register_id=rr.id and sx.business_date=p_business_date and sx.logical_shift in (1,2) where rr.tenant_id=p_tenant_id and rr.branch_id=b.id and rr.is_active;
  select coalesce(array_agg(sx.id order by sx.cash_register_id,sx.id),'{}'::uuid[]) into v_t1_session_ids from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date and sx.logical_shift=1;
  select coalesce(array_agg(sx.id order by sx.cash_register_id,sx.id),'{}'::uuid[]) into v_t2_session_ids from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date and sx.logical_shift=2;
  if v_session_ids is distinct from v_expected_session_ids or cardinality(v_expected_session_ids)<>2*cardinality(v_register_ids) or exists(select 1 from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date and not (sx.cash_register_id=any(v_register_ids))) or exists(select 1 from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=p_business_date and (sx.status<>'CLOSED' or sx.counted_cash is null)) then raise exception using errcode='55000',message='BRANCH_REGISTER_SESSION_SET_MISMATCH'; end if;
  if cardinality(v_t1_session_ids)<>cardinality(v_register_ids) or cardinality(v_t2_session_ids)<>cardinality(v_register_ids) then raise exception using errcode='55000',message='BOTH_SESSIONS_REQUIRED_FOR_EVERY_ACTIVE_REGISTER'; end if;
  select coalesce(array_agg(hs.id order by rr.id),'{}'::uuid[]) into v_handoff_snapshot_ids
  from public.pos_cash_registers rr
  join public.pos_cash_v2_sessions t1 on t1.tenant_id=rr.tenant_id and t1.branch_id=rr.branch_id and t1.cash_register_id=rr.id and t1.business_date=p_business_date and t1.logical_shift=1 and t1.status='CLOSED'
  join public.pos_cash_v2_sessions t2 on t2.tenant_id=rr.tenant_id and t2.branch_id=rr.branch_id and t2.cash_register_id=rr.id and t2.business_date=p_business_date and t2.logical_shift=2 and t2.status='CLOSED'
  join lateral (select h.id from public.pos_cash_v2_snapshots h where h.tenant_id=p_tenant_id and h.branch_id=b.id and h.business_date=p_business_date and h.cash_register_id=rr.id and h.coverage='T1_TO_T2_HANDOFF' and h.snapshot_kind='T1_HANDOFF' and h.required_register_ids=v_register_ids and h.covered_session_ids @> v_t1_session_ids and h.covered_session_ids @> array[t2.id]::uuid[] and h.payload->'activeRegisterIds'=to_jsonb(v_register_ids) and h.payload->'t1SessionIds'=to_jsonb(v_t1_session_ids) and h.payload->>'targetT1SessionId'=t1.id::text and h.payload->>'targetT2SessionId'=t2.id::text and not exists(select 1 from unnest(h.covered_session_ids) csid where not (csid=any(v_session_ids))) order by h.captured_at desc,h.id desc limit 1) hs on true
  where rr.tenant_id=p_tenant_id and rr.branch_id=b.id and rr.is_active;
  if cardinality(v_handoff_snapshot_ids)<>cardinality(v_register_ids) then raise exception using errcode='55000',message='T1_T2_HANDOFF_SNAPSHOT_ROSTER_MISMATCH'; end if;

  select * into o from public.pos_daily_cash_openings where tenant_id=p_tenant_id and branch_id=b.id and cash_register_id=r.id and business_date=p_business_date for update;
  if not found or o.opened_by is distinct from p_closed_by or coalesce(p_actor_employee_id,p_actor_user_id) is distinct from p_closed_by then raise exception using errcode='42501',message='DAILY_OPENING_OWNER_OR_DATE_REQUIRED'; end if;
  if exists(select 1 from public.pos_daily_cash_closures where tenant_id=p_tenant_id and branch_id=b.id and cash_register_id=r.id and business_date=o.business_date) then raise exception using errcode='55000',message='DAILY_CASH_CLOSED'; end if;

  -- Lock all closing evidence in the canonical order after branch/register/session.
  perform vo.id from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=b.id and vo.business_date=o.business_date and vo.status in ('OPEN','HELD') order by vo.id for update;
  perform t.id from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=b.id and (t.status in ('OCCUPIED','BUSY','PRE_CHECK') or exists(select 1 from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=b.id and vo.business_date=o.business_date and vo.table_id=t.id and vo.status in ('OPEN','HELD'))) order by t.id for update;
  perform ol.id from public.pos_cash_v2_order_lines ol join public.pos_cash_v2_orders vo on vo.id=ol.order_id where vo.tenant_id=p_tenant_id and vo.branch_id=b.id and vo.business_date=o.business_date and vo.status in ('OPEN','HELD') order by ol.order_id,ol.id for update of ol;
  perform p.id from public.pos_cash_v2_payments p where p.tenant_id=p_tenant_id and p.branch_id=b.id and p.receiving_session_id=any(v_session_ids) order by p.id for update;
  if exists(select 1 from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=b.id and vo.business_date=o.business_date and vo.status in ('OPEN','HELD')) then raise exception using errcode='55000',message='OPEN_OR_HELD_V2_ORDER'; end if;
  if exists(select 1 from public.pos_tables t where t.tenant_id=p_tenant_id and t.branch_id=b.id and t.status in ('OCCUPIED','BUSY','PRE_CHECK') and not exists(select 1 from public.pos_cash_v2_orders vo where vo.tenant_id=p_tenant_id and vo.branch_id=b.id and vo.business_date=o.business_date and vo.table_id=t.id and vo.status='OPEN')) then raise exception using errcode='55000',message='ORPHAN_OCCUPIED_TABLE'; end if;
  if exists(select 1 from public.pos_orders lo where lo.tenant_id=p_tenant_id and lo.branch_id=b.id and lo.status in ('OPEN','SENT','IN_PREPARATION','READY','SERVED')) then raise exception using errcode='55000',message='UNRESOLVED_LEGACY_OPEN_ORDER'; end if;
  if exists(select 1 from public.pos_cash_v2_payments p left join public.pos_cash_v2_sessions rs on rs.id=p.receiving_session_id where p.tenant_id=p_tenant_id and p.branch_id=b.id and (rs.id is null or rs.tenant_id is distinct from p_tenant_id or rs.branch_id is distinct from b.id or rs.business_date is distinct from o.business_date or not (rs.cash_register_id=any(v_register_ids)) or p.branch_currency is distinct from f.currency or p.status in ('PENDING','REFUNDED') or (p.status='AUTHORIZED' and p.method='SINPE' and not exists(select 1 from public.pos_cash_v2_sinpe_evidence se where se.payment_id=p.id and se.tenant_id=p.tenant_id and se.branch_id=p.branch_id and se.append_only)))) then raise exception using errcode='55000',message='PAYMENT_SCOPE_CURRENCY_OR_EVIDENCE_UNVERIFIABLE'; end if;
  if exists(select 1 from public.pos_payments lp join public.pos_orders lo on lo.id=lp.order_id and lo.tenant_id=lp.tenant_id where lp.tenant_id=p_tenant_id and lo.branch_id=b.id and lp.status in ('PENDING','AUTHORIZED')) or exists(select 1 from public.pos_payments lp where lp.tenant_id=p_tenant_id and not exists(select 1 from public.pos_orders lo where lo.id=lp.order_id and lo.tenant_id=lp.tenant_id)) then raise exception using errcode='55000',message='UNRESOLVED_LEGACY_PAYMENT'; end if;

  select coalesce(array_agg(sx.id order by sx.id),'{}'::uuid[]) into v_target_session_ids from public.pos_cash_v2_sessions sx where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.cash_register_id=r.id and sx.business_date=o.business_date and sx.logical_shift in (1,2);
  select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]),coalesce(sum(p.applied_amount) filter(where p.method='CASH'),0),coalesce(sum(p.applied_amount) filter(where p.method='SINPE'),0),coalesce(sum(p.applied_amount),0) into v_payment_ids,v_cash,v_sinpe,v_total from public.pos_cash_v2_payments p where p.tenant_id=p_tenant_id and p.branch_id=b.id and p.receiving_session_id=any(v_target_session_ids) and p.status='AUTHORIZED';
  select sx.opening_float+coalesce(sum(p.applied_amount) filter(where p.method='CASH'),0) into v_expected_cash from public.pos_cash_v2_sessions sx left join public.pos_cash_v2_payments p on p.receiving_session_id=sx.id and p.tenant_id=p_tenant_id and p.branch_id=b.id and p.status='AUTHORIZED' where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.cash_register_id=r.id and sx.business_date=o.business_date and sx.logical_shift=2 group by sx.id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.cash_register_id,x.logical_shift),'[]'::jsonb) into v_session_reconciliations from (select sx.id as session_id,sx.cash_register_id,sx.logical_shift,sx.business_date,sx.opening_float,sx.counted_cash,f.currency as branch_currency,coalesce(sum(p.applied_amount) filter(where p.method='CASH'),0) as cash_applied_amount,coalesce(sum(p.applied_amount) filter(where p.method='SINPE'),0) as sinpe_applied_amount,coalesce(sum(p.applied_amount),0) as total_collected_amount,sx.opening_float+coalesce(sum(p.applied_amount) filter(where p.method='CASH'),0) as expected_cash_amount,coalesce(array_agg(p.id order by p.id) filter(where p.status='AUTHORIZED'),'{}'::uuid[]) as countable_payment_ids from public.pos_cash_v2_sessions sx left join public.pos_cash_v2_payments p on p.receiving_session_id=sx.id and p.tenant_id=p_tenant_id and p.branch_id=b.id and p.status='AUTHORIZED' where sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=o.business_date group by sx.id,sx.cash_register_id,sx.logical_shift,sx.business_date,sx.opening_float,sx.counted_cash order by sx.cash_register_id,sx.logical_shift) x;
  select coalesce(jsonb_agg(jsonb_build_object('payment',to_jsonb(p),'receivingSession',to_jsonb(sx)) order by p.authorized_at,p.id),'[]'::jsonb) into v_branch_payments from public.pos_cash_v2_payments p join public.pos_cash_v2_sessions sx on sx.id=p.receiving_session_id where p.tenant_id=p_tenant_id and p.branch_id=b.id and sx.tenant_id=p_tenant_id and sx.branch_id=b.id and sx.business_date=o.business_date and p.status='AUTHORIZED';
  payload:=jsonb_build_object('authority','SERVER','openingId',o.id,'openingBusinessDate',o.business_date,'openedBy',o.opened_by,'activeRequiredRegisterIds',to_jsonb(v_register_ids),'branchRegisterIds',to_jsonb(v_register_ids),'branchSessionIds',to_jsonb(v_session_ids),'expectedSessionIds',to_jsonb(v_expected_session_ids),'coveredSessionIds',to_jsonb(v_session_ids),'t1SessionIds',to_jsonb(v_t1_session_ids),'t2SessionIds',to_jsonb(v_t2_session_ids),'t1T2HandoffSnapshotIds',to_jsonb(v_handoff_snapshot_ids),'registerSetEqualsSnapshot',true,'sessionSetEqualsExpected',true,'coverage','COMPLETE_BRANCH_BUSINESS_DATE','completeBranchBusinessDate',true,'sessionReconciliations',v_session_reconciliations,'cashAppliedAmount',v_cash,'sinpeAppliedAmount',v_sinpe,'totalCollectedAmount',v_total,'expectedCashAmount',v_expected_cash,'countablePaymentIds',to_jsonb(v_payment_ids),'openOrders','[]'::jsonb,'occupiedTables','[]'::jsonb,'payments',v_branch_payments,'capturedAt',clock_timestamp());
  insert into public.pos_cash_v2_snapshots(id,tenant_id,branch_id,cash_register_id,business_date,coverage,snapshot_kind,required_register_ids,covered_session_ids,captured_by,payload) values(snapid,p_tenant_id,b.id,r.id,o.business_date,'COMPLETE_BRANCH_BUSINESS_DATE','DAILY',v_register_ids,v_session_ids,p_actor_user_id,payload);
  perform public.pos_cash_v2_set_context('pos_daily_cash_closures',closureid,p_tenant_id,b.id);
  insert into public.pos_daily_cash_closures(id,tenant_id,branch_id,cash_register_id,business_date,timezone,closed_by,summary) values(closureid,p_tenant_id,b.id,r.id,o.business_date,b.timezone,p_closed_by,payload) returning * into c;
  perform public.pos_cash_v2_clear_context();
  perform public.pos_cash_v2_audit(p_tenant_id,b.id,p_actor_user_id,p_actor_employee_id,p_actor_role,'CLOSE_DAILY','DAILY_CLOSURE',c.id,'daily-close',encode(digest(payload::text,'sha256'),'hex'),payload);
  return jsonb_build_object('closureId',c.id,'cashRegisterId',r.id,'businessDate',o.business_date,'closedAt',c.closed_at,'timezone',b.timezone,'summary',payload,'alreadyClosed',false);
end $$;


create or replace function public.pos_cash_v2_resolve_held_line(p_tenant_id uuid,p_branch_id uuid,p_cash_register_id uuid,p_business_date date,p_actor_user_id uuid,p_actor_employee_id uuid,p_actor_role text,p_idempotency_key text,p_request_sha256 text,p_command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q jsonb; z jsonb; f public.pos_cash_v2_branch_fiscal_profiles%rowtype; o public.pos_cash_v2_orders%rowtype; l public.pos_cash_v2_order_lines%rowtype; mi public.pos_menu_items%rowtype; resolution text:=p_command->>'resolution'; linked uuid:=nullif(p_command->>'linkedMenuItemId','')::uuid; reason text:=nullif(p_command->>'reason',''); subtotal numeric; vat numeric; service numeric; total numeric; out jsonb;
begin
 perform public.pos_cash_v2_assert_scope(p_command,p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_idempotency_key,p_request_sha256); q:=public.pos_cash_v2_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'HELD_LINE_RESOLUTION',p_request_sha256); if q is not null then return q; end if; perform public.pos_cash_v2_require_scope(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role); select * into f from public.pos_cash_v2_branch_fiscal_profiles where tenant_id=p_tenant_id and branch_id=p_branch_id; if not found then raise exception using errcode='55000',message='FISCAL_PROFILE_MISSING'; end if; if p_actor_role not in ('ADMIN','CAJERO') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if; perform 1 from public.pos_cash_v2_sessions where tenant_id=p_tenant_id and branch_id=p_branch_id and cash_register_id=p_cash_register_id and business_date=p_business_date order by id for update; select * into o from public.pos_cash_v2_orders where id=nullif(p_command->>'orderId','')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id for update; if not found then raise exception using errcode='P0002',message='ORDER_NOT_FOUND'; end if; select * into l from public.pos_cash_v2_order_lines where order_id=o.id and id=nullif(p_command->>'lineId','')::uuid for update; if not found then raise exception using errcode='P0002',message='HELD_LINE_NOT_FOUND'; end if; if l.legacy_item_id is null then raise exception using errcode='55000',message='HELD_LEGACY_ITEM_MAPPING_REQUIRED'; end if; perform public.pos_cash_v2_set_context('pos_order_items',l.legacy_item_id,p_tenant_id,p_branch_id); perform public.pos_cash_v2_set_context('pos_orders',o.legacy_order_id,p_tenant_id,p_branch_id); perform public.pos_cash_v2_set_context('pos_tables',o.table_id,p_tenant_id,p_branch_id); if resolution='ADOPT_CURRENT_PRICE' then if coalesce(p_command->>'explicitConfirmation','false')<>'true' then raise exception using errcode='42501',message='EXPLICIT_PRICE_CONFIRMATION_REQUIRED'; end if; select * into mi from public.pos_menu_items where tenant_id=p_tenant_id and id=l.menu_item_id and (branch_id=p_branch_id or branch_id is null) and is_available for update; if not found then raise exception using errcode='23503',message='MENU_ITEM_BRANCH_MISMATCH'; end if; if mi.tax_rate not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and mi.tax_rate<>0) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; update public.pos_cash_v2_order_lines set unit_price=round(mi.price,5),item_name_snapshot=mi.name,tax_rate=mi.tax_rate,resolution_state='VALID',line_subtotal=round(quantity*mi.price,5),line_vat=round(round(quantity*mi.price,5)*mi.tax_rate,5),line_total=round(quantity*mi.price,5)+round(round(quantity*mi.price,5)*mi.tax_rate,5),void_reason=null where id=l.id; elsif resolution='LINK_ITEM' then if linked is null then raise exception using errcode='22023',message='LINKED_MENU_ITEM_REQUIRED'; end if; select * into mi from public.pos_menu_items where tenant_id=p_tenant_id and id=linked and (branch_id=p_branch_id or branch_id is null) and is_available for update; if not found then raise exception using errcode='23503',message='MENU_ITEM_BRANCH_MISMATCH'; end if; if mi.tax_rate not in (0.0000,0.0100,0.0200,0.0400,0.1300) or (f.tax_regime='IVA_0' and mi.tax_rate<>0) then raise exception using errcode='22023',message='ITEM_TAX_RATE_PROFILE_MISMATCH'; end if; update public.pos_cash_v2_order_lines set menu_item_id=mi.id,unit_price=round(mi.price,5),item_name_snapshot=mi.name,tax_rate=mi.tax_rate,resolution_state='VALID',line_subtotal=round(quantity*mi.price,5),line_vat=round(round(quantity*mi.price,5)*mi.tax_rate,5),line_total=round(quantity*mi.price,5)+round(round(quantity*mi.price,5)*mi.tax_rate,5),void_reason=null where id=l.id; elsif resolution='VOID' then if reason is null or length(btrim(reason))=0 then raise exception using errcode='22023',message='VOID_REASON_REQUIRED'; end if; update public.pos_cash_v2_order_lines set resolution_state='VOIDED',void_reason=reason,line_subtotal=0,line_vat=0,line_total=0 where id=l.id; else raise exception using errcode='22023',message='INVALID_HELD_RESOLUTION'; end if; perform public.pos_cash_v2_set_context('pos_order_items',l.legacy_item_id,p_tenant_id,p_branch_id); update public.pos_order_items i set menu_item_id=case when resolution='VOID' then null else x.menu_item_id end,name_snapshot=x.item_name_snapshot,quantity=x.quantity,unit_price=case when resolution='VOID' then 0 else round(x.unit_price,2) end,tax_rate=case when resolution='VOID' then 0 else x.tax_rate end from public.pos_cash_v2_order_lines x where x.id=l.id and i.id=x.legacy_item_id and i.tenant_id=p_tenant_id; if not found then raise exception using errcode='55000',message='HELD_LEGACY_ITEM_UPDATE_REQUIRED'; end if; perform public.pos_cash_v2_set_context('pos_orders',o.legacy_order_id,p_tenant_id,p_branch_id); update public.pos_orders set status='OPEN' where id=o.legacy_order_id and tenant_id=p_tenant_id; perform public.pos_cash_v2_set_context('pos_tables',o.table_id,p_tenant_id,p_branch_id); update public.pos_tables set status='OCCUPIED',updated_at=clock_timestamp() where id=o.table_id and tenant_id=p_tenant_id and branch_id=p_branch_id; select coalesce(sum(line_subtotal),0),coalesce(sum(line_vat),0) into subtotal,vat from public.pos_cash_v2_order_lines where order_id=o.id and resolution_state<>'VOIDED'; service:=round(subtotal*0.1000,5); total:=subtotal+vat+service; if o.authorized_paid_amount>0 then raise exception using errcode='55000',message='ORDER_HAS_AUTHORIZED_PAYMENTS'; end if; update public.pos_cash_v2_orders set subtotal=subtotal,vat_total=vat,service_amount=service,total=total,balance_amount=greatest(total-authorized_paid_amount,0),status=case when exists(select 1 from public.pos_cash_v2_order_lines where order_id=o.id and resolution_state in ('PRICE_REVIEW','MISSING_ITEM')) then 'HELD' else 'OPEN' end,updated_at=clock_timestamp() where id=o.id returning * into o; out:=jsonb_build_object('authority','SERVER','orderId',o.id,'lineId',l.id,'resolution',resolution,'status',o.status,'total',o.total); perform public.pos_cash_v2_audit(p_tenant_id,p_branch_id,p_actor_user_id,p_actor_employee_id,p_actor_role,'HELD_LINE_RESOLUTION','ORDER_LINE',l.id,p_idempotency_key,p_request_sha256,jsonb_build_object('resolution',resolution,'reason',reason)); perform public.pos_cash_v2_finish_idempotent(p_tenant_id,p_branch_id,p_cash_register_id,p_business_date,p_actor_user_id,p_actor_employee_id,p_actor_role,p_idempotency_key,'HELD_LINE_RESOLUTION',p_request_sha256,out); return out;
end $$;

-- Only the five public RPCs are executable by service_role. Helpers/context are private.
do $$ begin
  revoke all on function public.pos_cash_v2_open_shift(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_sync_order(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_capture_payment(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_close_shift(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_resolve_held_line(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_close_daily_cash_v2_aware(uuid,uuid,date,uuid,uuid,uuid,text) from public,anon,authenticated; grant execute on function public.pos_cash_v2_open_shift(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_sync_order(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_capture_payment(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_close_shift(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_cash_v2_resolve_held_line(uuid,uuid,uuid,date,uuid,uuid,text,text,text,jsonb),public.pos_close_daily_cash_v2_aware(uuid,uuid,date,uuid,uuid,uuid,text) to service_role;
  revoke all on function public.pos_cash_v2_assert_scope(jsonb,uuid,uuid,uuid,date,text,text),public.pos_cash_v2_require_scope(uuid,uuid,uuid,date,uuid,uuid,text),public.pos_cash_v2_idempotent(uuid,uuid,uuid,date,uuid,uuid,text,text,text,text),public.pos_cash_v2_finish_idempotent(uuid,uuid,uuid,date,uuid,uuid,text,text,text,text,jsonb),public.pos_cash_v2_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb),public.pos_cash_v2_t1_handoff_snapshot(uuid,uuid,uuid,date,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
end $$;

comment on table public.pos_cash_v2_private_context is 'Private txid-bound context; never a GUC and never directly writable by service_role.';
comment on function public.pos_close_daily_cash_v2_aware(uuid,uuid,date,uuid,uuid,uuid,text) is 'Self-contained branch-first daily close; preserves original opening identity/date and requires both T1/T2 closed.';

-- NOT READY FOR APPLY: falta verificación en runtime/clon compatible de PostgreSQL y completar la integración real de UI/Hacienda/pagos/transferencias legacy; también se requiere un flujo administrativo auditado para configurar perfiles/membresías y activar V2 tras quiescer writers legacy. Los guards de padrón impiden desactivar/revocar saloneros con órdenes V2 abiertas. El mapeo legacy de nuevas líneas existe mediante legacy_item_id. V2 permanece OFF; no aplicar.

commit;
