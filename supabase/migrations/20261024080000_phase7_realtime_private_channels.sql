-- Fase 7: canales Realtime privados y aislados por tenant.
-- Requiere que Fase 5 haya creado public.current_tenant_id().

alter table realtime.messages enable row level security;

drop policy if exists "saborai_realtime_tenant_receive" on realtime.messages;
create policy "saborai_realtime_tenant_receive"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() = 'tenant-' || public.current_tenant_id()::text || '-sync'
);

drop policy if exists "saborai_realtime_tenant_send" on realtime.messages;
create policy "saborai_realtime_tenant_send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.topic() = 'tenant-' || public.current_tenant_id()::text || '-sync'
);
