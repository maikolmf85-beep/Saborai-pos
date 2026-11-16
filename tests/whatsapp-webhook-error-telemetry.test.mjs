import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const TEST_APP_SECRET = 'webhook-telemetry-test-secret';
const TEST_ACCESS_TOKEN = 'test-access-token-must-not-be-logged';
const TEST_PHONE_NUMBER_ID = 'test-phone-number-id';
const TEST_MESSAGING_ACCOUNT_ID = '1845701716552385';
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

test('clasifica un detalle permitido sin registrar detalle libre e incluye la cuenta de mensajería en el payload', async () => {
  const allowedDetails = 'The request included one or more unsupported or misspelled parameters.';
  const { response, graphRequest, logLines } = await simulateGraphError({ error_data: { details: allowedDetails } });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { received: true, replied: false });
  assert.deepEqual(graphRequest, {
    url: 'https://graph.facebook.com/v26.0/test-phone-number-id/messages',
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      messaging_account_id: TEST_MESSAGING_ACCOUNT_ID,
      recipient_type: 'individual',
      to: TEST_RECIPIENT,
      type: 'text',
      text: { preview_url: false, body: TEST_REPLY }
    }
  });

  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, {
    code: 100,
    details: allowedDetails,
    detailsClass: 'unsupported_parameter'
  });
  assert.equal(logged.providerError.details, allowedDetails);
  assert.equal(logLines[0].includes(TEST_RECIPIENT), false);
  assert.equal(logLines[0].includes(TEST_REPLY), false);
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
});

test('mantiene como unclassified cualquier detalle no permitido y no registra su contenido', async () => {
  const untrustedDetails = 'recipient 0000000000; message text NEVER-LOG-THIS-DETAIL';
  const { logLines } = await simulateGraphError({ error_data: { details: untrustedDetails } }, 'wamid.telemetry-unknown');

  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, {
    code: 100,
    details: 'recipient [redacted]; message text [redacted]',
    detailsClass: 'unclassified'
  });
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

test('clasifica y conserva solo el texto explicativo redactado de los campos Graph', async () => {
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
    message: 'The parameter messaging_product is required.',
    userTitle: 'Unsupported post request',
    userMessage: 'Object with ID [redacted] does not exist, cannot be loaded due to missing permissions, or does not support this operation.',
    messageClass: 'missing_required_parameter',
    userTitleClass: 'unsupported_request',
    userMessageClass: 'object_unavailable_or_unsupported'
  });
  assert.equal(logLines[0].includes('private-object-84721'), false);
  assert.equal(logLines[0].includes(providerText.error_user_msg), false);
});

test('detecta un campo requerido dentro de texto adicional y conserva el payload de envío sin cambios', async () => {
  const providerText = '(#100) The field messaging_product is required but was not supplied for request OPAQUE-VALUE-9281.';
  const { response, graphRequest, logLines } = await simulateGraphError({ message: providerText }, 'wamid.telemetry-required-field');

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { received: true, replied: false });
  assert.deepEqual(graphRequest, {
    url: 'https://graph.facebook.com/v26.0/test-phone-number-id/messages',
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      messaging_account_id: TEST_MESSAGING_ACCOUNT_ID,
      recipient_type: 'individual',
      to: TEST_RECIPIENT,
      type: 'text',
      text: { preview_url: false, body: TEST_REPLY }
    }
  });
  assert.equal(logLines.length, 1);
  assert.deepEqual(JSON.parse(logLines[0]).providerError, {
    code: 100,
    message: 'The parameter messaging_product is required.',
    messageClass: 'missing_required_parameter'
  });
  assert.equal(logLines[0].includes(providerText), false);
  assert.equal(logLines[0].includes('OPAQUE-VALUE-9281'), false);
  assert.equal(logLines[0].includes(TEST_RECIPIENT), false);
  assert.equal(logLines[0].includes(TEST_REPLY), false);
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
  assert.equal(logLines[0].includes('INBOUND-TEST-NO-PII'), false);
});

