import type { CoexistenceEvent } from './coexistence.js';

type JsonObject = Record<string, unknown>;
export type InboxDirection = 'inbound' | 'outbound';
export type InboxSource = 'customer' | 'human';
export type InboxDeliveryStatus = 'received' | 'queued' | 'sent' | 'failed';

export interface NormalizedCoexistenceMessage {
  phone_number_id: string;
  customer_wa_id: string;
  customer_user_id: string | null;
  provider_message_id: string;
  direction: InboxDirection;
  source: InboxSource;
  body: string;
  delivery_status: InboxDeliveryStatus;
  created_at: string;
  event_type: 'history' | 'smb_message_echoes';
}

export interface CoexistenceNormalizationResult {
  messages: NormalizedCoexistenceMessage[];
  contact_state_items: number;
  duplicate_message_ids: number;
  skipped_by_reason: Record<string, number>;
}

export interface CoexistenceInboxPersistResult {
  imported: number;
  skipped_unverified_tenant: number;
  duplicate_message_ids: number;
}

interface VerifiedTenantMapping {
  tenant_id: string;
  business_verified_at: string;
  business_verified_by_user_id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[0-9]{5,20}$/;
const MAX_BODY_LENGTH = 4000;

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
}

function phoneNumber(value: unknown): string | null {
  const candidate = nonEmptyString(value);
  return candidate && PHONE_PATTERN.test(candidate) ? candidate.replace(/^\+/, '') : null;
}

function normalizedDigits(value: string | null): string | null {
  return value ? value.replace(/^\+/, '') : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,13}$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8_640_000_000) return null;
  const milliseconds = seconds * 1000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addSkipped(result: CoexistenceNormalizationResult, reason: string, count = 1): void {
  result.skipped_by_reason[reason] = (result.skipped_by_reason[reason] ?? 0) + count;
}

function textBody(message: JsonObject): string | null {
  if (message.type !== 'text' || !isRecord(message.text) || typeof message.text.body !== 'string') return null;
  const body = message.text.body;
  const codePointLength = [...body].length;
  return codePointLength >= 1 && codePointLength <= MAX_BODY_LENGTH ? body : null;
}

function normalizeHistoryMessage(
  event: CoexistenceEvent,
  value: JsonObject,
  thread: JsonObject,
  context: JsonObject,
  message: JsonObject,
  businessPhone: string | null,
  result: CoexistenceNormalizationResult
): NormalizedCoexistenceMessage | null {
  const customerWaId = phoneNumber(context.wa_id) ?? phoneNumber(thread.id);
  const customerUserId = nonEmptyString(context.user_id) ?? nonEmptyString(message.from_user_id);
  if (!customerWaId) {
    addSkipped(result, 'customer_phone_missing_or_unusable');
    return null;
  }

  const fromUserId = nonEmptyString(message.from_user_id);
  const fromPhone = phoneNumber(message.from);
  let direction: InboxDirection | null = null;
  if (customerUserId && fromUserId === customerUserId) direction = 'inbound';
  else if (fromPhone && normalizedDigits(fromPhone) === normalizedDigits(customerWaId)) direction = 'inbound';
  else if (businessPhone && fromPhone && normalizedDigits(fromPhone) === normalizedDigits(businessPhone)) direction = 'outbound';
  if (!direction) {
    addSkipped(result, 'message_direction_ambiguous');
    return null;
  }

  const providerMessageId = nonEmptyString(message.id);
  if (!providerMessageId) {
    addSkipped(result, 'provider_message_id_missing');
    return null;
  }
  const createdAt = isoTimestamp(message.timestamp);
  if (!createdAt) {
    addSkipped(result, 'provider_timestamp_invalid');
    return null;
  }
  const body = textBody(message);
  if (body === null) {
    addSkipped(result, message.type === 'edit' || message.type === 'revoke' ? 'message_action_requires_schema' : 'message_content_not_representable');
    return null;
  }

  let deliveryStatus: InboxDeliveryStatus;
  if (direction === 'inbound') {
    deliveryStatus = 'received';
  } else {
    const historyContext = isRecord(message.history_context) ? message.history_context : null;
    const providerStatus = nonEmptyString(historyContext?.status)?.toUpperCase();
    if (providerStatus === 'SENT') deliveryStatus = 'sent';
    else if (providerStatus === 'ERROR') deliveryStatus = 'failed';
    else if (providerStatus === 'PENDING') deliveryStatus = 'queued';
    else {
      addSkipped(result, 'provider_status_not_representable');
      return null;
    }
  }

  return {
    phone_number_id: event.phone_number_id,
    customer_wa_id: customerWaId,
    customer_user_id: customerUserId,
    provider_message_id: providerMessageId,
    direction,
    source: direction === 'inbound' ? 'customer' : 'human',
    body,
    delivery_status: deliveryStatus,
    created_at: createdAt,
    event_type: 'history'
  };
}

