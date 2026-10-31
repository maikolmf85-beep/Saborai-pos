-- Vincula el estado temporal de alta con una intención de compra creada por el servidor.
-- El número de pedido queda persistido antes de contactar a Tilopay y se reutiliza
-- al reconciliar una respuesta ambigua; Tilopay documenta que no admite idempotency keys.
alter table public.tilopay_signup_handoffs
  alter column encrypted_payload drop not null;

alter table public.tilopay_signup_handoffs
  add column if not exists plan_id text not null default 'pro',
  add column if not exists amount numeric(14,2) not null default 45000,
  add column if not exists currency varchar(3) not null default 'CRC',
  add column if not exists order_number text,
  add column if not exists tokenization_attempts integer not null default 0,
  add column if not exists payment_status text not null default 'CREATED',
  add column if not exists payment_token_hash text,
  add column if not exists payment_attempts integer not null default 0,
  add column if not exists payment_lease_until timestamptz,
  add column if not exists payment_transaction_id text,
  add column if not exists payment_result jsonb,
  add column if not exists payment_started_at timestamptz,
  add column if not exists payment_finished_at timestamptz,
  add column if not exists signup_consumed_at timestamptz;

-- Para cualquier fila preexistente, generar un orderNumber estable antes de exigirlo.
update public.tilopay_signup_handoffs
set order_number = 'SA' || upper(substr(reference_hash, 1, 32))
where order_number is null;

alter table public.tilopay_signup_handoffs
  alter column order_number set not null;

create unique index if not exists tilopay_signup_handoffs_order_number_uidx
  on public.tilopay_signup_handoffs(order_number);

create index if not exists tilopay_signup_handoffs_payment_status_idx
  on public.tilopay_signup_handoffs(payment_status, payment_lease_until);

create index if not exists tilopay_signup_handoffs_consumed_idx
  on public.tilopay_signup_handoffs(signup_consumed_at)
  where signup_consumed_at is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_plan_id_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_plan_id_check
      check (plan_id in ('express', 'pro', 'multibranch'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_amount_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_amount_check
      check (amount > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_currency_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_payment_status_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_payment_status_check
      check (payment_status in ('CREATED', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'DECLINED'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_token_hash_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_token_hash_check
      check (payment_token_hash is null or payment_token_hash ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tilopay_signup_handoffs_tokenization_attempts_check'
      and conrelid = 'public.tilopay_signup_handoffs'::regclass
  ) then
    alter table public.tilopay_signup_handoffs
      add constraint tilopay_signup_handoffs_tokenization_attempts_check
      check (tokenization_attempts between 0 and 3);
  end if;
end $$;

create or replace function public.reserve_tilopay_tokenization(p_reference_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.tilopay_signup_handoffs
  set tokenization_attempts = tokenization_attempts + 1
  where reference_hash = p_reference_hash
    and expires_at > now()
    and payment_status = 'CREATED'
    and tokenization_attempts < 3
  returning true;
$$;

create or replace function public.claim_tilopay_signup_payment(
  p_reference_hash text,
  p_token_hash text
)
returns table (
  claim_status text,
  is_expired boolean,
  plan_id text,
  amount numeric,
  currency varchar(3),
  order_number text,
  expires_at timestamptz,
  payment_status text,
  payment_token_hash text,
  payment_transaction_id text,
  payment_result jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.tilopay_signup_handoffs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_claim_status text;
begin
  if p_reference_hash !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$' then
    return query select 'INVALID', true, null::text, null::numeric, null::varchar,
      null::text, null::timestamptz, null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  select * into v_intent
  from public.tilopay_signup_handoffs
  where reference_hash = p_reference_hash
  for update;

  if not found then
    return query select 'INVALID', true, null::text, null::numeric, null::varchar,
      null::text, null::timestamptz, null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  if v_intent.payment_token_hash is not null
     and v_intent.payment_token_hash <> p_token_hash then
    v_claim_status := 'TOKEN_MISMATCH';
  elsif v_intent.payment_status = 'SUCCEEDED' then
    v_claim_status := 'SUCCEEDED';
  elsif v_intent.payment_status = 'DECLINED' then
    v_claim_status := 'DECLINED';
  elsif v_intent.payment_status = 'CREATED' then
    if v_intent.expires_at <= v_now then
      v_claim_status := 'EXPIRED';
    else
      update public.tilopay_signup_handoffs as h
      set payment_status = 'PROCESSING',
          payment_token_hash = p_token_hash,
          payment_attempts = h.payment_attempts + 1,
          payment_started_at = coalesce(h.payment_started_at, v_now),
          payment_lease_until = v_now + interval '90 seconds'
      where h.reference_hash = p_reference_hash
      returning h.* into v_intent;
      v_claim_status := 'CLAIMED';
    end if;
  elsif v_intent.payment_status in ('PROCESSING', 'UNKNOWN') then
    if v_intent.payment_status = 'PROCESSING'
       and v_intent.payment_lease_until is not null
       and v_intent.payment_lease_until > v_now then
      v_claim_status := 'IN_PROGRESS';
    else
      update public.tilopay_signup_handoffs as h
      set payment_status = 'PROCESSING',
          payment_token_hash = p_token_hash,
          payment_attempts = h.payment_attempts + 1,
          payment_lease_until = v_now + interval '90 seconds'
      where h.reference_hash = p_reference_hash
      returning h.* into v_intent;
      v_claim_status := 'RECOVERY';
    end if;
  else
    v_claim_status := 'INVALID';
  end if;

  return query select
    v_claim_status,
    (v_intent.expires_at <= v_now),
    v_intent.plan_id,
    v_intent.amount,
    v_intent.currency,
    v_intent.order_number,
    v_intent.expires_at,
    v_intent.payment_status,
    v_intent.payment_token_hash,
    v_intent.payment_transaction_id,
    v_intent.payment_result;
end;
$$;

create or replace function public.record_tilopay_signup_payment(
  p_reference_hash text,
  p_token_hash text,
  p_payment_status text,
  p_transaction_id text,
  p_payment_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_payment_status not in ('SUCCEEDED', 'DECLINED', 'UNKNOWN') then
    raise exception 'Invalid payment status';
  end if;
  if p_reference_hash !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid intent or token digest';
  end if;

  update public.tilopay_signup_handoffs as h
  set payment_status = p_payment_status,
      payment_transaction_id = p_transaction_id,
      payment_result = p_payment_result,
      payment_lease_until = null,
      payment_finished_at = case when p_payment_status = 'UNKNOWN' then null else now() end
  where h.reference_hash = p_reference_hash
    and h.payment_token_hash = p_token_hash
    and h.payment_status = 'PROCESSING';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.reserve_tilopay_tokenization(text) from public, anon, authenticated;
revoke all on function public.claim_tilopay_signup_payment(text, text) from public, anon, authenticated;
revoke all on function public.record_tilopay_signup_payment(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_tilopay_tokenization(text) to service_role;
grant execute on function public.claim_tilopay_signup_payment(text, text) to service_role;
grant execute on function public.record_tilopay_signup_payment(text, text, text, text, jsonb) to service_role;

comment on column public.tilopay_signup_handoffs.order_number is
  'Referencia estable e irrepetible generada y persistida por el servidor antes de procesar cualquier cobro.';
comment on column public.tilopay_signup_handoffs.payment_result is
  'Resultado mínimo del cobro, conservado para devolver la misma respuesta ante reintentos.';
