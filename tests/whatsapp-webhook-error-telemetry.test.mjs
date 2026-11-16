import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const TEST_APP_SECRET = 'webhook-telemetry-test-secret';
const TEST_ACCESS_TOKEN = 'test-access-token-must-not-be-logged';
const TEST_GEMINI_KEY = 'test-gemini-key-must-not-be-logged';
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
let requestCounter = 0;

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
  delete process.env.GEMINI_API_KEY;
});

function makeSignedRequest(messageId = `wamid.telemetry-${++requestCounter}`) {
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

function captureLogs() {
  const lines = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map(String).join(' '));
  return {
    lines,
    restore() {
      console.info = originalInfo;
      console.error = originalError;
    }
  };
}

async function simulateGraphError(errorFields = {}) {
  let graphRequest;
  const captured = captureLogs();
  try {
    const handler = createWebhookHandler({
      generateSupportReply: async () => TEST_REPLY,
      graphApiFetch: async (url, init) => {
        graphRequest = {
          url,
          method: init.method,
          headers: init.headers,
          body: JSON.parse(init.body),
          signal: init.signal
        };
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { code: 100, ...errorFields } })
        };
      }
    });
    const response = makeResponse();
    await handler(makeSignedRequest(), response);
    return { response, graphRequest, logLines: [...captured.lines] };
  } finally {
    captured.restore();
  }
}

function getEvents(logLines) {
  return logLines.map((line) => JSON.parse(line));
}

function assertNoSensitiveFixture(logLines, values) {
  const combined = logLines.join('\n');
  for (const value of values) assert.equal(combined.includes(value), false, `sensitive fixture leaked: ${value}`);
}