function normalizeHistoryEvent(
  event: CoexistenceEvent,
  value: JsonObject,
  result: CoexistenceNormalizationResult
): NormalizedCoexistenceMessage[] {
  if (!Array.isArray(value.history)) {
    addSkipped(result, 'history_structure_invalid');
    return [];
  }
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const businessPhone = phoneNumber(metadata.display_phone_number);
  const messages: NormalizedCoexistenceMessage[] = [];
  for (const phase of value.history) {
    if (!isRecord(phase) || !Array.isArray(phase.threads)) {
      addSkipped(result, 'history_structure_invalid');
      continue;
    }
    for (const thread of phase.threads) {
      if (!isRecord(thread) || !Array.isArray(thread.messages)) {
        addSkipped(result, 'history_structure_invalid');
        continue;
      }
      const context = isRecord(thread.context) ? thread.context : {};
      for (const item of thread.messages) {
        if (!isRecord(item)) {
          addSkipped(result, 'message_structure_invalid');
          continue;
        }
        const normalized = normalizeHistoryMessage(event, value, thread, context, item, businessPhone, result);
        if (normalized) messages.push(normalized);
      }
    }
  }
  return messages;
}

function normalizeEchoEvent(
  event: CoexistenceEvent,
  value: JsonObject,
  result: CoexistenceNormalizationResult
): NormalizedCoexistenceMessage[] {
  if (!Array.isArray(value.message_echoes)) {
    addSkipped(result, 'echo_structure_invalid');
    return [];
  }
  const contactsByUserId = new Map<string, string>();
  if (Array.isArray(value.contacts)) {
    for (const item of value.contacts) {
      if (!isRecord(item)) continue;
      const userId = nonEmptyString(item.user_id);
      const waId = phoneNumber(item.wa_id);
      if (userId && waId) contactsByUserId.set(userId, waId);
    }
  }

  const messages: NormalizedCoexistenceMessage[] = [];
  for (const item of value.message_echoes) {
    if (!isRecord(item)) {
      addSkipped(result, 'message_structure_invalid');
      continue;
    }
    if (item.type === 'edit' || item.type === 'revoke') {
      addSkipped(result, 'message_action_requires_schema');
      continue;
    }
    const customerUserId = nonEmptyString(item.to_user_id);
    const customerWaId = phoneNumber(item.to) ?? (customerUserId ? contactsByUserId.get(customerUserId) ?? null : null);
    if (!customerWaId) {
      addSkipped(result, 'customer_phone_missing_or_unusable');
      continue;
    }
    const providerMessageId = nonEmptyString(item.id);
    if (!providerMessageId) {
      addSkipped(result, 'provider_message_id_missing');
      continue;
    }
    const createdAt = isoTimestamp(item.timestamp);
    if (!createdAt) {
      addSkipped(result, 'provider_timestamp_invalid');
      continue;
    }
    const body = textBody(item);
    if (body === null) {
      addSkipped(result, 'message_content_not_representable');
      continue;
    }
    messages.push({
      phone_number_id: event.phone_number_id,
      customer_wa_id: customerWaId,
      customer_user_id: customerUserId,
      provider_message_id: providerMessageId,
      direction: 'outbound',
      source: 'human',
      body,
      delivery_status: 'sent',
      created_at: createdAt,
      event_type: 'smb_message_echoes'
    });
  }
  return messages;
}

