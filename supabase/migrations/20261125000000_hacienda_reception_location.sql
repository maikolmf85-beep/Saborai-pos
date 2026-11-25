-- Trazabilidad de la respuesta de recepción de Hacienda (HTTP 201/202).
alter table if exists public.pos_invoices
  add column if not exists hacienda_reception_location text;

comment on column public.pos_invoices.hacienda_reception_location is
  'Encabezado Location devuelto por la API de recepción de Hacienda, cuando está presente.';
