import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';
import {
  extractCoexistenceEvents,
  fingerprintCoexistencePayload,
  persistCoexistenceEvents
} from '../lib/whatsapp/coexistence.ts';

const TEST_APP_SECRET = 'coexistence-test-secret-only';
const previousAppSecret = process.env.META_APP_SECRET;
process.env.META_APP_SECRET = TEST_APP_SECRET;
const { createWebhookHandler } = await import('../api/whatsapp/webhook.ts');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  process.env.META_APP_SECRET = TEST_APP_SECRET;
});

after(() => {
  if (previousAppSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = previousAppSecret;
});

function makeCoexistenceBody() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'business-account-test',
      changes: [
        {
          field: 'history',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'phone-1' },
            history: [{ metadata: { phase: 0, progress: 100 }, threads: [{ id: 'customer-test' }] }]
          }
        },
        {
          field: 'smb_app_state_sync',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'phone-1' },
            state_sync: [{ type: 'contact', action: 'add', contact: { full_name: 'PRIVATE CONTACT NAME' } }]
          }
        },
        {
          field: 'smb_message_echoes',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'phone-1' },
            message_echoes: [{ id: 'message-test', type: 'text', text: { body: 'PRIVATE MESSAGE BODY' } }]
          }
        }
      ]
    }]
  };
}

function makeRequest(rawBody, signature) {
  const request = Readable.from([rawBody]);
  request.method = 'POST';
  request.headers = signature === undefined ? {} : { 'x-hub-signature-256': signature };
  request.query = {};
  return request;
}

function makeTextMessageBody(messageId, text = 'mensaje de prueba') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{
      from: 'recipient-test',
      id: messageId,
      type: 'text',
      text: { body: text }
    }] } }] }]
  };
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

function sign(rawBody) {
  return `sha256=${createHmac('sha256', TEST_APP_SECRET).update(rawBody).digest('hex')}`;
}

function makeSupabase({ conversations = [], upsertError = null } = {}) {
  const lookups = [];
  const upserts = [];
  const client = {
    from(table) {
      assert.ok(['whatsapp_conversations', 'whatsapp_coexistence_events'].includes(table));
      if (table === 'whatsapp_conversations') {
        return {
          select(columns) {
            assert.equal(columns, 'tenant_id');
            return {
              eq(column, value) {
                assert.equal(column, 'phone_number_id');
                return {
                  async limit(limit) {
                    lookups.push({ value, limit });
                    return { data: conversations[value] || [], error: null };
                  }
                };
              }
            };
          }
        };
      }
      return {
        async upsert(rows, options) {
          upserts.push({ rows, options });
          return { error: upsertError };
        }
      };
    }
  };
  return { client, lookups, upserts };
}

test('extrae los tres campos oficiales y crea huellas SHA-256 hexadecimales', () => {
  const result = extractCoexistenceEvents(makeCoexistenceBody());

  assert.equal(result.invalid, false);
  assert.deepEqual(result.events.map((event) => event.event_type), [
    'history', 'smb_app_state_sync', 'smb_message_echoes'
  ]);
  for (const event of result.events) {
    assert.equal(event.phone_number_id, 'phone-1');
    assert.match(event.event_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(event.event_payload.field, event.event_type);
    assert.equal(event.event_payload.value.metadata.phone_number_id, 'phone-1');
  }
});

test('la huella no depende del orden de las propiedades JSON', () => {
  const first = { field: 'history', value: { b: 2, a: { y: 1, x: 0 } } };
  const reordered = { value: { a: { x: 0, y: 1 }, b: 2 }, field: 'history' };

  assert.equal(fingerprintCoexistencePayload(first), fingerprintCoexistencePayload(reordered));
});

test('ignora campos no solicitados y marca inválido un evento reconocido sin phone_number_id', () => {
  const ignored = extractCoexistenceEvents({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {} }] }]
  });
  assert.deepEqual(ignored, { events: [], invalid: false });

  const invalid = extractCoexistenceEvents({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{
      field: 'history',
      value: { messaging_product: 'whatsapp', metadata: {}, history: [] }
    }] }]
  });
  assert.deepEqual(invalid, { events: [], invalid: true });
});

