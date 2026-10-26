-- SaborAI POS - Fase A: base central multi-caja y multidispositivo
-- Migración aditiva e idempotente.
--
-- Objetivo:
--   * Mantener pos_cash_registers y pos_cash_shifts como fuente central.
--   * Registrar qué dispositivo opera cada caja mediante pos_terminals.
--   * Preparar sincronización Realtime y RLS por tenant.
--
-- Importante:
--   * No migra todavía localStorage. Eso corresponde a la Fase B/C.
--   * No elimina ni transforma datos fiscales o históricos.

create extension if not exists pgcrypto;

-- La Fase A amplía el núcleo creado por la migración 20261017000000_pos_core.
-- Fallar aquí con una instrucción clara evita un error posterior menos útil.
do $$
begin
  if to_regclass('public.pos_branches') is null
     or to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null then
    raise exception using
      errcode = '42P01',
      message = 'Falta la migración base 20261017000000_pos_core.sql. Ejecuta primero el núcleo POS y luego esta Fase A.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Cajas: completar la configuración que hoy vive en el navegador
-- -----------------------------------------------------------------------------
alter table if exists public.pos_cash_registers
  add column if not exists is_default boolean not null default false,
  add column if not exists linked_zones jsonb not null default '[]'::jsonb,
  add column if not exists assigned_printer_id uuid,
  add column if not exists notes text;

-- La configuración de salones debe ser siempre una lista JSON válida.
update public.pos_cash_registers
set linked_zones = '[]'::jsonb
where linked_zones is null
   or jsonb_typeof(linked_zones) <> 'array';

alter table if exists public.pos_cash_registers
  drop constraint if exists pos_cash_registers_linked_zones_array_ck;
alter table if exists public.pos_cash_registers
  add constraint pos_cash_registers_linked_zones_array_ck
  check (jsonb_typeof(linked_zones) = 'array');

-- Solo una caja predeterminada activa por tenant y sucursal.
create unique index if not exists pos_one_default_register_per_branch
  on public.pos_cash_registers(tenant_id, branch_id)
  where is_default = true and is_active = true;

create index if not exists pos_cash_registers_tenant_branch_idx
  on public.pos_cash_registers(tenant_id, branch_id, is_active);

create index if not exists pos_cash_registers_tenant_updated_idx
  on public.pos_cash_registers(tenant_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- 2. Turnos: conservar participantes, movimientos, arqueo y resumen central
-- -----------------------------------------------------------------------------
alter table if exists public.pos_cash_shifts
  add column if not exists shift_number bigint,
  add column if not exists participants jsonb not null default '[]'::jsonb,
  add column if not exists movements jsonb not null default '[]'::jsonb,
  add column if not exists system_summary jsonb not null default '{}'::jsonb,
  add column if not exists cash_breakdown jsonb,
  add column if not exists counted_cards numeric(14,2),
  add column if not exists dataphones_breakdown jsonb,
  add column if not exists counted_sinpe numeric(14,2),
  add column if not exists difference_reason text,
  add column if not exists z_report_generated boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Rellenamos de forma determinista los históricos que aún no tienen número.
with numbered as (
  select id,
         row_number() over (
           partition by tenant_id, branch_id, cash_register_id
           order by opened_at asc, created_at asc, id asc
         )::bigint as rn
  from public.pos_cash_shifts
  where shift_number is null
)
update public.pos_cash_shifts s
set shift_number = n.rn
from numbered n
where s.id = n.id
  and s.shift_number is null;

alter table if exists public.pos_cash_shifts
  drop constraint if exists pos_cash_shifts_participants_array_ck;
alter table if exists public.pos_cash_shifts
  add constraint pos_cash_shifts_participants_array_ck
  check (jsonb_typeof(participants) = 'array');

alter table if exists public.pos_cash_shifts
  drop constraint if exists pos_cash_shifts_movements_array_ck;
alter table if exists public.pos_cash_shifts
  add constraint pos_cash_shifts_movements_array_ck
  check (jsonb_typeof(movements) = 'array');

create index if not exists pos_cash_shifts_tenant_register_status_idx
  on public.pos_cash_shifts(tenant_id, cash_register_id, status, opened_at desc);

create index if not exists pos_cash_shifts_tenant_updated_idx
  on public.pos_cash_shifts(tenant_id, updated_at desc);

create unique index if not exists pos_one_open_shift_per_register
  on public.pos_cash_shifts(cash_register_id)
  where status = 'OPEN';

-- -----------------------------------------------------------------------------
-- 3. Terminales/dispositivos: una caja activa por dispositivo y viceversa
-- -----------------------------------------------------------------------------
create table if not exists public.pos_terminals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null references public.pos_branches(id) on delete restrict,
  cash_register_id uuid not null references public.pos_cash_registers(id) on delete restrict,
  device_key text not null,
  device_name text,
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, device_key)
);