test('Graph logs only status, numeric codes, classes and allowlisted parameter names; preserves the send request', async () => {
  const rawMessage = '(#100) The parameter messaging_account_id is required for PRIVATE-OBJECT-84721; phone +50672061146; token EAAJ_test-token_secret_value1234567890';
  const rawDetails = 'PRIVATE-DETAIL-912 email servicio@example.test fbtrace_id=FBTRACE-PRIVATE-8821';
  const rawUserMessage = 'Recipient +50672061146 PRIVATE-DETAIL-912';
  const { response, graphRequest, logLines } = await simulateGraphError({
    error_subcode: 33,
    message: rawMessage,
    error_user_title: 'Unsupported request for PRIVATE-OBJECT-84721',
    error_user_msg: rawUserMessage,
    error_data: { details: rawDetails },
    fbtrace_id: 'FBTRACE-PRIVATE-8821',
    is_transient: true
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { received: true, replied: false });
  assert.equal(graphRequest.url, 'https://graph.facebook.com/v26.0/test-phone-number-id/messages');
  assert.equal(graphRequest.method, 'POST');
  assert.deepEqual(graphRequest.headers, {
    Authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  });
  assert.ok(graphRequest.signal instanceof AbortSignal);
  assert.deepEqual(graphRequest.body, {
    messaging_product: 'whatsapp',
    messaging_account_id: TEST_MESSAGING_ACCOUNT_ID,
    recipient_type: 'individual',
    to: TEST_RECIPIENT,
    type: 'text',
    text: { preview_url: false, body: TEST_REPLY }
  });

  const failure = getEvents(logLines).find((event) => event.event === 'reply_send_failed');
  assert.ok(failure);
  assert.equal(failure.statusCode, 400);
  assert.deepEqual(failure.providerError, {
    code: 100,
    subcode: 33,
    messageClass: 'missing_required_parameter',
    detailsClass: 'unclassified',
    parameters: ['messaging_account_id']
  });
  assertNoSensitiveFixture(logLines, [
    rawMessage,
    rawDetails,
    rawUserMessage,
    'PRIVATE-OBJECT-84721',
    'PRIVATE-DETAIL-912',
    '+50672061146',
    'EAAJ_test-token_secret_value1234567890',
    'servicio@example.test',
    'FBTRACE-PRIVATE-8821',
    TEST_RECIPIENT,
    TEST_REPLY,
    TEST_ACCESS_TOKEN,
    'INBOUND-TEST-NO-PII'
  ]);
});

test('Graph ignores unallowlisted parameter names and never logs provider text or transient flags', async () => {
  const rawMessage = 'The parameter private_unlisted_9281 is required for OPAQUE-VALUE-1937';
  const { logLines } = await simulateGraphError({
    error_subcode: 7,
    message: rawMessage,
    error_data: { details: 'secret detail PII-PRIVATE-114' },
    is_transient: false
  });

  const failure = getEvents(logLines).find((event) => event.event === 'reply_send_failed');
  assert.ok(failure);
  assert.deepEqual(failure.providerError, {
    code: 100,
    subcode: 7,
    messageClass: 'unclassified',
    detailsClass: 'unclassified'
  });
  assertNoSensitiveFixture(logLines, [rawMessage, 'private_unlisted_9281', 'OPAQUE-VALUE-1937', 'secret detail', 'PII-PRIVATE-114']);
});

test('Gemini sin clave registra solo ausencia de clave y mantiene el fallback existente', async () => {
  delete process.env.GEMINI_API_KEY;
  let contentCalls = 0;
  const sent = [];
  const captured = captureLogs();
  try {
    const handler = createWebhookHandler({
      generateGeminiContent: async () => {
        contentCalls += 1;
        throw new Error('this should not be called');
      },
      sendWhatsAppText: async (to, text) => sent.push({ to, text })
    });
    const response = makeResponse();
    await handler(makeSignedRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { received: true, replied: true });
    assert.equal(contentCalls, 0);
    assert.deepEqual(sent, [{
      to: TEST_RECIPIENT,
      text: 'En este momento el soporte inteligente no está configurado. Por favor, deja tu mensaje y un integrante de Saborai te ayudará pronto.'
    }]);
    const diagnostic = getEvents(captured.lines).find((event) => event.event === 'reply_generation_failed');
    assert.ok(diagnostic);
    assert.deepEqual(diagnostic.gemini, {
      apiKeyPresent: false,
      model: 'not_attempted',
      timedOut: false,
      timeoutMs: 0,
      generationTimeoutMs: 9000,
      maxAttemptsPerModel: 0,
      retryCount: 0
    });
    assertNoSensitiveFixture(captured.lines, [TEST_RECIPIENT, TEST_ACCESS_TOKEN, 'INBOUND-TEST-NO-PII']);
  } finally {
    captured.restore();
  }
});

test('Gemini registra cada modelo con status/código allowlisted, timeout y retry; no filtra errores ni prompt', async () => {
  process.env.GEMINI_API_KEY = TEST_GEMINI_KEY;
  const rawErrorMessage = 'private provider detail +50672061146 PRIVATE-GEMINI-ERROR-471';
  const calls = [];
  const sent = [];
  const fakeError = Object.assign(new Error(rawErrorMessage), {
    status: 429,
    code: 'QUOTA_EXCEEDED',
    response: { status: 429 },
    stack: `Error: ${rawErrorMessage}`
  });
  const captured = captureLogs();
  try {
    const handler = createWebhookHandler({
      generateGeminiContent: async (request) => {
        calls.push({
          model: request.model,
          timeout: request.config.httpOptions.timeout,
          attempts: request.config.httpOptions.retryOptions.attempts,
          maxOutputTokens: request.config.maxOutputTokens
        });
        throw fakeError;
      },
      sendWhatsAppText: async (to, text) => sent.push({ to, text })
    });
    const response = makeResponse();
    await handler(makeSignedRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { received: true, replied: true });
    assert.deepEqual(calls, [
      { model: 'gemini-3.8-flash', timeout: 7000, attempts: 1, maxOutputTokens: 512 },
      { model: 'gemini-3.5-flash-lite', timeout: 7000, attempts: 1, maxOutputTokens: 512 }
    ]);
    assert.deepEqual(sent, [{
      to: TEST_RECIPIENT,
      text: 'Recibí tu mensaje, pero Nyza está temporalmente ocupada. Intenta nuevamente en unos minutos o deja el detalle del problema para que soporte humano lo revise.'
    }]);

    const attempts = getEvents(captured.lines).filter((event) => event.event === 'gemini_attempt_failed');
    assert.equal(attempts.length, 2);
    for (const [index, event] of attempts.entries()) {
      assert.deepEqual(event.gemini, {
        apiKeyPresent: true,
        model: calls[index].model,
        httpStatus: 429,
        errorCode: 'quota_exceeded',
        timedOut: false,
        timeoutMs: 7000,
        generationTimeoutMs: 9000,
        maxAttemptsPerModel: 1,
        retryCount: 0
      });
    }
    assertNoSensitiveFixture(captured.lines, [
      TEST_GEMINI_KEY,
      rawErrorMessage,
      'PRIVATE-GEMINI-ERROR-471',
      '+50672061146',
      TEST_RECIPIENT,
      TEST_ACCESS_TOKEN,
      'INBOUND-TEST-NO-PII'
    ]);
  } finally {
    captured.restore();
    delete process.env.GEMINI_API_KEY;
  }
});

test('Gemini marca timeout y mantiene redacciones cuando un modelo responde correctamente', async () => {
  process.env.GEMINI_API_KEY = TEST_GEMINI_KEY;
  const calls = [];
  const sent = [];
  const timeoutError = Object.assign(new Error('PRIVATE-TIMEOUT-DETAIL-717'), {
    name: 'TimeoutError',
    code: 'ETIMEDOUT',
    stack: 'PRIVATE-STACK-928'
  });
  const captured = captureLogs();
  try {
    const handler = createWebhookHandler({
      generateGeminiContent: async (request) => {
        calls.push(request.model);
        if (calls.length === 1) throw timeoutError;
        return { text: 'GEMINI-REPLY-TEST-NO-PII' };
      },
      sendWhatsAppText: async (to, text) => sent.push({ to, text })
    });
    const response = makeResponse();
    await handler(makeSignedRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { received: true, replied: true });
    assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    assert.deepEqual(sent, [{ to: TEST_RECIPIENT, text: 'GEMINI-REPLY-TEST-NO-PII' }]);
    const event = getEvents(captured.lines).find((item) => item.event === 'gemini_attempt_failed');
    assert.ok(event);
    assert.deepEqual(event.gemini, {
      apiKeyPresent: true,
      model: 'gemini-3.8-flash',
      timedOut: true,
      timeoutMs: 7000,
      generationTimeoutMs: 9000,
      maxAttemptsPerModel: 1,
      retryCount: 0
    });
    assertNoSensitiveFixture(captured.lines, [
      TEST_GEMINI_KEY,
      'PRIVATE-TIMEOUT-DETAIL-717',
      'PRIVATE-STACK-928',
      'GEMINI-REPLY-TEST-NO-PII',
      TEST_RECIPIENT,
      'INBOUND-TEST-NO-PII'
    ]);
  } finally {
    captured.restore();
    delete process.env.GEMINI_API_KEY;
  }
});