test('resuelve un tenant único y usa la restricción única de la base para hacer upsert idempotente', async () => {
  const events = extractCoexistenceEvents(makeCoexistenceBody()).events;
  const { client, lookups, upserts } = makeSupabase({
    conversations: { 'phone-1': [{ tenant_id: TENANT_A }, { tenant_id: TENANT_A }] }
  });

  await persistCoexistenceEvents(client, events);

  assert.deepEqual(lookups, [{ value: 'phone-1', limit: 1001 }]);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].options, {
    onConflict: 'phone_number_id,event_type,event_fingerprint',
    ignoreDuplicates: true
  });
  assert.ok(upserts[0].rows.every((row) => row.tenant_id === TENANT_A));
  assert.ok(upserts[0].rows.every((row) => /^[a-f0-9]{64}$/.test(row.event_fingerprint)));
});

test('solo usa WHATSAPP_TENANT_ID cuando coincide el phone_number_id configurado', async () => {
  const event = extractCoexistenceEvents(makeCoexistenceBody()).events[0];
  const { client, lookups, upserts } = makeSupabase();

  await persistCoexistenceEvents(client, [event], {
    configuredPhoneNumberId: 'phone-1',
    configuredTenantId: TENANT_A
  });

  assert.deepEqual(lookups, []);
  assert.equal(upserts[0].rows[0].tenant_id, TENANT_A);
});

test('si un número apunta a más de un tenant, falla de forma cerrada y no escribe', async () => {
  const event = extractCoexistenceEvents(makeCoexistenceBody()).events[0];
  const { client, upserts } = makeSupabase({
    conversations: { 'phone-1': [{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }] }
  });

  await assert.rejects(() => persistCoexistenceEvents(client, [event]), /multiple tenants/);
  assert.deepEqual(upserts, []);
});

test('si no hay vínculo de tenant, persiste con tenant_id nulo sin exponerlo a otro tenant', async () => {
  const event = extractCoexistenceEvents(makeCoexistenceBody()).events[0];
  const { client, upserts } = makeSupabase();

  await persistCoexistenceEvents(client, [event]);

  assert.equal(upserts[0].rows[0].tenant_id, null);
});

