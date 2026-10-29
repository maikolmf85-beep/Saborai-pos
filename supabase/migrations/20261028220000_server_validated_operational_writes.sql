-- Route operational mutations through authenticated server endpoints.
-- This file is intentionally not applied as part of this task.
-- SELECT/RLS policies remain unchanged; the API uses service_role after validating
-- the SaborAI JWT, tenant, persisted role, and employee identity.
do $$
declare
  current_table text;
begin
  foreach current_table in array array[
    'pos_branches',
    'pos_cash_registers',
    'pos_cash_shifts',
    'pos_terminals',
    'pos_table_layouts',
    'pos_table_reservations'
  ]
  loop
    if to_regclass('public.' || current_table) is not null then
      execute format(
        'revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated',
        current_table
      );
    end if;
  end loop;
end
$$;
