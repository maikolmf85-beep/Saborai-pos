-- Fase 3: historial fiscal persistente y recuperable por tenant.
-- invoice_data contiene únicamente datos del comprobante, nunca credenciales ATV ni PIN.
alter table public.pos_invoices
  add column if not exists invoice_data jsonb not null default '{}'::jsonb;

create index if not exists pos_invoices_tenant_status_idx
  on public.pos_invoices(tenant_id, hacienda_status, created_at desc);
