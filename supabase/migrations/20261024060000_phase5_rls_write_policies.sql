-- Fase 5: escrituras tenant-scoped para datos operativos no fiscales.
-- Pagos, facturas, inventario y auditoría siguen protegidos detrás del backend.
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
    'pos_order_items'
  ]
  loop
    if to_regclass('public.' || current_table) is not null then
      execute format('drop policy if exists %I on public.%I', current_table || '_tenant_insert', current_table);
      execute format('drop policy if exists %I on public.%I', current_table || '_tenant_update', current_table);
      execute format('drop policy if exists %I on public.%I', current_table || '_tenant_delete', current_table);

      execute format(
        'create policy %I on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())',
        current_table || '_tenant_insert', current_table
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())',
        current_table || '_tenant_update', current_table
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())',
        current_table || '_tenant_delete', current_table
      );
    end if;
  end loop;
end
$$;