test('redacta el nombre de campo requerido no documentado y lo deja unclassified', async () => {
  const providerText = 'The parameter private_unlisted_9281 is required but not available for request OPAQUE-VALUE-1937.';
  const { graphRequest, logLines } = await simulateGraphError({ message: providerText }, 'wamid.telemetry-unknown-required-field');

  assert.deepEqual(graphRequest.body, {
    messaging_product: 'whatsapp',
    messaging_account_id: TEST_MESSAGING_ACCOUNT_ID,
    recipient_type: 'individual',
    to: TEST_RECIPIENT,
    type: 'text',
    text: { preview_url: false, body: TEST_REPLY }
  });
  assert.equal(logLines.length, 1);
  assert.deepEqual(JSON.parse(logLines[0]).providerError, {
    code: 100,
    message: 'The parameter [parameter] is required.',
    messageClass: 'unclassified'
  });
  assert.equal(logLines[0].includes(providerText), false);
  assert.equal(logLines[0].includes('private_unlisted_9281'), false);
  assert.equal(logLines[0].includes('OPAQUE-VALUE-1937'), false);
  assert.equal(logLines[0].includes(TEST_RECIPIENT), false);
  assert.equal(logLines[0].includes(TEST_REPLY), false);
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
  assert.equal(logLines[0].includes('INBOUND-TEST-NO-PII'), false);
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
    message: '[redacted] parameter value [redacted] [redacted].',
    userTitle: '[redacted] [redacted] for [redacted]',
    userMessage: 'Recipient [redacted]: [redacted]',
    messageClass: 'unclassified',
    userTitleClass: 'unclassified',
    userMessageClass: 'unclassified'
  });
  for (const value of Object.values(untrustedFields)) assert.equal(logLines[0].includes(value), false);
  assert.equal(logLines[0].includes('PRIVATE-DETAIL-912'), false);
  assert.equal(logLines[0].includes('private-object-84721'), false);
  assert.equal(logLines[0].includes('+50672061146'), false);
});

test('redacta teléfono, ID, token y fragmento de usuario en los cuatro campos Graph', async () => {
  const sensitiveValues = [
    '+506 7206-1146',
    '998877665544332211',
    'EAAJ_test-token_secret_value1234567890',
    'MAIKOL-ORDER-PRIVATE-88'
  ];
  const { response, graphRequest, logLines } = await simulateGraphError({
    message: 'The parameter messaging_product is required.',
    error_user_title: 'Invalid parameter value',
    error_user_msg: `Recipient ${sensitiveValues[0]}: token ${sensitiveValues[2]}; fragment ${sensitiveValues[3]}; ID ${sensitiveValues[1]}`,
    error_data: {
      details: `The value '${sensitiveValues[0]}' for parameter to is invalid.`
    }
  }, 'wamid.telemetry-sensitive-fixtures');

  assert.equal(response.statusCode, 500);
  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.deepEqual(logged.providerError, {
    code: 100,
    message: 'The parameter messaging_product is required.',
    userTitle: 'Invalid parameter value',
    userMessage: 'Recipient [redacted]: [redacted] [redacted]; [redacted] [redacted]; ID [redacted]',
    details: 'The value [redacted] for parameter to is invalid.',
    messageClass: 'missing_required_parameter',
    userTitleClass: 'invalid_parameter_value',
    userMessageClass: 'unclassified',
    detailsClass: 'unclassified'
  });
  for (const value of sensitiveValues) assert.equal(logLines[0].includes(value), false);
  assert.equal(graphRequest.body.to, TEST_RECIPIENT);
  assert.deepEqual(graphRequest.body.text, { preview_url: false, body: TEST_REPLY });
  assert.equal(logLines[0].includes(TEST_ACCESS_TOKEN), false);
});
