import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const TEST_APP_SECRET = 'webhook-telemetry-test-secret';
const TEST_ACCESS_TOKEN = 'test-access-token-must-not-be-logged';
const TEST_PHONE_NUMBER_ID = 'test-phone-number-id';
const TEST_RECIPIENT = '0000000000';
const TEST_REPLY = 'AUTOMATED-REPLY-NO-PII';
const previousEnv = {
  META_APP_SECRET: process.env.META_APP_SECRET,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_API_VERSION: process.env.WHATSAPP_GRAPH_API_VERSION
};

process.env.META_APP_SECRET = TEST_APP_SECRET;
const { createWebhookHandler } = await import('../api/whatsapp/webhook.ts');

beforeEach(() => {
  process.env.META_APP_SECRET = TEST_APP_SECRET;
  process.env.WHATSAPP_ACCESS_TOKEN = TEST_ACCESS_TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = TEST_PHONE_NUMBER_ID;
  process.env.WHATSAPP_GRAPH_API_VERSION = 'v26.0';
});

after(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function makeSignedRequest(messageId) {
  const rawBody = Buffer.from(JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: TEST_RECIPIENT,
            id: messageId,
            type: 'text',
            text: { body: 'INBOUND-TEST-NO-PII' }
          }]
        }
      }]
    }]
  }));
  const signature = createHmac('sha256', TEST_APP_SECRET).update(rawBody).digest('hex');
  const request = Readable.from([rawBody]);
  request.method = 'POST';
  request.headers = { 'x-hub-signature-256': `sha256=${signature}` };
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

async function simulateGraphError(errorFields = {}, messageId = 'wamid.telemetry-test') {
  let graphRequest;
  const logLines = [];
  const originalConsoleError = console.error;
  console.error = (line) => logLines.push(String(line));
  try {
    const handler = createWebhookHandler({
      generateSupportReply: async () => TEST_REPLY,
      graphApiFetch: async (url, init) => {
        graphRequest = {
          url,
          method: init.method,
          body: JSON.parse(init.body)
        };
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              code: 100,
              ...errorFields
            }
          })
        };
      }
    });
    const response = makeResponse();
    await handler(makeSignedRequest(messageId), response);
    return { response, graphRequest, logLines };
  } finally {
    console.error = originalConsoleError;
  }
}

test('clasifica un detalle permitido sin registrar detalle libre ni alterar el formato oficial de envío', async () => {
  const allowedDetails = 'The request included one or more unsupported or misspelled parameters.';
  const { response, graphRequest, logLines } = await simulateGraphError({ error_data: { details: allowedDetails } });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { received: true, replied: false });
  assert.deepEqual(graphRequest, {
    url: 'https://graph.facebook.com/v26.0/test-phone-number-id/messages',
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TEST_RECIPIENT,
      type: 'text',
      text: { preview_url: false, body: TEST_REPLY }
    }
  });

  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, { code: 100, detailsClass: 'unsupported_parameter' });
  assert.equal(logLines[0].includes(allowedDetails), false);
  assert.equal(logLines[0].includes(TEST_RECIPIENT), false);
  assert.equal(logLines[0].includes(TEST_REPLY), false);
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
});

test('mantiene como unclassified cualquier detalle no permitido y no registra su contenido', async () => {
  const untrustedDetails = 'recipient 0000000000; message text NEVER-LOG-THIS-DETAIL';
  const { logLines } = await simulateGraphError({ error_data: { details: untrustedDetails } }, 'wamid.telemetry-unknown');

  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, { code: 100, detailsClass: 'unclassified' });
  assert.equal(logLines[0].includes(untrustedDetails), false);
  assert.equal(logLines[0].includes('NEVER-LOG-THIS-DETAIL'), false);
  assert.equal(logLines[0].includes(TEST_RECIPIENT), false);
  assert.equal(logLines[0].includes(TEST_REPLY), false);
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
});

test('no agrega clasificación cuando Meta no devuelve error_data.details', async () => {
  const { logLines } = await simulateGraphError({}, 'wamid.telemetry-no-details');

  assert.equal(logLines.length, 1);
  assert.deepEqual(JSON.parse(logLines[0]).providerError, { code: 100 });
});

test('clasifica message, user title y user message en categorías fijas sin guardar texto libre', async () => {
  const providerText = {
    message: '(#100) The parameter messaging_product is required.',
    error_user_title: 'Unsupported post request',
    error_user_msg: "Object with ID 'private-object-84721' does not exist, cannot be loaded due to missing permissions, or does not support this operation."
  };
  const { logLines } = await simulateGraphError(providerText, 'wamid.telemetry-allowlisted-fields');

  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, {
    code: 100,
    messageClass: 'missing_required_parameter',
    userTitleClass: 'unsupported_request',
    userMessageClass: 'object_unavailable_or_unsupported'
  });
  for (const value of Object.values(providerText)) assert.equal(logLines[0].includes(value), false);
  assert.equal(logLines[0].includes('private-object-84721'), false);
});

test('clasifica como unclassified los textos no allowlisted y no registra contenido original', async () => {
  const untrustedFields = {
    message: 'Unexpected parameter value containing PRIVATE-DETAIL-912.',
    error_user_title: 'Something failed for private-object-84721',
    error_user_msg: 'Recipient +50672061146: PRIVATE-DETAIL-912'
  };
  const { logLines } = await simulateGraphError(untrustedFields, 'wamid.telemetry-unclassified-fields');

  assert.equal(logLines.length, 1);
  assert.deepEqual(JSON.parse(logLines[0]).providerError, {
    code: 100,
    messageClass: 'unclassified',
    userTitleClass: 'unclassified',
    userMessageClass: 'unclassified'
  });
  for (const value of Object.values(untrustedFields)) assert.equal(logLines[0].includes(value), false);
  assert.equal(logLines[0].includes('PRIVATE-DETAIL-912'), false);
  assert.equal(logLines[0].includes('private-object-84721'), false);
  assert.equal(logLines[0].includes('+50672061146'), false);
});
