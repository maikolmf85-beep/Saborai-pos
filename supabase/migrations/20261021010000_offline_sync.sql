-- SaborAI POS - Fase 3: idempotencia de sincronización offline
-- Permite reintentar una operación sin duplicar su efecto en el backend.

create unique index if not exists pos_audit_events_tenant_request_uidx
  on public.pos_audit_events(tenant_id, request_id)
  where request_id is not null;
