import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BETA_FROM,
  BETA_RECIPIENT,
  createBetaSignupHandler as createBetaSignupHandlerCore,
  createRateLimiter,
  validateBetaApplication,
} from '../api/_utils/betaSignup.js';

const validApplication = {
  name: 'Ana Pérez',
  restaurant: 'La Mesa Verde',
  email: 'ana@example.com',
  phone: '+506 8888-1234',
  province: 'San José',
  currentPos: 'Papel o Excel',
  roleConfirmation: true,
  website: '',
};

function createRequest(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      origin: 'https://blog.saborai.site',
      host: 'blog.saborai.site',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.20',
    },
    body: { ...validApplication },
    ...overrides,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createBetaSignupHandler(options = {}) {
  return createBetaSignupHandlerCore({
    rateLimiter: createRateLimiter(),
    ...options,
  });
}

function createMockResend({ domainStatus = 'verified', emailResponse = { id: 'mock-email-id' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://api.resend.com/domains') {
      return {
        ok: true,
        async json() {
          return { data: [{ name: 'saborai.site', status: domainStatus }] };
        },
      };
    }
    if (url === 'https://api.resend.com/emails') {
      return {
        ok: true,
        async json() {
          return emailResponse;
        },
      };
    }
    throw new Error('Unexpected mocked URL');
  };
  return { calls, fetchImpl };
}

async function runHandler(handler, req = createRequest()) {
  const res = createResponse();
  await handler(req, res);
  return res;
}

test('validates required fields, email, Costa Rica province, and role confirmation', () => {
  assert.equal(validateBetaApplication(validApplication).ok, true);
  assert.equal(validateBetaApplication({ ...validApplication, email: 'not-an-email' }).ok, false);
  assert.equal(validateBetaApplication({ ...validApplication, province: 'Otra provincia' }).ok, false);
  assert.equal(validateBetaApplication({ ...validApplication, roleConfirmation: false }).ok, false);
  assert.equal(validateBetaApplication({ ...validApplication, phone: '555\nBcc: someone@example.com' }).ok, false);
  assert.equal(validateBetaApplication({ ...validApplication, phone: '---' }).ok, false);
  assert.equal(validateBetaApplication({ ...validApplication, name: 'x'.repeat(101) }).ok, false);
});

test('rejects non-POST requests and cross-origin requests without calling Resend', async () => {
  const mock = createMockResend();
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl });

  const methodResponse = await runHandler(handler, createRequest({ method: 'GET' }));
  assert.equal(methodResponse.statusCode, 405);
  const originResponse = await runHandler(handler, createRequest({
    headers: { ...createRequest().headers, origin: 'https://attacker.example' },
  }));
  assert.equal(originResponse.statusCode, 403);

  const previewHostResponse = await runHandler(handler, createRequest({
    headers: { ...createRequest().headers, origin: 'https://preview.example', host: 'preview.example' },
  }));
  assert.equal(previewHostResponse.statusCode, 403);

  const headersWithoutIp = { ...createRequest().headers };
  delete headersWithoutIp['x-forwarded-for'];
  const missingIpResponse = await runHandler(handler, createRequest({ headers: headersWithoutIp }));
  assert.equal(missingIpResponse.statusCode, 503);
  assert.equal(mock.calls.length, 0);
});

test('rejects invalid content type, malformed JSON, and oversized payloads', async () => {
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: async () => { throw new Error('must not call provider'); } });

  const invalidContentType = await runHandler(handler, createRequest({ headers: { ...createRequest().headers, 'content-type': 'text/plain' } }));
  const malformedJson = await runHandler(handler, createRequest({ body: '{invalid' }));
  const oversizedPayload = await runHandler(handler, createRequest({ headers: { ...createRequest().headers, 'content-length': '9000' } }));
  assert.equal(invalidContentType.statusCode, 415);
  assert.equal(malformedJson.statusCode, 400);
  assert.equal(oversizedPayload.statusCode, 413);
});

test('silently rejects a filled honeypot before provider calls', async () => {
  const mock = createMockResend();
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl });
  const response = await runHandler(handler, createRequest({ body: { ...validApplication, website: 'bot value' } }));
  assert.equal(response.statusCode, 400);
  assert.equal(mock.calls.length, 0);
});

test('does not call Resend when the server-side API key is absent', async () => {
  let called = false;
  const handler = createBetaSignupHandler({
    getApiKey: () => '',
    fetchImpl: async () => { called = true; throw new Error('must not call provider'); },
  });
  const response = await runHandler(handler);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(called, false);
});

test('requires the exact Resend domain status verified before attempting email send', async () => {
  const mock = createMockResend({ domainStatus: 'pending' });
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl });
  const response = await runHandler(handler);
  assert.equal(response.statusCode, 503);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].options.method, 'GET');
});

test('sends a plain-text notification to SaborAI with the applicant as reply-to only after mock acceptance', async () => {
  const mock = createMockResend();
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl });
  const response = await runHandler(handler);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].url, 'https://api.resend.com/domains');
  assert.equal(mock.calls[0].options.headers.Authorization, 'Bearer test-key');
  const emailRequest = mock.calls[1];
  assert.equal(emailRequest.options.method, 'POST');
  const payload = JSON.parse(emailRequest.options.body);
  assert.equal(payload.from, BETA_FROM);
  assert.deepEqual(payload.to, [BETA_RECIPIENT]);
  assert.equal(payload.reply_to, validApplication.email);
  assert.match(payload.text, /La Mesa Verde/u);
  assert.match(payload.text, /\+506 8888-1234/u);
  assert.equal('html' in payload, false);
});

test('returns an error when the provider rejects the email and does not leak provider details', async () => {
  const mock = createMockResend({ emailResponse: { error: 'private provider error text' } });
  mock.fetchImpl = async (url, options = {}) => {
    mock.calls.push({ url, options });
    if (url.endsWith('/domains')) {
      return { ok: true, async json() { return { data: [{ name: 'saborai.site', status: 'verified' }] }; } };
    }
    return { ok: false, async json() { return { error: 'private provider error text' }; } };
  };
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl });
  const response = await runHandler(handler);
  assert.equal(response.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(response.body), /private provider error text/u);
  assert.doesNotMatch(JSON.stringify(response.body), /ana@example.com/u);
});

test('limits repeated submissions per in-memory client key without persistent storage', async () => {
  let time = 0;
  const rateLimiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time });
  const mock = createMockResend();
  const handler = createBetaSignupHandler({ getApiKey: () => 'test-key', fetchImpl: mock.fetchImpl, rateLimiter });

  const first = await runHandler(handler);
  const second = await runHandler(handler);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(mock.calls.length, 2);

  time = 1001;
  const third = await runHandler(handler);
  assert.equal(third.statusCode, 200);
  assert.equal(mock.calls.length, 4);
});

test('fails closed rather than evicting an active bucket when the in-memory limiter is full', () => {
  const rateLimiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0, maxKeys: 1 });
  assert.equal(rateLimiter('client-a'), true);
  assert.equal(rateLimiter('client-b'), false);
  assert.equal(rateLimiter('client-a'), true);
});