-- Una caja no se asigna simultáneamente a dos terminales activas.
create unique index if not exists pos_one_active_terminal_per_register
  on public.pos_terminals(tenant_id, cash_register_id)
  where is_active = true;

create index if not exists pos_terminals_tenant_branch_idx
  on public.pos_terminals(tenant_id, branch_id, is_active);

create index if not exists pos_terminals_last_seen_idx
  on public.pos_terminals(tenant_id, last_seen_at desc);

alter table public.pos_terminals
  drop constraint if exists pos_terminals_device_key_ck;
alter table public.pos_terminals
  add constraint pos_terminals_device_key_ck
  check (length(btrim(device_key)) between 16 and 200);

-- -----------------------------------------------------------------------------
-- 4. Integridad tenant/sucursal entre entidades relacionadas
-- -----------------------------------------------------------------------------
create or replace function public.validate_cash_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  register_tenant uuid;
  register_branch uuid;
  branch_tenant uuid;
begin
  select r.tenant_id, r.branch_id
    into register_tenant, register_branch
  from public.pos_cash_registers r
  where r.id = new.cash_register_id;

  select b.tenant_id
    into branch_tenant
  from public.pos_branches b
  where b.id = new.branch_id;

  if register_tenant is null or register_branch is null then
    raise exception 'La caja indicada no existe';
  end if;

  if new.tenant_id <> register_tenant
     or new.branch_id <> register_branch
     or branch_tenant is distinct from new.tenant_id then
    raise exception 'La caja, sucursal y tenant no coinciden';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_cash_scope() from public;

drop trigger if exists pos_cash_shifts_validate_scope on public.pos_cash_shifts;
create trigger pos_cash_shifts_validate_scope
before insert or update of tenant_id, branch_id, cash_register_id
on public.pos_cash_shifts
for each row execute function public.validate_cash_scope();

create or replace function public.validate_terminal_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  register_tenant uuid;
  register_branch uuid;
  branch_tenant uuid;
begin
  select r.tenant_id, r.branch_id
    into register_tenant, register_branch
  from public.pos_cash_registers r
  where r.id = new.cash_register_id;

  select b.tenant_id
    into branch_tenant
  from public.pos_branches b
  where b.id = new.branch_id;

  if register_tenant is null or register_branch is null then
    raise exception 'La caja indicada no existe';
  end if;

  if new.tenant_id <> register_tenant
     or new.branch_id <> register_branch
     or branch_tenant is distinct from new.tenant_id then
    raise exception 'La terminal, caja, sucursal y tenant no coinciden';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_terminal_scope() from public;

drop trigger if exists pos_terminals_validate_scope on public.pos_terminals;
create trigger pos_terminals_validate_scope
before insert or update of tenant_id, branch_id, cash_register_id
on public.pos_terminals
for each row execute function public.validate_terminal_scope();

-- updated_at consistente para sincronización y resolución de conflictos.
create or replace function public.set_cash_control_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pos_cash_registers_updated_at on public.pos_cash_registers;
create trigger pos_cash_registers_updated_at
before update on public.pos_cash_registers
for each row execute function public.set_cash_control_updated_at();

drop trigger if exists pos_cash_shifts_updated_at on public.pos_cash_shifts;
create trigger pos_cash_shifts_updated_at
before update on public.pos_cash_shifts
for each row execute function public.set_cash_control_updated_at();

