import { createHash } from 'node:crypto';

export const COEXISTENCE_EVENT_TYPES = [
  'history',
  'smb_app_state_sync',
  'smb_message_echoes'
] as const;

export type CoexistenceEventType = typeof COEXISTENCE_EVENT_TYPES[number];

type JsonObject = Record<string, unknown>;

export interface CoexistenceEvent {
  phone_number_id: string;
  event_type: CoexistenceEventType;
  event_fingerprint: string;
  event_payload: JsonObject;
}

export interface ExtractedCoexistenceEvents {
  events: CoexistenceEvent[];
  invalid: boolean;
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const object = value as JsonObject;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function fingerprintCoexistencePayload(payload: JsonObject): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function extractCoexistenceEvents(payload: unknown): ExtractedCoexistenceEvents {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return { events: [], invalid: false };
  }

  const events: CoexistenceEvent[] = [];
  let invalid = false;

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || typeof change.field !== 'string') continue;
      if (!(COEXISTENCE_EVENT_TYPES as readonly string[]).includes(change.field)) continue;

      const value = change.value;
      const metadata = isRecord(value) && isRecord(value.metadata) ? value.metadata : null;
      const phoneNumberId = metadata?.phone_number_id;
      if (
        payload.object !== 'whatsapp_business_account'
        || !isRecord(value)
        || value.messaging_product !== 'whatsapp'
        || typeof phoneNumberId !== 'string'
        || phoneNumberId.length === 0
        || phoneNumberId.trim() !== phoneNumberId
      ) {
        invalid = true;
        continue;
      }

      const eventType = change.field as CoexistenceEventType;
      const eventPayload: JsonObject = {
        entry_id: typeof entry.id === 'string' ? entry.id : null,
        field: eventType,
        value
      };
      events.push({
        phone_number_id: phoneNumberId,
        event_type: eventType,
        event_fingerprint: fingerprintCoexistencePayload(eventPayload),
        event_payload: eventPayload
      });
    }
  }

  return { events, invalid };
}

interface TenantResolutionOptions {
  configuredPhoneNumberId?: string;
  configuredTenantId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveTenantId(
  supabase: any,
  phoneNumberId: string,
  options: TenantResolutionOptions
): Promise<string | null> {
  if (options.configuredPhoneNumberId === phoneNumberId && options.configuredTenantId) {
    if (!UUID_PATTERN.test(options.configuredTenantId)) {
      throw new Error('Invalid configured WhatsApp tenant mapping.');
    }
    return options.configuredTenantId.toLowerCase();
  }

  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('tenant_id')
    .eq('phone_number_id', phoneNumberId)
    .limit(1001);

  if (error || !Array.isArray(data)) {
    throw new Error('WhatsApp tenant lookup failed.');
  }
  if (data.length >= 1000) {
    throw new Error('WhatsApp tenant lookup is ambiguous.');
  }

  const tenantIds = new Set<string>();
  for (const row of data) {
    if (!isRecord(row) || row.tenant_id === null || row.tenant_id === undefined) continue;
    if (typeof row.tenant_id !== 'string' || !UUID_PATTERN.test(row.tenant_id)) {
      throw new Error('WhatsApp tenant lookup returned an invalid tenant.');
    }
    tenantIds.add(row.tenant_id.toLowerCase());
  }

  if (tenantIds.size > 1) {
    throw new Error('WhatsApp phone number maps to multiple tenants.');
  }
  return tenantIds.values().next().value ?? null;
}

export async function persistCoexistenceEvents(
  supabase: any,
  events: CoexistenceEvent[],
  options: TenantResolutionOptions = {}
): Promise<void> {
  if (events.length === 0) return;

  const tenantByPhoneNumber = new Map<string, string | null>();
  for (const event of events) {
    if (!tenantByPhoneNumber.has(event.phone_number_id)) {
      tenantByPhoneNumber.set(
        event.phone_number_id,
        await resolveTenantId(supabase, event.phone_number_id, options)
      );
    }
  }

  const rows = events.map((event) => ({
    ...event,
    tenant_id: tenantByPhoneNumber.get(event.phone_number_id) ?? null
  }));

  // La restricción UNIQUE existente sobre (phone_number_id, event_type,
  // event_fingerprint) hace que la deduplicación sea atómica entre instancias.
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { error } = await supabase
      .from('whatsapp_coexistence_events')
      .upsert(rows.slice(offset, offset + 100), {
        onConflict: 'phone_number_id,event_type,event_fingerprint',
        ignoreDuplicates: true
      });
    if (error) throw new Error('WhatsApp coexistence event persistence failed.');
  }
}
