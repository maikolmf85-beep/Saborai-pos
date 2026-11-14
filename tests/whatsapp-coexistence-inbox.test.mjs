import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';
import {
  normalizeCoexistenceEvents,
  persistNormalizedCoexistenceMessages
} from '../lib/whatsapp/coexistenceInbox.ts';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERIFIED_BY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEST_APP_SECRET = 'coexistence-inbox-test-secret-only';
const previousAppSecret = process.env.META_APP_SECRET;
process.env.META_APP_SECRET = TEST_APP_SECRET;
const { createWebhookHandler } = await import('../api/whatsapp/webhook.ts');

beforeEach(() => {
  process.env.META_APP_SECRET = TEST_APP_SECRET;
});

after(() => {
  if (previousAppSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = previousAppSecret;
});

function makeEvent(eventType, value, phoneNumberId = 'business-phone-id') {
  return {
    phone_number_id: phoneNumberId,
    event_type: eventType,
    event_fingerprint: 'a'.repeat(64),
    event_payload: { field: eventType, value }
  };
}

function makeHistoryEvent({ includeUnsupported = true } = {}) {
  const messages = [
    {
      from: '50688887777',
      from_user_id: 'US.1234567890',
      id: 'wamid-inbound-1',
      timestamp: '1739230970',
      type: 'text',
      text: { body: 'MENSAJE PRIVADO DE PRUEBA' },
      history_context: { status: 'READ' }
    },
    {
      from: '50622223333',
      id: 'wamid-outbound-1',
      timestamp: '1739230980',
      type: 'text',
      text: { body: 'RESPUESTA PRIVADA DE PRUEBA' },
      history_context: { status: 'SENT' }
    }
  ];
  if (includeUnsupported) {
    messages.push(
      {
        from: '50622223333',
        id: 'wamid-media-1',
        timestamp: '1739230990',
        type: 'image',
        image: { id: 'media-id' },
        history_context: { status: 'DELIVERED' }
      },
      {
        from: '50622223333',
        id: 'wamid-revoke-1',
        timestamp: '1739231000',
        type: 'revoke',
        revoke: { original_message_id: 'wamid-outbound-1' },
        history_context: { status: 'SENT' }
      }
    );
  }
  return makeEvent('history', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'business-phone-id', display_phone_number: '50622223333' },
    history: [{
      metadata: { phase: 0, chunk_order: 1, progress: 100 },
      threads: [{
        id: '50688887777',
        context: { wa_id: '50688887777', user_id: 'US.1234567890' },
        messages
      }]
    }]
  });
}

function makeEchoEvent() {
  return makeEvent('smb_message_echoes', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'business-phone-id', display_phone_number: '50622223333' },
    contacts: [{ wa_id: '50688887777', user_id: 'US.1234567890' }],
    message_echoes: [{
      from: '50622223333',
      to_user_id: 'US.1234567890',
      id: 'wamid-outbound-1',
      timestamp: '1739230981',
      type: 'text',
      text: { body: 'RESPUESTA PRIVADA DE PRUEBA' }
    }]
  });
}

function makeVerifiedMapping(tenantId = TENANT_A) {
  return {
    id: 'conversation-verification-anchor',
    phone_number_id: 'business-phone-id',
    customer_wa_id: '50600000000',
    tenant_id: tenantId,
    business_verified_at: '2026-01-01T00:00:00.000Z',
    business_verified_by_user_id: VERIFIED_BY
  };
}