drop trigger if exists pos_terminals_updated_at on public.pos_terminals;
create trigger pos_terminals_updated_at
before update on public.pos_terminals
for each row execute function public.set_cash_control_updated_at();

-- -----------------------------------------------------------------------------
-- 5. RLS multi-tenant para terminales y reafirmación para cajas/turnos
-- -----------------------------------------------------------------------------
alter table public.pos_terminals enable row level security;
alter table public.pos_terminals force row level security;
alter table public.pos_cash_registers enable row level security;
alter table public.pos_cash_shifts enable row level security;

-- La función current_tenant_id() ya fue creada por la Fase 5.
drop policy if exists pos_terminals_tenant_read on public.pos_terminals;
create policy pos_terminals_tenant_read
on public.pos_terminals for select to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists pos_terminals_tenant_insert on public.pos_terminals;
create policy pos_terminals_tenant_insert
on public.pos_terminals for insert to authenticated
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_terminals_tenant_update on public.pos_terminals;
create policy pos_terminals_tenant_update
on public.pos_terminals for update to authenticated
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_terminals_tenant_delete on public.pos_terminals;
create policy pos_terminals_tenant_delete
on public.pos_terminals for delete to authenticated
using (tenant_id = public.current_tenant_id());

-- Reaplicar políticas explícitas para evitar depender de nombres generados por
-- bloques anteriores y garantizar lectura/escritura tenant-scoped.
drop policy if exists pos_cash_registers_tenant_read on public.pos_cash_registers;
create policy pos_cash_registers_tenant_read
on public.pos_cash_registers for select to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_registers_tenant_insert on public.pos_cash_registers;
create policy pos_cash_registers_tenant_insert
on public.pos_cash_registers for insert to authenticated
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_registers_tenant_update on public.pos_cash_registers;
create policy pos_cash_registers_tenant_update
on public.pos_cash_registers for update to authenticated
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_registers_tenant_delete on public.pos_cash_registers;
create policy pos_cash_registers_tenant_delete
on public.pos_cash_registers for delete to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_shifts_tenant_read on public.pos_cash_shifts;
create policy pos_cash_shifts_tenant_read
on public.pos_cash_shifts for select to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_shifts_tenant_insert on public.pos_cash_shifts;
create policy pos_cash_shifts_tenant_insert
on public.pos_cash_shifts for insert to authenticated
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_shifts_tenant_update on public.pos_cash_shifts;
create policy pos_cash_shifts_tenant_update
on public.pos_cash_shifts for update
 to authenticated
using (tenant_id = public.current_tenant_id())
with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_cash_shifts_tenant_delete on public.pos_cash_shifts;
create policy pos_cash_shifts_tenant_delete
on public.pos_cash_shifts for delete to authenticated
using (tenant_id = public.current_tenant_id());

-- -----------------------------------------------------------------------------
-- 6. Realtime: cambios confirmados por PostgreSQL, no estados locales
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pos_cash_registers'
  ) then
    alter publication supabase_realtime add table public.pos_cash_registers;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pos_cash_shifts'
  ) then
    alter publication supabase_realtime add table public.pos_cash_shifts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pos_terminals'
  ) then
    alter publication supabase_realtime add table public.pos_terminals;
  end if;
exception
  when undefined_object then
    -- Permite ejecutar la migración en una instalación donde Realtime aún no
    -- esté creado; las tablas y RLS quedan listas para activarlo después.
    raise notice 'supabase_realtime aún no existe; agregar tablas a la publicación manualmente.';
end;
$$;

comment on table public.pos_terminals is
  'Asignación central tenant-scoped entre un dispositivo y una caja física.';
comment on column public.pos_terminals.device_key is
  'Identificador persistente del navegador/dispositivo; no contiene credenciales.';
comment on table public.pos_cash_registers is
  'Catálogo central de cajas y terminales fiscales por sucursal.';
comment on table public.pos_cash_shifts is
  'Turnos centrales por caja; máximo un turno OPEN por caja.';