/**
 * Produces only plain-text message rows representable by the current inbox schema.
 * Contact sync, BSUID-only identities, media, edits, revokes, and unmappable status
 * values stay in the raw event archive and are counted without logging their data.
 */
export function normalizeCoexistenceEvents(events: CoexistenceEvent[]): CoexistenceNormalizationResult {
  const result: CoexistenceNormalizationResult = {
    messages: [],
    contact_state_items: 0,
    duplicate_message_ids: 0,
    skipped_by_reason: {}
  };
  const candidates: NormalizedCoexistenceMessage[] = [];

  for (const event of events) {
    const value = isRecord(event.event_payload.value) ? event.event_payload.value : null;
    if (!value) {
      addSkipped(result, 'event_value_invalid');
      continue;
    }
    if (event.event_type === 'history') {
      candidates.push(...normalizeHistoryEvent(event, value, result));
    } else if (event.event_type === 'smb_message_echoes') {
      candidates.push(...normalizeEchoEvent(event, value, result));
    } else if (event.event_type === 'smb_app_state_sync') {
      const stateSync = Array.isArray(value.state_sync) ? value.state_sync : [];
      result.contact_state_items += stateSync.filter((item) => isRecord(item) && item.type === 'contact').length;
      if (stateSync.length === 0) addSkipped(result, 'contact_state_empty');
      else addSkipped(result, 'contact_state_requires_schema', stateSync.length);
    }
  }

  const candidateByKey = new Map<string, NormalizedCoexistenceMessage>();
  for (const candidate of candidates) {
    const key = `${candidate.phone_number_id}\u0000${candidate.provider_message_id}`;
    const previous = candidateByKey.get(key);
    if (!previous) {
      candidateByKey.set(key, candidate);
      continue;
    }
    result.duplicate_message_ids += 1;
    // The dedicated echo carries the clearest meaning for an app-sent message.
    if (candidate.event_type === 'smb_message_echoes' && previous.event_type === 'history') {
      candidateByKey.set(key, candidate);
    }
  }
  result.messages = [...candidateByKey.values()];
  return result;
}

async function resolveVerifiedTenantMapping(supabase: any, phoneNumberId: string): Promise<VerifiedTenantMapping | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('tenant_id,business_verified_at,business_verified_by_user_id')
    .eq('phone_number_id', phoneNumberId)
    .not('tenant_id', 'is', null)
    .limit(1001);

  if (error || !Array.isArray(data)) throw new Error('Verified WhatsApp tenant lookup failed.');
  if (data.length >= 1000) throw new Error('Verified WhatsApp tenant lookup is ambiguous.');

  const verifiedMappings: VerifiedTenantMapping[] = [];
  for (const row of data) {
    if (!isRecord(row)) throw new Error('Verified WhatsApp tenant lookup returned an invalid row.');
    if (typeof row.tenant_id !== 'string' || !UUID_PATTERN.test(row.tenant_id)) {
      throw new Error('Verified WhatsApp tenant lookup returned an invalid tenant.');
    }
    if (typeof row.business_verified_at !== 'string' || Number.isNaN(Date.parse(row.business_verified_at))) {
      throw new Error('Verified WhatsApp tenant mapping lacks verification time.');
    }
    if (typeof row.business_verified_by_user_id !== 'string' || !UUID_PATTERN.test(row.business_verified_by_user_id)) {
      throw new Error('Verified WhatsApp tenant mapping lacks a verifier.');
    }
    verifiedMappings.push({
      tenant_id: row.tenant_id.toLowerCase(),
      business_verified_at: row.business_verified_at,
      business_verified_by_user_id: row.business_verified_by_user_id.toLowerCase()
    });
  }

  const tenantIds = new Set(verifiedMappings.map((mapping) => mapping.tenant_id));
  if (tenantIds.size > 1) throw new Error('WhatsApp phone number maps to multiple verified tenants.');
  return verifiedMappings[0] ?? null;
}