function makeFakeSupabase({ mappings = [makeVerifiedMapping()], existingMessages = [] } = {}) {
  const conversations = [...mappings];
  const messages = new Map(existingMessages.map((message) => [message.provider_message_id, { ...message }]));
  const conversationUpserts = [];
  const messageInserts = [];

  const client = {
    from(table) {
      if (table === 'whatsapp_conversations') {
        return {
          select() {
            const filters = {};
            let requireTenant = false;
            const query = {
              eq(column, value) {
                filters[column] = value;
                return query;
              },
              not(column, operator, value) {
                assert.equal(column, 'tenant_id');
                assert.equal(operator, 'is');
                assert.equal(value, null);
                requireTenant = true;
                return query;
              },
              async limit(limit) {
                if (requireTenant) {
                  return {
                    data: conversations
                      .filter((row) => row.phone_number_id === filters.phone_number_id && row.tenant_id !== null)
                      .slice(0, limit),
                    error: null
                  };
                }
                return {
                  data: conversations
                    .filter((row) => row.phone_number_id === filters.phone_number_id && row.customer_wa_id === filters.customer_wa_id)
                    .slice(0, limit),
                  error: null
                };
              }
            };
            return query;
          },
          async upsert(row, options) {
            conversationUpserts.push({ row: { ...row }, options });
            const existing = conversations.find((item) => item.phone_number_id === row.phone_number_id && item.customer_wa_id === row.customer_wa_id);
            if (!existing) conversations.push({ id: `conversation-${conversations.length}`, ...row });
            return { error: null };
          }
        };
      }
      if (table === 'whatsapp_messages') {
        return {
          async insert(row) {
            messageInserts.push({ ...row });
            if (messages.has(row.provider_message_id)) {
              return { error: { code: '23505', constraint: 'whatsapp_messages_provider_id_uidx' } };
            }
            messages.set(row.provider_message_id, { id: `message-${messages.size}`, ...row });
            return { error: null };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  return { client, conversations, messages, conversationUpserts, messageInserts };
}

test('normaliza texto, direcciones y estados representables; prefiere echo y deduplica por ID del proveedor', () => {
  const normalized = normalizeCoexistenceEvents([
    makeHistoryEvent(),
    makeEchoEvent(),
    makeEvent('smb_app_state_sync', {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: 'business-phone-id' },
      state_sync: [{
        type: 'contact',
        action: 'add',
        contact: { full_name: 'NOMBRE PRIVADO DE PRUEBA', user_id: 'US.1234567890', phone_number: '50688887777' },
        metadata: { timestamp: '1739230970' }
      }]
    })
  ]);

  assert.equal(normalized.messages.length, 2);
  const inbound = normalized.messages.find((message) => message.direction === 'inbound');
  assert.deepEqual({ source: inbound.source, status: inbound.delivery_status, phone: inbound.customer_wa_id }, {
    source: 'customer', status: 'received', phone: '50688887777'
  });
  const outbound = normalized.messages.find((message) => message.direction === 'outbound');
  assert.equal(outbound.event_type, 'smb_message_echoes');
  assert.equal(outbound.delivery_status, 'sent');
  assert.equal(outbound.created_at, '2025-02-10T23:43:01.000Z');
  assert.equal(normalized.duplicate_message_ids, 1);
  assert.equal(normalized.contact_state_items, 1);
  assert.equal(normalized.skipped_by_reason.message_action_requires_schema, 1);
  assert.equal(normalized.skipped_by_reason.message_content_not_representable, 1);
  assert.equal(normalized.skipped_by_reason.contact_state_requires_schema, 1);
});

test('no inventa identidad telefónica ni mensajes para contactos, medios o estados no representables', () => {
  const noPhoneHistory = makeEvent('history', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'business-phone-id', display_phone_number: '50622223333' },
    history: [{ threads: [{ context: { user_id: 'US.9999999999' }, messages: [{
      from_user_id: 'US.9999999999', id: 'wamid-no-phone', timestamp: '1739230970', type: 'text', text: { body: 'texto' }
    }] }] }]
  });
  const deliveredHistory = makeEvent('history', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'business-phone-id', display_phone_number: '50622223333' },
    history: [{ threads: [{ id: '50688887777', context: { wa_id: '50688887777', user_id: 'US.1234567890' }, messages: [{
      from: '50622223333', id: 'wamid-delivered', timestamp: '1739230970', type: 'text', text: { body: 'texto' }, history_context: { status: 'READ' }
    }] }] }]
  });
  const contact = makeEvent('smb_app_state_sync', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'business-phone-id' },
    state_sync: [{ type: 'contact', action: 'remove', contact: { user_id: 'US.1234567890' } }]
  });

  const normalized = normalizeCoexistenceEvents([noPhoneHistory, deliveredHistory, contact]);
  assert.equal(normalized.messages.length, 0);
  assert.equal(normalized.skipped_by_reason.customer_phone_missing_or_unusable, 1);
  assert.equal(normalized.skipped_by_reason.provider_status_not_representable, 1);
  assert.equal(normalized.contact_state_items, 1);
});

