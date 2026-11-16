import test from 'node:test';
import assert from 'node:assert/strict';
import { localDB } from '../src/services/db.ts';

const TENANT_ID = '123e4567-e89b-42d3-a456-426614174000';

class MemoryStorage {
  values = new Map();

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

function withFakeBrowser(run) {
  const keys = ['window', 'localStorage', 'navigator', 'fetch'];
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  return Promise.resolve()
    .then(() => run(storage))
    .finally(() => {
      for (const key of keys) {
        const descriptor = descriptors.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });
}

function queueFixture(index, overrides = {}) {
  return {
    id: `synthetic-operation-${index}`,
    action: 'UPDATE_TABLE',
    payload: { id: `synthetic-table-${index}`, name: `Mesa de prueba ${index}`, x: index },
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    tenantId: TENANT_ID,
    actorUserId: 'synthetic-owner-original',
    actorEmployeeId: 'synthetic-employee-original',
    synced: false,
    status: 'PENDING',
    attemptCount: 0,
    description: `Operación sintética ${index}`,
    ...overrides
  };
}

function storeQueueItem(storage, item) {
  storage.setItem(`saborai_sync_queue_${item.id}`, JSON.stringify(item));
}

function restoreQueueItem(storage, itemId) {
  return JSON.parse(storage.getItem(`saborai_sync_queue_${itemId}`));
}

test('sin sesión, conserva las 27 operaciones sintéticas y no las envía', async () => {
  await withFakeBrowser(async storage => {
    localDB.setActiveTenantId(TENANT_ID);
    storage.setItem('saborai_active_tenant_id', TENANT_ID);

    const before = Array.from({ length: 27 }, (_, index) => queueFixture(index + 1));
    before.forEach(item => storeQueueItem(storage, item));
    let fetchCalls = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { fetchCalls += 1; throw new Error('fetch no debe ejecutarse'); }
    });

    const result = await localDB.syncAllPending(TENANT_ID);
    const after = before.map(item => restoreQueueItem(storage, item.id));

    assert.equal(fetchCalls, 0);
    assert.equal(result.syncedCount, 0);
    assert.equal(result.failedCount, 27);
    assert.equal(result.remainingCount, 27);
    assert.equal(after.length, 27);
    for (const [index, item] of after.entries()) {
      assert.equal(item.id, before[index].id);
      assert.equal(item.status, 'FAILED');
      assert.equal(item.synced, false);
      assert.match(item.lastError, /sesión autenticada.*identidad original/i);
      assert.equal(item.actorUserId, 'synthetic-owner-original');
      assert.equal(item.actorEmployeeId, 'synthetic-employee-original');
      assert.deepEqual(item.payload, before[index].payload);
    }
  });
});

test('si difiere el empleado original, el item queda intacto y fetch no se ejecuta', async () => {
  await withFakeBrowser(async storage => {
    localDB.setActiveTenantId(TENANT_ID);
    storage.setItem('saborai_active_tenant_id', TENANT_ID);
    storage.setItem('saborai_token', 'synthetic-valid-token');
    storage.setItem('saborai_account_user_id', 'synthetic-owner-original');
    storage.setItem('saborai_employee_id', 'synthetic-employee-current');

    const original = queueFixture(1);
    storeQueueItem(storage, original);
    let fetchCalls = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { fetchCalls += 1; throw new Error('fetch no debe ejecutarse'); }
    });

    const result = await localDB.syncAllPending(TENANT_ID);
    const after = restoreQueueItem(storage, original.id);

    assert.equal(fetchCalls, 0);
    assert.deepEqual(after, original);
    assert.deepEqual(result, { syncedCount: 0, failedCount: 0, remainingCount: 1 });
  });
});

test('tras recuperar la sesión del actor original, reintenta las 27 operaciones sintéticas sin cambiar su identidad', async () => {
  await withFakeBrowser(async storage => {
    const before = Array.from({ length: 27 }, (_, index) => queueFixture(index + 1));
    before.forEach(item => storeQueueItem(storage, item));
    storage.setItem('saborai_active_tenant_id', TENANT_ID);
    localDB.setActiveTenantId(TENANT_ID);

    let fetchCalls = 0;
    const sentBodies = [];
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { fetchCalls += 1; throw new Error('fetch no debe ejecutarse sin sesión'); }
    });

    const blocked = await localDB.syncAllPending(TENANT_ID);
    assert.equal(blocked.failedCount, 27);
    assert.equal(fetchCalls, 0);

    storage.setItem('saborai_token', 'synthetic-restored-session');
    storage.setItem('saborai_account_user_id', 'synthetic-owner-original');
    storage.setItem('saborai_employee_id', 'synthetic-employee-original');
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (_url, options) => {
        fetchCalls += 1;
        sentBodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({ success: true, result: { accepted: true } }) };
      }
    });
    const result = await localDB.syncPendingAfterSessionRestore(TENANT_ID);
    const after = before.map(item => restoreQueueItem(storage, item.id));

    assert.equal(fetchCalls, 27);
    assert.equal(result.syncedCount, 27);
    assert.equal(result.failedCount, 0);
    assert.equal(result.remainingCount, 0);
    for (const [index, body] of sentBodies.entries()) {
      assert.equal(body.operationId, before[index].id);
      assert.equal(body.tenantId, TENANT_ID);
      assert.equal(body.actorUserId, 'synthetic-owner-original');
      assert.equal(body.actorEmployeeId, 'synthetic-employee-original');
      assert.deepEqual(body.payload, before[index].payload);
    }
    for (const [index, item] of after.entries()) {
      assert.equal(item.status, 'SYNCED');
      assert.equal(item.actorUserId, before[index].actorUserId);
      assert.equal(item.actorEmployeeId, before[index].actorEmployeeId);
      assert.deepEqual(item.payload, before[index].payload);
    }
  });
});

test('recuperar otra identidad no libera el backoff ni envía operaciones ajenas', async () => {
  await withFakeBrowser(async storage => {
    localDB.setActiveTenantId(TENANT_ID);
    storage.setItem('saborai_token', 'synthetic-valid-token');
    storage.setItem('saborai_account_user_id', 'synthetic-owner-original');
    storage.setItem('saborai_employee_id', 'synthetic-employee-current');

    const original = queueFixture(1, {
      status: 'FAILED',
      attemptCount: 3,
      nextAttemptAt: new Date(Date.now() + 60000).toISOString(),
      lastError: 'No hay una sesión autenticada que permita verificar la identidad original.'
    });
    storeQueueItem(storage, original);
    let fetchCalls = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { fetchCalls += 1; throw new Error('fetch no debe ejecutarse'); }
    });

    const result = await localDB.syncPendingAfterSessionRestore(TENANT_ID);
    const after = restoreQueueItem(storage, original.id);

    assert.equal(fetchCalls, 0);
    assert.deepEqual(after, original);
    assert.deepEqual(result, { syncedCount: 0, failedCount: 0, remainingCount: 1 });
  });
});
