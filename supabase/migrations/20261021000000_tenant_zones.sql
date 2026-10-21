-- SaborAI POS - Persistencia central de salones por restaurante
-- Aditiva y compatible con cuentas existentes.

alter table public.tenants
  add column if not exists zones jsonb not null default '[]'::jsonb;

alter table public.tenants
  add constraint tenants_zones_is_array
  check (jsonb_typeof(zones) = 'array');
