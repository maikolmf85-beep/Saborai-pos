-- Estado efímero cifrado para completar altas después del retorno de Tilopay.
-- El navegador recibe solo una referencia aleatoria; en la tabla se guarda su hash.
create table if not exists public.tilopay_signup_handoffs (
  reference_hash text primary key
    check (reference_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists tilopay_signup_handoffs_expires_at_idx
  on public.tilopay_signup_handoffs (expires_at);

alter table public.tilopay_signup_handoffs enable row level security;

revoke all on table public.tilopay_signup_handoffs from public, anon, authenticated;
grant all on table public.tilopay_signup_handoffs to service_role;

comment on table public.tilopay_signup_handoffs is
  'Datos de registro cifrados, accesibles solo desde el backend y eliminados al consumir la referencia de retorno de Tilopay.';
