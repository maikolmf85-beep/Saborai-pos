import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OfflineOrderCreateError,
  OFFLINE_ORDER_CREATE_ERROR_CODE,
  OFFLINE_ORDER_CREATE_ERROR_MESSAGE,
  toSafeOfflineOrderCreateFailure
} from '../api/_utils/offlineSyncAttempt.ts';

test('genera una referencia de intento UUID v4 única sin depender de datos del request', () => {
  const first = new OfflineOrderCreateError();
  const second = new OfflineOrderCreateError();

  assert.match(first.attemptRef, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.attemptRef, second.attemptRef);
  assert.equal(first.code, OFFLINE_ORDER_CREATE_ERROR_CODE);
  assert.equal(first.message, OFFLINE_ORDER_CREATE_ERROR_MESSAGE);
});

test('serializa solamente el mensaje fijo, el código saneado y la referencia', () => {
  const failure = new OfflineOrderCreateError();
  Object.assign(failure, {
    cause: new Error('DETALLE_SUPABASE_CON_DATOS_PERSONALES'),
    tenant_id: 'NO_DEBE_SALIR',
    customer_email: 'NO_DEBE_SALIR'
  });

  const response = toSafeOfflineOrderCreateFailure(failure);
  assert.deepEqual(Object.keys(response).sort(), ['attemptRef', 'code', 'error']);
  assert.deepEqual(response, {
    error: OFFLINE_ORDER_CREATE_ERROR_MESSAGE,
    code: 'ORDER_CREATE_FAILED',
    attemptRef: failure.attemptRef
  });
  assert.doesNotMatch(JSON.stringify(response), /DETALLE_SUPABASE|NO_DEBE_SALIR|customer_email/);
});

test('no clasifica errores arbitrarios de Supabase ni propaga su mensaje o código', () => {
  const databaseError = Object.assign(
    new Error('duplicate key; detail: customer email and tenant data'),
    { code: '23505', details: 'sensitive detail' }
  );

  assert.equal(toSafeOfflineOrderCreateFailure(databaseError), null);
});

test('el endpoint solo lanza y registra la excepción saneada para el fallo de inserción de orden', async () => {
  const source = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(orderResult\.error \|\| !orderResult\.data\) throw new OfflineOrderCreateError\(\);/);
  assert.match(source, /const safeOrderFailure = toSafeOfflineOrderCreateFailure\(error\);/);
  assert.match(source, /console\.error\('\[Offline Sync\] Order creation failed:', \{\s*code: safeOrderFailure\.code,\s*attemptRef: safeOrderFailure\.attemptRef\s*\}\);/);
});
