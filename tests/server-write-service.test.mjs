import test from 'node:test';
import assert from 'node:assert/strict';
import { writePosOperation } from '../src/services/serverWriteService.ts';

function installBrowserStubs(values, fetchImpl) {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const map = new Map(Object.entries(values));
  globalThis.localStorage = { getItem: key => map.get(key) ?? null };
  globalThis.fetch = fetchImpl;
  return () => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  };
}

test('envía la mutación autenticada con actor esperado y sin rol del cliente', async () => {
  let request;
  const restore = installBrowserStubs({
    saborai_token: 'jwt-from-app',
    saborai_account_user_id: 'owner-uuid',
    saborai_employee_id: 'employee-uuid'
  }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ success: true, result: { saved: true } }), { status: 200 });
  });

  try {
    const result = await writePosOperation('UPSERT_TABLE_RESERVATION', 'tenant-uuid', {
      reservation: { id: 'reservation-uuid' }
    }, { operationId: 'reservation-op-1' });
    assert.deepEqual(result, { saved: true });
    assert.equal(request.url, '/api/pos/write');
    assert.equal(request.options.headers.Authorization, 'Bearer jwt-from-app');
    assert.equal(request.body.action, 'UPSERT_TABLE_RESERVATION');
    assert.equal(request.body.tenantId, 'tenant-uuid');
    assert.equal(request.body.actorUserId, 'owner-uuid');
    assert.equal(request.body.actorEmployeeId, 'employee-uuid');
    assert.equal('role' in request.body, false);
  } finally {
    restore();
  }
});

test('no oculta un rechazo de autorización del servidor', async () => {
  const restore = installBrowserStubs({
    saborai_token: 'jwt-from-app',
    saborai_account_user_id: 'owner-uuid'
  }, async () => new Response(JSON.stringify({ error: 'No tienes permisos.' }), { status: 403 }));

  try {
    await assert.rejects(
      writePosOperation('SAVE_TABLE_LAYOUT', 'tenant-uuid', { layout: [] }),
      /No tienes permisos/
    );
  } finally {
    restore();
  }
});
