-- La reserva limita la concurrencia de llamadas de tokenización. Si el proveedor
-- falla, el backend libera ese cupo para que un fallo transitorio no bloquee el alta.
create or replace function public.release_tilopay_tokenization(p_reference_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.tilopay_signup_handoffs
  set tokenization_attempts = tokenization_attempts - 1
  where reference_hash = p_reference_hash
    and p_reference_hash ~ '^[a-f0-9]{64}$'
    and payment_status = 'CREATED'
    and tokenization_attempts > 0
  returning true;
$$;

revoke all on function public.release_tilopay_tokenization(text) from public, anon, authenticated;
grant execute on function public.release_tilopay_tokenization(text) to service_role;
