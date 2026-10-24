-- Fase 5: puente no disruptivo entre el usuario propio de SaborAI y Supabase Auth.
-- La columna queda NULL hasta completar la migración de identidad de cada usuario.
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create index if not exists users_auth_user_id_idx
  on public.users(auth_user_id)
  where auth_user_id is not null;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.active is distinct from false
  limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from public.tenants t
  join public.users u on u.id = t.user_id
  where u.auth_user_id = auth.uid()
    and u.active is distinct from false
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public;
revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
