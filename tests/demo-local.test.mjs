import assert from 'node:assert/strict';
import test from 'node:test';
import { cashControlCloudService } from '../src/services/cashControlCloudService.ts';
import { localDB } from '../src/services/db.ts';
import { posCloudService } from '../src/services/posCloudService.ts';
import { DEMO_TENANT_ID } from '../src/services/demoSeed.ts';
import { getTenantItem, isLocalDemoTenantId, setTenantItem, startCleanDemoSession } from '../src/services/tenantStorage.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

async function withFakeBrowser(callback) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  try {
    return await callback(storage);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
  }
}

test('cada inicio de Demo restaura salones, mesas, menú y cajas, sin borrar datos reales ni legacy', async () => {
  await withFakeBrowser(storage => {
    assert.equal(isLocalDemoTenantId(DEMO_TENANT_ID), true);
    assert.equal(isLocalDemoTenantId('tenant_real_123'), false);

    const firstSeed = startCleanDemoSession(DEMO_TENANT_ID);
    setTenantItem('tables', [{ id: 'demo_table_01', status: 'OCCUPIED' }], DEMO_TENANT_ID);
    setTenantItem('cash_registers', [], DEMO_TENANT_ID);
    setTenantItem('employee_credit_ledger', { transactions: [{ id: 'demo-charge' }] }, DEMO_TENANT_ID);
    setTenantItem('tables', [{ id: 'real-table', status: 'OCCUPIED' }], 'tenant_real_123');
    storage.setItem('saborai_tables', JSON.stringify([{ id: 'legacy-real-table' }]));

    const secondSeed = startCleanDemoSession(DEMO_TENANT_ID);
    assert.deepEqual(getTenantItem('zones', DEMO_TENANT_ID), ['Salón Principal', 'Terraza', 'Barra']);
    assert.deepEqual(getTenantItem('tables', DEMO_TENANT_ID), secondSeed.tables);
    assert.deepEqual(getTenantItem('menu', DEMO_TENANT_ID), secondSeed.menuItems);
    assert.deepEqual(getTenantItem('cash_registers', DEMO_TENANT_ID), secondSeed.cashRegisters);
    assert.deepEqual(getTenantItem('employee_credit_ledger', DEMO_TENANT_ID), null);
    assert.deepEqual(getTenantItem('tables', 'tenant_real_123'), [{ id: 'real-table', status: 'OCCUPIED' }]);
    assert.deepEqual(JSON.parse(storage.getItem('saborai_tables')), [{ id: 'legacy-real-table' }]);
    assert.equal(firstSeed.tables.length, 6);
    assert.equal(secondSeed.cashRegisters.length, 2);
    assert.equal(secondSeed.menuItems.length, 4);
  });
});

test('operaciones Demo son locales, no agregan cola offline y caja diaria no llama a servicios remotos', async () => {
  await withFakeBrowser(async storage => {
    startCleanDemoSession(DEMO_TENANT_ID);
    localDB.setActiveTenantId(DEMO_TENANT_ID);
    storage.setItem('saborai_sync_queue_old_demo', JSON.stringify({ id: 'old', tenantId: 'tenant_demo_1700000000000' }));
    storage.setItem('saborai_tenant_snapshots_tenant_demo_old', JSON.stringify({ tenantId: 'tenant_demo_1700000000000' }));
    storage.setItem('saborai_sync_queue_real', JSON.stringify({ id: 'real', tenantId: 'tenant_real_123' }));

    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('No se esperaba una llamada remota'); };
    await localDB.clearDemoSessionData();
    await localDB.enqueueOfflineAction('PAYMENT', { amount: 1000 }, 'pago demo', DEMO_TENANT_ID);
    const syncResult = await localDB.syncAllPending(DEMO_TENANT_ID);
    const localPayment = await posCloudService.syncOperation('PAYMENT', { amount: 1000 }, DEMO_TENANT_ID);

    const registerId = getTenantItem('cash_registers', DEMO_TENANT_ID)[0].id;
    const closedStatus = await cashControlCloudService.getDailyCashStatus(DEMO_TENANT_ID, registerId);
    const opening = await cashControlCloudService.openDailyCashInCloud(DEMO_TENANT_ID, registerId);
    const openedStatus = await cashControlCloudService.getDailyCashStatus(DEMO_TENANT_ID, registerId);

    assert.equal(fetchCalls, 0);
    assert.equal(cashControlCloudService.isAvailableForTenant(DEMO_TENANT_ID), false);
    assert.equal(closedStatus.isOpen, false);
    assert.equal(opening.cashRegisterId, registerId);
    assert.equal(openedStatus.isOpen, true);
    assert.deepEqual(localPayment, { paymentIds: [] });
    assert.deepEqual(syncResult, { syncedCount: 0, failedCount: 0, remainingCount: 0 });
    assert.equal(storage.getItem('saborai_sync_queue_old_demo'), null);
    assert.equal(storage.getItem('saborai_tenant_snapshots_tenant_demo_old'), null);
    assert.notEqual(storage.getItem('saborai_sync_queue_real'), null);
    assert.equal([...storage.values.keys()].some(key => key.startsWith('saborai_sync_queue_sync_')), false);
    await assert.rejects(cashControlCloudService.getCloudSnapshot(DEMO_TENANT_ID), /sesión es local/);
  });
});

test('un tenant real conserva la ruta normal de sincronización autenticada', async () => {
  await withFakeBrowser(async storage => {
    storage.setItem('saborai_token', 'test-token');
    storage.setItem('saborai_account_user_id', 'test-user');
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ result: { accepted: true } }) };
    };

    const result = await posCloudService.syncOperation('UPDATE_TABLE', { id: 'real-table' }, '123e4567-e89b-42d3-a456-426614174000', 'real-operation');
    assert.equal(result.accepted, true);
    assert.equal(request.url, '/api/offline/sync');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(request.options.body), {
      operationId: 'real-operation',
      tenantId: '123e4567-e89b-42d3-a456-426614174000',
      action: 'UPDATE_TABLE',
      actorUserId: 'test-user',
      actorEmployeeId: null,
      payload: { id: 'real-table' }
    });
  });
});
