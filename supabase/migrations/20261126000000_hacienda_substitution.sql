-- Trazabilidad de comprobantes sustitutivos por rechazo de Hacienda.
alter table if exists public.pos_invoices
  add column if not exists sustituye_clave varchar(50),
  add column if not exists sustituido_por_clave varchar(50);

create index if not exists pos_invoices_sustitucion_idx
  on public.pos_invoices(tenant_id, sustituye_clave, sustituido_por_clave);

comment on column public.pos_invoices.sustituye_clave is
  'Clave del comprobante rechazado que este documento sustituye mediante referencia código 10.';

comment on column public.pos_invoices.sustituido_por_clave is
  'Clave del comprobante nuevo que sustituyó este documento rechazado.';
