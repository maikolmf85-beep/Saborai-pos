-- SaborAI POS - Fase 2: idempotencia para sincronizar configuración local
-- Requiere: 20261017000000_pos_core.sql y 20261026000000_phase8_central_cash_registers.sql.
-- No importa datos por sí sola; prepara claves estables para el importador frontend.

do $$
begin
  if to_regclass('public.pos_cash_registers') is null
     or to_regclass('public.pos_cash_shifts') is null
     or to_regclass('public.pos_terminals') is null then
    raise exception using
      errcode = '42P01',
      message = 'Faltan las migraciones base y Fase A. Ejecuta primero pos_core y phase8_central_cash_registers.';
  end if;
end;
$$;

alter table public.pos_cash_registers
  add column if not exists legacy_id text,
  add column if not exists source_device_key text;

alter table public.pos_cash_shifts
  add column if not exists legacy_id text,
  add column if not exists source_device_key text;

create unique index if not exists pos_cash_registers_tenant_legacy_id_uidx
  on public.pos_cash_registers(tenant_id, legacy_id)
  where legacy_id is not null;

create unique index if not exists pos_cash_shifts_tenant_legacy_id_uidx
  on public.pos_cash_shifts(tenant_id, legacy_id)
  where legacy_id is not null;

create index if not exists pos_cash_registers_source_device_idx
  on public.pos_cash_registers(tenant_id, source_device_key)
  where source_device_key is not null;

create index if not exists pos_cash_shifts_source_device_idx
  on public.pos_cash_shifts(tenant_id, source_device_key)
  where source_device_key is not null;

comment on column public.pos_cash_registers.legacy_id is
  'ID original del catálogo local; permite importar de forma idempotente.';
comment on column public.pos_cash_shifts.legacy_id is
  'ID original del turno local; permite importar de forma idempotente.';