export async function persistNormalizedCoexistenceMessages(
  supabase: any,
  messages: NormalizedCoexistenceMessage[]
): Promise<CoexistenceInboxPersistResult> {
  const result: CoexistenceInboxPersistResult = {
    imported: 0,
    skipped_unverified_tenant: 0,
    duplicate_message_ids: 0
  };
  if (messages.length === 0) return result;

  const tenantByPhone = new Map<string, VerifiedTenantMapping | null>();
  for (const message of messages) {
    if (!tenantByPhone.has(message.phone_number_id)) {
      tenantByPhone.set(message.phone_number_id, await resolveVerifiedTenantMapping(supabase, message.phone_number_id));
    }
  }

  const groups = new Map<string, NormalizedCoexistenceMessage[]>();
  for (const message of messages) {
    const mapping = tenantByPhone.get(message.phone_number_id);
    if (!mapping) {
      result.skipped_unverified_tenant += 1;
      continue;
    }
    const key = `${message.phone_number_id}\u0000${message.customer_wa_id}`;
    const group = groups.get(key) ?? [];
    group.push(message);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const mapping = tenantByPhone.get(first.phone_number_id);
    if (!mapping) continue;
    const latestTimestamp = group.reduce((latest, message) => message.created_at > latest ? message.created_at : latest, group[0].created_at);

    const { error: conversationUpsertError } = await supabase
      .from('whatsapp_conversations')
      .upsert({
        phone_number_id: first.phone_number_id,
        customer_wa_id: first.customer_wa_id,
        tenant_id: mapping.tenant_id,
        business_verified_at: mapping.business_verified_at,
        business_verified_by_user_id: mapping.business_verified_by_user_id,
        last_message_at: latestTimestamp
      }, {
        onConflict: 'phone_number_id,customer_wa_id',
        ignoreDuplicates: true
      });
    if (conversationUpsertError) throw new Error('WhatsApp conversation persistence failed.');

    const { data: conversations, error: conversationLookupError } = await supabase
      .from('whatsapp_conversations')
      .select('id,tenant_id,business_verified_at,business_verified_by_user_id')
      .eq('phone_number_id', first.phone_number_id)
      .eq('customer_wa_id', first.customer_wa_id)
      .limit(2);
    if (conversationLookupError || !Array.isArray(conversations)) {
      throw new Error('WhatsApp conversation lookup failed.');
    }
    if (conversations.length !== 1) throw new Error('WhatsApp conversation lookup is ambiguous.');
    const conversation = conversations[0];
    if (
      !isRecord(conversation)
      || typeof conversation.id !== 'string'
      || conversation.tenant_id !== mapping.tenant_id
      || !conversation.business_verified_at
      || !conversation.business_verified_by_user_id
    ) {
      // Never retrofit tenant verification onto an existing unverified conversation.
      result.skipped_unverified_tenant += group.length;
      continue;
    }

    const rows = group.map((message) => ({
      conversation_id: conversation.id,
      provider_message_id: message.provider_message_id,
      direction: message.direction,
      source: message.source,
      body: message.body,
      delivery_status: message.delivery_status,
      created_at: message.created_at
    }));
    for (const row of rows) {
      const { error: messageInsertError } = await supabase
        .from('whatsapp_messages')
        .insert(row);
      if (!messageInsertError) {
        result.imported += 1;
        continue;
      }
      // The current table's only applicable unique conflict for this shape is
      // provider_message_id; reply_to_message_id is omitted and id is generated.
      if (messageInsertError.code === '23505') {
        result.duplicate_message_ids += 1;
        continue;
      }
      throw new Error('WhatsApp message persistence failed.');
    }
  }
  return result;
}