test('solo importa bajo un tenant verificado y los reintentos no modifican mensajes existentes', async () => {
  const existing = {
    provider_message_id: 'wamid-already-stored',
    body: 'CONTENIDO ORIGINAL QUE NO SE DEBE CAMBIAR',
    direction: 'inbound',
    source: 'customer',
    delivery_status: 'received'
  };
  const fake = makeFakeSupabase({ existingMessages: [existing] });
  const candidates = [
    ...normalizeCoexistenceEvents([makeHistoryEvent({ includeUnsupported: false })]).messages,
    {
      phone_number_id: 'business-phone-id',
      customer_wa_id: '50688887777',
      customer_user_id: 'US.1234567890',
      provider_message_id: 'wamid-already-stored',
      direction: 'inbound',
      source: 'customer',
      body: 'OTRA VERSIÓN QUE NO DEBE REEMPLAZAR LA EXISTENTE',
      delivery_status: 'received',
      created_at: '2025-02-11T06:23:00.000Z',
      event_type: 'history'
    }
  ];

  const first = await persistNormalizedCoexistenceMessages(fake.client, candidates);
  const second = await persistNormalizedCoexistenceMessages(fake.client, candidates);

  assert.equal(first.imported, 2);
  assert.equal(first.duplicate_message_ids, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicate_message_ids, 3);
  assert.equal(fake.messages.get('wamid-already-stored').body, 'CONTENIDO ORIGINAL QUE NO SE DEBE CAMBIAR');
  assert.equal(fake.conversationUpserts.every((call) => call.options.ignoreDuplicates === true), true);
  assert.equal(fake.messageInserts.length, 6);
  assert.equal(fake.conversations.find((row) => row.customer_wa_id === '50688887777').tenant_id, TENANT_A);
});

test('no asigna tenant a partir de una configuración no verificada ni importa con tenant ausente', async () => {
  const fake = makeFakeSupabase({ mappings: [] });
  const candidates = normalizeCoexistenceEvents([makeHistoryEvent({ includeUnsupported: false })]).messages;

  const result = await persistNormalizedCoexistenceMessages(fake.client, candidates);

  assert.equal(result.imported, 0);
  assert.equal(result.skipped_unverified_tenant, candidates.length);
  assert.equal(fake.conversationUpserts.length, 0);
  assert.equal(fake.messageInserts.length, 0);
});

test('falla cerrado si el mismo número está verificado para más de un tenant', async () => {
  const fake = makeFakeSupabase({ mappings: [makeVerifiedMapping(TENANT_A), makeVerifiedMapping(TENANT_B)] });
  const candidates = normalizeCoexistenceEvents([makeHistoryEvent({ includeUnsupported: false })]).messages;

  await assert.rejects(() => persistNormalizedCoexistenceMessages(fake.client, candidates), /multiple verified tenants/);
  assert.equal(fake.conversationUpserts.length, 0);
  assert.equal(fake.messageInserts.length, 0);
});

function makeWebhookRequest(body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac('sha256', TEST_APP_SECRET).update(rawBody).digest('hex')}`;
  const request = Readable.from([rawBody]);
  request.method = 'POST';
  request.headers = { 'x-hub-signature-256': signature };
  request.query = {};
  return request;
}

function makeResponse() {
  return {
    statusCode: undefined,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('un fallo temporal del importador devuelve 500, Meta puede reintentar y los logs no incluyen PII', async () => {
  const body = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'history',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'business-phone-id', display_phone_number: '50622223333' },
          history: [{ threads: [{
            id: '50688887777',
            context: { wa_id: '50688887777', user_id: 'US.1234567890' },
            messages: [{
              from: '50688887777',
              from_user_id: 'US.1234567890',
              id: 'wamid-private-test',
              timestamp: '1739230970',
              type: 'text',
              text: { body: 'CUERPO PRIVADO DE PRUEBA' },
              history_context: { status: 'READ' }
            }]
          }] }]
        }
      }]
    }]
  };
  const logs = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  const rawFingerprints = new Set();
  let rawCalls = 0;
  let inboxCalls = 0;
  const handler = createWebhookHandler({
    async persistCoexistenceEvents(events) {
      rawCalls += 1;
      events.forEach((event) => rawFingerprints.add(event.event_fingerprint));
    },
    async persistNormalizedCoexistenceMessages(messages) {
      inboxCalls += 1;
      assert.equal(messages.length, 1);
      if (inboxCalls === 1) throw new Error('PRIVATE DATABASE DETAIL');
      return { imported: 1, skipped_unverified_tenant: 0 };
    }
  });

  try {
    const failed = makeResponse();
    await handler(makeWebhookRequest(body), failed);
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(failed.payload, { error: 'No se pudieron registrar los eventos de coexistencia.' });

    const retried = makeResponse();
    await handler(makeWebhookRequest(body), retried);
    assert.equal(retried.statusCode, 200);
    assert.deepEqual(retried.payload, { received: true, coexistenceEvents: 1 });
    assert.equal(rawCalls, 2);
    assert.equal(rawFingerprints.size, 1);
    assert.equal(inboxCalls, 2);

    const serializedLogs = logs.join('\n');
    for (const privateValue of ['CUERPO PRIVADO DE PRUEBA', '50688887777', 'PRIVATE DATABASE DETAIL', 'wamid-private-test']) {
      assert.equal(serializedLogs.includes(privateValue), false);
    }
    assert.match(serializedLogs, /"event":"coexistence_inbox_processed"/);
    assert.match(serializedLogs, /"imported":1/);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});
