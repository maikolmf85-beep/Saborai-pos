-- SaborAI POS - Fase 1: alcance operativo por sucursal, caja, turno y terminal
-- Aditiva y compatible con datos históricos: las columnas nuevas son NULLABLE
-- hasta que el backfill de operaciones antiguas sea completado.

alter table public.pos_orders
  add column if not exists cash_register_id uuid references public.pos_cash_registers(id) on delete set null,
  add column if not exists terminal_id uuid references public.pos_terminals(id) on delete set null;

alter table public.pos_payments
  add column if not exists branch_id uuid references public.pos_branches(id) on delete set null,
  add column if not exists cash_register_id uuid references public.pos_cash_registers(id) on delete set null,
  add column if not exists terminal_id uuid references public.pos_terminals(id) on delete set null;

alter table public.pos_invoices
  add column if not exists cash_shift_id uuid references public.pos_cash_shifts(id) on delete set null,
  add column if not exists cash_register_id uuid references public.pos_cash_registers(id) on delete set null,
  add column if not exists terminal_id uuid references public.pos_terminals(id) on delete set null;

alter table public.pos_inventory_movements
  add column if not exists cash_shift_id uuid references public.pos_cash_shifts(id) on delete set null,
  add column if not exists cash_register_id uuid references public.pos_cash_registers(id) on delete set null,
  add column if not exists terminal_id uuid references public.pos_terminals(id) on delete set null;

create index if not exists pos_orders_operational_scope_idx
  on public.pos_orders(tenant_id, branch_id, cash_register_id, cash_shift_id, created_at desc);
create index if not exists pos_payments_operational_scope_idx
  on public.pos_payments(tenant_id, branch_id, cash_register_id, cash_shift_id, created_at desc);
create index if not exists pos_invoices_operational_scope_idx
  on public.pos_invoices(tenant_id, branch_id, cash_register_id, cash_shift_id, created_at desc);
create index if not exists pos_inventory_operational_scope_idx
  on public.pos_inventory_movements(tenant_id, branch_id, cash_register_id, cash_shift_id, created_at desc);

create or replace function public.validate_pos_operational_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_tenant uuid;
  register_tenant uuid;
  register_branch uuid;
  shift_tenant uuid;
  shift_branch uuid;
  shift_register uuid;
  terminal_tenant uuid;
  terminal_branch uuid;
  terminal_register uuid;
begin
  if TG_TABLE_NAME = 'pos_inventory_movements' and new.order_id is not null then
    select o.branch_id, o.cash_register_id, o.cash_shift_id, o.terminal_id
      into new.branch_id, new.cash_register_id, new.cash_shift_id, new.terminal_id
    from public.pos_orders o
    where o.id = new.order_id
      and o.tenant_id = new.tenant_id;
  end if;

  if new.branch_id is not null then
    select tenant_id into branch_tenant
    from public.pos_branches
    where id = new.branch_id;
    if branch_tenant is null or branch_tenant <> new.tenant_id then
      raise exception 'La sucursal no pertenece al tenant de la operación';
    end if;
  end if;

  if new.cash_register_id is not null then
    select tenant_id, branch_id into register_tenant, register_branch
    from public.pos_cash_registers
    where id = new.cash_register_id;
    if register_tenant is null
       or register_tenant <> new.tenant_id
       or (new.branch_id is not null and register_branch <> new.branch_id) then
      raise exception 'La caja no pertenece al tenant o sucursal de la operación';
    end if;
  end if;

  if new.cash_shift_id is not null then
    select tenant_id, branch_id, cash_register_id
      into shift_tenant, shift_branch, shift_register
    from public.pos_cash_shifts
    where id = new.cash_shift_id;
    if shift_tenant is null
       or shift_tenant <> new.tenant_id
       or (new.branch_id is not null and shift_branch <> new.branch_id)
       or (new.cash_register_id is not null and shift_register <> new.cash_register_id) then
      raise exception 'El turno no pertenece al tenant, sucursal o caja de la operación';
    end if;
  end if;

  if new.terminal_id is not null then
    select tenant_id, branch_id, cash_register_id
      into terminal_tenant, terminal_branch, terminal_register
    from public.pos_terminals
    where id = new.terminal_id;
    if terminal_tenant is null
       or terminal_tenant <> new.tenant_id
       or (new.branch_id is not null and terminal_branch <> new.branch_id)
       or (new.cash_register_id is not null and terminal_register <> new.cash_register_id) then
      raise exception 'La terminal no pertenece al tenant, sucursal o caja de la operación';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_pos_operational_scope() from public;

drop trigger if exists pos_orders_validate_operational_scope on public.pos_orders;
create trigger pos_orders_validate_operational_scope
before insert or update of tenant_id, branch_id, cash_register_id, cash_shift_id, terminal_id
on public.pos_orders
for each row execute function public.validate_pos_operational_scope();

drop trigger if exists pos_payments_validate_operational_scope on public.pos_payments;
create trigger pos_payments_validate_operational_scope
before insert or update of tenant_id, branch_id, cash_register_id, cash_shift_id, terminal_id
on public.pos_payments
for each row execute function public.validate_pos_operational_scope();

drop trigger if exists pos_invoices_validate_operational_scope on public.pos_invoices;
create trigger pos_invoices_validate_operational_scope
before insert or update of tenant_id, branch_id, cash_register_id, cash_shift_id, terminal_id
on public.pos_invoices
for each row execute function public.validate_pos_operational_scope();

drop trigger if exists pos_inventory_validate_operational_scope on public.pos_inventory_movements;
create trigger pos_inventory_validate_operational_scope
before insert or update of tenant_id, branch_id, cash_register_id, cash_shift_id, terminal_id
on public.pos_inventory_movements
for each row execute function public.validate_pos_operational_scope();

comment on column public.pos_orders.cash_register_id is
  'Caja central que originó la orden; NULL solo para históricos aún no backfilleados.';
comment on column public.pos_orders.terminal_id is
  'Terminal central que originó la orden; NULL solo para históricos aún no backfilleados.';
comment on column public.pos_payments.branch_id is
  'Sucursal donde se recibió el pago; debe coincidir con el turno y la caja.';
comment on column public.pos_inventory_movements.cash_shift_id is
  'Turno que originó el movimiento de inventario por venta.';
