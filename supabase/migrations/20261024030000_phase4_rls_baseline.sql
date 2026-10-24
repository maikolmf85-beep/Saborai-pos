-- Fase 4: baseline uniforme de seguridad RLS.
-- El backend usa service_role y valida tenant_id con el JWT propio de SaborAI.
-- No se crean políticas publicas: una política abierta podría exponer datos entre tenants.
alter table if exists public.pos_branches enable row level security;
alter table if exists public.pos_cash_registers enable row level security;
alter table if exists public.pos_cash_shifts enable row level security;
alter table if exists public.pos_menu_categories enable row level security;
alter table if exists public.pos_menu_items enable row level security;
alter table if exists public.pos_ingredients enable row level security;
alter table if exists public.pos_recipes enable row level security;
alter table if exists public.pos_tables enable row level security;
alter table if exists public.pos_orders enable row level security;
alter table if exists public.pos_order_items enable row level security;
alter table if exists public.pos_payments enable row level security;
alter table if exists public.pos_invoices enable row level security;
alter table if exists public.pos_inventory_movements enable row level security;
alter table if exists public.pos_audit_events enable row level security;
