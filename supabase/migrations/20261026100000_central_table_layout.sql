-- Layout central del mapa de mesas: solo geometría y metadatos visuales, nunca pedidos.
create or replace function public.is_valid_table_layout(p_layout jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  item jsonb;
  seen_ids text[] := '{}';
begin
  if jsonb_typeof(p_layout) <> 'array' then
    return false;
  end if;

  for item in select value from jsonb_array_elements(p_layout) as entries(value)
  loop
    if jsonb_typeof(item) <> 'object'
       or not (item ?& array['id', 'number', 'name', 'zone', 'seats', 'shape', 'x', 'y'])
       or (item - array['id', 'number', 'name', 'zone', 'seats', 'shape', 'x', 'y', 'rotation']) <> '{}'::jsonb
       or jsonb_typeof(item->'id') <> 'string'
       or length(btrim(item->>'id')) = 0
       or (item->>'id') = any(seen_ids)
       or jsonb_typeof(item->'number') <> 'number'
       or (item->>'number')::numeric < 1
       or (item->>'number')::numeric <> trunc((item->>'number')::numeric)
       or jsonb_typeof(item->'name') <> 'string'
       or length(btrim(item->>'name')) = 0
       or jsonb_typeof(item->'zone') <> 'string'
       or jsonb_typeof(item->'seats') <> 'number'
       or (item->>'seats')::numeric < 1
       or (item->>'seats')::numeric <> trunc((item->>'seats')::numeric)
       or jsonb_typeof(item->'shape') <> 'string'
       or item->>'shape' not in ('square', 'round', 'bar')
       or jsonb_typeof(item->'x') <> 'number'
       or (item->>'x')::numeric < 0
       or (item->>'x')::numeric > 100
       or jsonb_typeof(item->'y') <> 'number'
       or (item->>'y')::numeric < 0
       or (item->>'y')::numeric > 100
       or (item ? 'rotation' and jsonb_typeof(item->'rotation') <> 'number') then
      return false;
    end if;
    seen_ids := array_append(seen_ids, item->>'id');
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create table if not exists public.pos_table_layouts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint pos_table_layouts_layout_valid_ck check (public.is_valid_table_layout(layout))
);

create or replace function public.touch_pos_table_layout_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pos_table_layouts_touch_updated_at on public.pos_table_layouts;
create trigger pos_table_layouts_touch_updated_at
  before insert or update on public.pos_table_layouts
  for each row execute function public.touch_pos_table_layout_updated_at();

alter table public.pos_table_layouts enable row level security;

drop policy if exists pos_table_layouts_select_tenant on public.pos_table_layouts;
create policy pos_table_layouts_select_tenant
  on public.pos_table_layouts for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_layouts_insert_tenant on public.pos_table_layouts;
create policy pos_table_layouts_insert_tenant
  on public.pos_table_layouts for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_layouts_update_tenant on public.pos_table_layouts;
create policy pos_table_layouts_update_tenant
  on public.pos_table_layouts for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists pos_table_layouts_delete_tenant on public.pos_table_layouts;
create policy pos_table_layouts_delete_tenant
  on public.pos_table_layouts for delete to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.pos_table_layouts to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pos_table_layouts'
     ) then
    alter publication supabase_realtime add table public.pos_table_layouts;
  end if;
end;
$$;
