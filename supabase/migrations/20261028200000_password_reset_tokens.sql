-- Tokens opacos de recuperación de contraseña; solo se almacena el SHA-256.
-- La API los consume mediante un DELETE filtrado y atómico, evitando su reutilización.
create table if not exists public.password_reset_tokens (
  token_hash text primary key
    check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_expires_idx
  on public.password_reset_tokens(user_id, expires_at);

alter table public.password_reset_tokens enable row level security;
revoke all on table public.password_reset_tokens from public, anon, authenticated;
grant all on table public.password_reset_tokens to service_role;
