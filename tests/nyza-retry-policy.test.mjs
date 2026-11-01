import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGeminiError,
  NYZA_GEMINI_MODELS,
  NYZA_GLOBAL_DEADLINE_MS,
  NYZA_MAX_ATTEMPTS_PER_MODEL,
  NYZA_RETRY_DELAY_MS,
  resolveNyzaDeadlineMs,
  runNyzaModelRequests
} from '../api/_utils/nyzaRetryPolicy.ts';

const apiError = (status, message = 'synthetic provider error') => Object.assign(new Error(message), { status });

test('conserva el orden de los modelos y fija un presupuesto global de 12 segundos', () => {
  assert.deepEqual(NYZA_GEMINI_MODELS, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.equal(NYZA_GLOBAL_DEADLINE_MS, 12_000);
  assert.equal(NYZA_MAX_ATTEMPTS_PER_MODEL, 2);
  assert.equal(NYZA_RETRY_DELAY_MS, 900);
  assert.equal(resolveNyzaDeadlineMs(), 12_000);
  assert.equal(resolveNyzaDeadlineMs(60_000), 12_000);
  assert.equal(resolveNyzaDeadlineMs(1_500), 1_500);
  assert.equal(resolveNyzaDeadlineMs(0), 1);
});

test('clasifica 429, 5xx, límites de tiempo y errores de red como transitorios', () => {
  for (const status of [408, 429, 500, 502, 503, 599]) {
    assert.equal(classifyGeminiError(apiError(status)), 'transient', `HTTP ${status}`);
  }
  assert.equal(classifyGeminiError(Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('network'), { code: 'ECONNRESET' }) })), 'transient');
  assert.equal(classifyGeminiError(Object.assign(new Error('request timed out'), { name: 'TimeoutError' })), 'transient');
  assert.equal(classifyGeminiError(Object.assign(new Error('temporary DNS issue'), { code: 'EAI_AGAIN' })), 'transient');
  assert.equal(classifyGeminiError(Object.assign(new Error('server busy'), { code: 'RESOURCE_EXHAUSTED' })), 'transient');
});

test('no clasifica configuración, autenticación, permisos ni otros 4xx como transitorios', () => {
  for (const status of [400, 401, 403, 404, 422, 499]) {
    assert.equal(classifyGeminiError(apiError(status, 'request timed out')), 'non-transient', `HTTP ${status}`);
  }
  assert.equal(classifyGeminiError(new Error('unknown provider failure')), 'non-transient');
});

test('reintenta únicamente fallos transitorios y limita cada modelo a dos intentos', async () => {
  const calls = [];
  const result = await runNyzaModelRequests(async model => {
    calls.push(model);
    throw apiError(503);
  }, { models: ['primary', 'fallback'], retryDelayMs: 0 });

  assert.deepEqual(calls, ['primary', 'primary', 'fallback', 'fallback']);
  assert.deepEqual(result, { kind: 'failure', failureClass: 'transient', attempts: 4 });
});

test('un 401 detiene el flujo sin reintentar ni probar el modelo alternativo', async () => {
  const calls = [];
  const result = await runNyzaModelRequests(async model => {
    calls.push(model);
    throw apiError(401, 'invalid API key');
  }, { models: ['primary', 'fallback'], retryDelayMs: 0 });

  assert.deepEqual(calls, ['primary']);
  assert.deepEqual(result, { kind: 'failure', failureClass: 'non-transient', attempts: 1 });
  assert.equal(Object.hasOwn(result, 'error'), false);
});

test('una respuesta válida termina sin invocar reintentos ni fallback', async () => {
  const signals = [];
  const result = await runNyzaModelRequests(async (model, signal) => {
    signals.push(signal);
    return { text: 'respuesta sintética' };
  }, { models: ['primary', 'fallback'], retryDelayMs: 0 });

  assert.deepEqual(result, { kind: 'success', model: 'primary', value: { text: 'respuesta sintética' }, attempts: 1 });
  assert.equal(signals.length, 1);
});

test('el deadline global aborta la solicitud activa y no abre otro intento', async () => {
  let observedAbort = false;
  const result = await runNyzaModelRequests((_model, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      observedAbort = true;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  }), { models: ['primary', 'fallback'], deadlineMs: 25, retryDelayMs: 0 });

  assert.deepEqual(result, { kind: 'deadline', attempts: 1 });
  assert.equal(observedAbort, true);
});

test('el mismo deadline cubre la pausa de reintento y bloquea intentos posteriores', async () => {
  let calls = 0;
  const result = await runNyzaModelRequests(async () => {
    calls += 1;
    throw apiError(503);
  }, { models: ['primary', 'fallback'], deadlineMs: 25, retryDelayMs: 100 });

  assert.deepEqual(result, { kind: 'deadline', attempts: 1 });
  assert.equal(calls, 1);
});