test('el endpoint exige HMAC válido, persiste los eventos y no registra nombres ni contenido', async () => {
  const body = makeCoexistenceBody();
  const rawBody = Buffer.from(JSON.stringify(body));
  const capturedEvents = [];
  const logs = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  const handler = createWebhookHandler({
    async persistCoexistenceEvents(events) {
      capturedEvents.push(...events);
    }
  });

  try {
    const request = makeRequest(rawBody, sign(rawBody));
    const response = makeResponse();
    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { received: true, coexistenceEvents: 3 });
    assert.equal(capturedEvents.length, 3);
    const serializedLogs = logs.join('\n');
    assert.equal(serializedLogs.includes('PRIVATE CONTACT NAME'), false);
    assert.equal(serializedLogs.includes('PRIVATE MESSAGE BODY'), false);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test('un fallo de persistencia responde 500 para permitir reintento y no filtra errores', async () => {
  const body = makeCoexistenceBody();
  const rawBody = Buffer.from(JSON.stringify(body));
  const logs = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  const handler = createWebhookHandler({
    async persistCoexistenceEvents() {
      throw new Error('PRIVATE DATABASE DETAIL');
    }
  });

  try {
    const request = makeRequest(rawBody, sign(rawBody));
    const response = makeResponse();
    await handler(request, response);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.payload, { error: 'No se pudieron registrar los eventos de coexistencia.' });
    assert.equal(logs.join('\n').includes('PRIVATE DATABASE DETAIL'), false);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test('responde a un mensaje de texto y evita una respuesta duplicada tras una entrega exitosa', async () => {
  const body = makeTextMessageBody('test-message-success');
  const receivedTexts = [];
  const sentReplies = [];
  const handler = createWebhookHandler({
    async generateSupportReply(text) {
      receivedTexts.push(text);
      return 'Respuesta de prueba.';
    },
    async sendWhatsAppText(to, text) {
      sentReplies.push({ to, text });
    }
  });

  const rawBody = Buffer.from(JSON.stringify(body));
  const first = makeResponse();
  await handler(makeRequest(rawBody, sign(rawBody)), first);
  const duplicate = makeResponse();
  await handler(makeRequest(rawBody, sign(rawBody)), duplicate);

  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.payload, { received: true, replied: true });
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.payload, { received: true, duplicate: true });
  assert.deepEqual(receivedTexts, ['mensaje de prueba']);
  assert.deepEqual(sentReplies, [{ to: 'recipient-test', text: 'Respuesta de prueba.' }]);
});

test('permite reintentar el mismo mensaje si falla el envío de la respuesta', async () => {
  const body = makeTextMessageBody('test-message-send-retry');
  let generationCalls = 0;
  let sendCalls = 0;
  const handler = createWebhookHandler({
    async generateSupportReply() {
      generationCalls += 1;
      return 'Respuesta de prueba.';
    },
    async sendWhatsAppText() {
      sendCalls += 1;
      if (sendCalls === 1) throw new Error('detalle privado de prueba');
    }
  });

  const rawBody = Buffer.from(JSON.stringify(body));
  const failed = makeResponse();
  await handler(makeRequest(rawBody, sign(rawBody)), failed);
  const retried = makeResponse();
  await handler(makeRequest(rawBody, sign(rawBody)), retried);

  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.payload, { received: true, replied: false });
  assert.equal(retried.statusCode, 200);
  assert.deepEqual(retried.payload, { received: true, replied: true });
  assert.equal(generationCalls, 2);
  assert.equal(sendCalls, 2);
});

test('registra solo códigos de error de Graph API y no el cuerpo de respuesta ni datos del mensaje', async () => {
  const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const previousPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = 'PRIVATE_TEST_TOKEN';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PRIVATE_TEST_PHONE_NUMBER_ID';

  const logs = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));

  try {
    const handler = createWebhookHandler({
      async generateSupportReply() {
        return 'PRIVATE_REPLY_BODY';
      },
      async graphApiFetch() {
        return new Response(JSON.stringify({
          error: {
            message: 'PRIVATE_PROVIDER_DETAIL',
            type: 'OAuthException',
            code: 130429,
            error_subcode: 909090,
            is_transient: false,
            error_data: { details: 'PRIVATE_PROVIDER_BODY_DETAIL' }
          }
        }), { status: 400 });
      }
    });
    const rawBody = Buffer.from(JSON.stringify(makeTextMessageBody('test-graph-error', 'PRIVATE_USER_MESSAGE')));
    const response = makeResponse();
    await handler(makeRequest(rawBody, sign(rawBody)), response);

    assert.equal(response.statusCode, 500);
    const serializedLogs = logs.join('\n');
    assert.match(serializedLogs, /"statusCode":400,"providerError":\{"code":130429,"subcode":909090,"isTransient":false,"detailsClass":"unclassified"\}/);
    for (const privateValue of [
      'PRIVATE_TEST_TOKEN',
      'PRIVATE_TEST_PHONE_NUMBER_ID',
      'PRIVATE_REPLY_BODY',
      'PRIVATE_USER_MESSAGE',
      'PRIVATE_PROVIDER_DETAIL',
      'PRIVATE_PROVIDER_BODY_DETAIL'
    ]) {
      assert.equal(serializedLogs.includes(privateValue), false);
    }
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    if (previousToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
    if (previousPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhoneNumberId;
  }
});
