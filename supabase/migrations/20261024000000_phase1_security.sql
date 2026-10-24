-- Fase 1: persistencia idempotente de webhooks de suscripción.
-- Los endpoints usan service_role y validan el evento antes de mutar el tenant.
create table if not exists public.subscription_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  tenant_id uuid,
  transaction_id text,
  amount numeric(14,2),
  currency varchar(3),
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED', 'PROCESSED', 'FAILED')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists subscription_webhook_events_tenant_idx
  on public.subscription_webhook_events(tenant_id, received_at desc);

create index if not exists subscription_webhook_events_transaction_idx
  on public.subscription_webhook_events(transaction_id);

alter table public.subscription_webhook_events enable row level security;
