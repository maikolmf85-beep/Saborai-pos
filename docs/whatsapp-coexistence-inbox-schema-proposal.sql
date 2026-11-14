-- BORRADOR PARA REVISION — NO APLICAR SIN APROBACION EXPLICITA.
-- Dependencias existentes verificadas por metadatos:
--   public.whatsapp_conversations
--   public.whatsapp_messages
--   public.whatsapp_coexistence_events
--   public.tenants
--   public.users
-- No contiene UPDATE/DELETE de mensajes existentes ni backfill de filas.
-- El cambio permite que una conversacion use BSUID cuando Meta no entrega
-- telefono; amplía la representacion de mensajes sin reemplazar el body actual;
-- y conserva cada cambio de contacto como evento append-only vinculado al
-- archivo crudo (la cascada respeta la retencion del evento de origen).

BEGIN;

-- 1) Identidad de contacto compatible con Business-Scoped User IDs.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN customer_user_id text,
  ADD COLUMN customer_parent_user_id text,
  ADD COLUMN customer_username text;

ALTER TABLE public.whatsapp_conversations
  ALTER COLUMN customer_wa_id DROP NOT NULL;

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT whatsapp_conversations_customer_wa_id_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_customer_identity_check
  CHECK (
    (customer_wa_id IS NULL OR (char_length(customer_wa_id) BETWEEN 1 AND 128))
    AND (customer_user_id IS NULL OR (char_length(customer_user_id) BETWEEN 1 AND 128))
    AND (customer_parent_user_id IS NULL OR (char_length(customer_parent_user_id) BETWEEN 1 AND 128))
    AND (customer_username IS NULL OR (char_length(customer_username) BETWEEN 1 AND 256))
    AND (customer_wa_id IS NOT NULL OR customer_user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX whatsapp_conversations_phone_user_id_uidx
  ON public.whatsapp_conversations (phone_number_id, customer_user_id)
  WHERE customer_user_id IS NOT NULL;

-- 2) Metadatos provider para estados, tipos de contenido y acciones edit/revoke.
-- Las columnas nuevas quedan NULL en mensajes actuales; no se hace backfill.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN message_type text,
  ADD COLUMN provider_timestamp timestamptz,
  ADD COLUMN provider_status text,
  ADD COLUMN provider_action text,
  ADD COLUMN original_provider_message_id text,
  ADD COLUMN content_payload jsonb;

ALTER TABLE public.whatsapp_messages
  ALTER COLUMN body DROP NOT NULL;

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT whatsapp_messages_body_check;

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_body_check
  CHECK (body IS NULL OR (char_length(body) BETWEEN 1 AND 4000));

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_content_presence_check
  CHECK (
    body IS NOT NULL
    OR content_payload IS NOT NULL
    OR (provider_action IN ('edit', 'revoke') AND original_provider_message_id IS NOT NULL)
  );

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_type_length_check
  CHECK (message_type IS NULL OR char_length(message_type) BETWEEN 1 AND 64);

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_provider_status_check
  CHECK (
    provider_status IS NULL
    OR provider_status = ANY (ARRAY['DELIVERED', 'ERROR', 'PENDING', 'PLAYED', 'READ', 'SENT']::text[])
  );

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_provider_action_check
  CHECK (provider_action IS NULL OR provider_action = ANY (ARRAY['message', 'edit', 'revoke']::text[]));

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_original_provider_id_check
  CHECK (original_provider_message_id IS NULL OR char_length(original_provider_message_id) BETWEEN 1 AND 512);

-- Conserva los valores vigentes y agrega un origen explícito para mensajes
-- emitidos desde la app empresarial de WhatsApp. No reescribe filas existentes.
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT whatsapp_messages_source_check;

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_source_check
  CHECK (source = ANY (ARRAY['customer', 'gemini', 'human', 'system', 'whatsapp_business_app']::text[]));

CREATE INDEX whatsapp_messages_original_provider_id_idx
  ON public.whatsapp_messages (original_provider_message_id)
  WHERE original_provider_message_id IS NOT NULL;

-- 3) Contactos sincronizados: eventos inmutables; no convierten por sí solos
-- un contacto en conversación ni pisan customer_display_name.
CREATE TABLE public.whatsapp_coexistence_contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL
    REFERENCES public.whatsapp_coexistence_events(id) ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  phone_number_id text NOT NULL
    CHECK (char_length(phone_number_id) BETWEEN 1 AND 128),
  tenant_id uuid NULL REFERENCES public.tenants(id),
  business_verified_at timestamptz NULL,
  business_verified_by_user_id uuid NULL REFERENCES public.users(id),
  action text NOT NULL CHECK (action = ANY (ARRAY['add', 'remove']::text[])),
  customer_user_id text NOT NULL
    CHECK (char_length(customer_user_id) BETWEEN 1 AND 128),
  customer_parent_user_id text NULL
    CHECK (customer_parent_user_id IS NULL OR char_length(customer_parent_user_id) BETWEEN 1 AND 128),
  customer_wa_id text NULL
    CHECK (customer_wa_id IS NULL OR char_length(customer_wa_id) BETWEEN 1 AND 128),
  customer_username text NULL
    CHECK (customer_username IS NULL OR char_length(customer_username) BETWEEN 1 AND 256),
  customer_first_name text NULL
    CHECK (customer_first_name IS NULL OR char_length(customer_first_name) BETWEEN 1 AND 256),
  customer_full_name text NULL
    CHECK (customer_full_name IS NULL OR char_length(customer_full_name) BETWEEN 1 AND 512),
  provider_timestamp timestamptz NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_coexistence_contact_events_verified_tenant_check
    CHECK (
      tenant_id IS NULL
      OR (business_verified_at IS NOT NULL AND business_verified_by_user_id IS NOT NULL)
    ),
  CONSTRAINT whatsapp_coexistence_contact_events_raw_item_key
    UNIQUE (raw_event_id, item_index)
);

CREATE INDEX whatsapp_coexistence_contact_events_tenant_recent_idx
  ON public.whatsapp_coexistence_contact_events (tenant_id, received_at DESC);

CREATE INDEX whatsapp_coexistence_contact_events_user_recent_idx
  ON public.whatsapp_coexistence_contact_events (phone_number_id, customer_user_id, received_at DESC);

-- Datos personales sincronizados solo accesibles al servicio backend.
ALTER TABLE public.whatsapp_coexistence_contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_coexistence_contact_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_coexistence_contact_events TO service_role;

COMMIT;
