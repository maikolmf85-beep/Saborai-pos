-- Reparación Fase 6: completar el esquema del historial fiscal.
-- No elimina ni modifica comprobantes existentes.

alter table if exists public.pos_invoices
  add column if not exists invoice_data jsonb not null default '{}'::jsonb;

create index if not exists pos_invoices_tenant_status_idx
  on public.pos_invoices(tenant_id, hacienda_status, created_at desc);

alter table if exists public.pos_invoices enable row level security;
