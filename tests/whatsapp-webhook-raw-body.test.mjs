import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const TEST_APP_SECRET = 'whatsapp-webhook-test-secret-only';
const previousAppSecret = process.env.META_APP_SECRET;
process.env.META_APP_SECRET = TEST_APP_SECRET;

const { config, default: handler } = await import('../api/whatsapp/webhook.ts');

beforeEach(() => {
  process.env.META_APP_SECRET = TEST_APP_SECRET;
});

after(() => {
  if (previousAppSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = previousAppSecret;
});

function makeRequest(rawBody, signature) {
  const request = Readable.from([rawBody]);
  request.method = 'POST';
  request.headers = signature === undefined ? {} : { 'x-hub-signature-256': signature };
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

function sign(rawBody, secret = TEST_APP_SECRET) {
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

test('desactiva el parser de Vercel para preservar el stream crudo', () => {
  assert.deepEqual(config, { api: { bodyParser: false } });
});

test('acepta una firma calculada sobre los bytes originales y luego parsea JSON', async () => {
  const rawBody = Buffer.from(' {\n  "entry": []\n} \n');
  const request = makeRequest(rawBody, sign(rawBody));
  const response = makeResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { received: true, ignored: true });
});

test('rechaza una firma inválida antes de procesar el evento', async () => {
  const rawBody = Buffer.from('{"entry":[]}');
  const request = makeRequest(rawBody, `sha256=${'0'.repeat(64)}`);
  const response = makeResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.payload, { error: 'Firma de Meta inválida.' });
});

test('falla cerradamente si no está configurado el App Secret', async () => {
  const rawBody = Buffer.from('{"entry":[]}');
  const request = makeRequest(rawBody, sign(rawBody));
  const response = makeResponse();
  delete process.env.META_APP_SECRET;

  await handler(request, response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.payload, { error: 'Firma de Meta inválida.' });
});

test('rechaza JSON malformado solo después de validar su firma', async () => {
  const rawBody = Buffer.from('{');
  const request = makeRequest(rawBody, sign(rawBody));
  const response = makeResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, { error: 'El JSON de la solicitud no es válido.' });
});
