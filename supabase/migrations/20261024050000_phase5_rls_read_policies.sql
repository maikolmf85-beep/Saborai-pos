-- Fase 5: lectura multi-tenant para Supabase Auth.
-- Solo usuarios authenticated con un tenant resuelto pueden leer sus propios datos.
-- service_role continúa operando por los endpoints backend y no queda bloqueado.
do $$
declare
  current_table text;
begin
  foreach current_table in array array[
    'pos_branches',
    'pos_cash_registers',
    'pos_cash_shifts',
    'pos_menu_categories',
    'pos_menu_items',
    'pos_ingredients',
    'pos_recipes',
    'pos_tables',
    'pos_orders',
    'pos_order_items',
    'pos_payments',
    'pos_invoices',
    'pos_inventory_movements',
    'pos_audit_events'
  ]
  loop
    if to_regclass('public.' || current_table) is not null then
      execute format('drop policy if exists %I on public.%I', current_table || '_tenant_read', current_table);
      execute format(
        'create policy %I on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())',
        current_table || '_tenant_read', current_table
      );
    end if;
  end loop;
end
$$;
