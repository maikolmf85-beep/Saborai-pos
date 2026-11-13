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

test('syncSale registra primero el pago, cierra la mesa después y conserva IDs estables al reintentar', async () => {
  await withFakeBrowser(async storage => {
    storage.setItem('saborai_token', 'test-token');
    storage.setItem('saborai_account_user_id', 'test-user');
    const requests = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ result: { paymentIds: ['payment-1'] } }) };
    };

    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    const tableBeforePayment = {
      id: 'table-1', number: 1, name: 'Mesa 1', zone: 'Principal', seats: 2,
      shape: 'square', status: 'OCCUPIED', x: 10, y: 20,
      activeOrder: { orderNumber: 'ORD-TEST-1', server: 'Caja', items: [{ id: 'item-1', name: 'Café', quantity: 1, price: 500, menuItemId: 'menu-1' }] }
    };
    const sale = {
      table: { ...tableBeforePayment, status: 'AVAILABLE', activeOrder: tableBeforePayment.activeOrder },
      tableBeforePayment,
      invoice: { clave50Digitos: '50612112600310112345600100001010000000001111111111', consecutivo: '00100001010000000001', tipoDocumento: 'TE', totalComprobante: 500, xmlContent: '<Factura/>' },
      paymentMethod: '01-Efectivo', total: 500, closeOrder: true,
      items: [{ name: 'Café', quantity: 1, menuItemId: 'menu-1' }]
    };

    await posCloudService.syncSale(tenantId, sale);
    const firstAttempt = requests.slice(0, 5);
    assert.deepEqual(firstAttempt.map(request => request.action), ['UPDATE_TABLE', 'PAYMENT', 'DEDUCT_INVENTORY', 'UPDATE_TABLE', 'EMIT_INVOICE']);
    assert.equal(firstAttempt[0].payload.status, 'OCCUPIED');
    assert.equal(firstAttempt[1].payload.closeOrder, true);
    assert.equal(firstAttempt[3].payload.status, 'AVAILABLE');
    assert.equal(Object.hasOwn(firstAttempt[3].payload, 'activeOrder'), false);

    await posCloudService.syncSale(tenantId, sale);
    const secondAttempt = requests.slice(5, 10);
    assert.deepEqual(secondAttempt.map(request => request.operationId), firstAttempt.map(request => request.operationId));
    assert.ok(requests.every(request => request.action !== 'HACIENDA_TRANSMIT'));
  });
});

test('un PAYMENT fallido bloquea inventario, factura y cierre de mesa hasta que el pago se confirme', async () => {
  await withFakeBrowser(async storage => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    localDB.setActiveTenantId(tenantId);
    storage.setItem('saborai_active_tenant_id', tenantId);
    storage.setItem('saborai_token', 'test-token');
    storage.setItem('saborai_account_user_id', 'test-user');
    const actions = [];
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      actions.push(request.action);
      if (request.action === 'PAYMENT') {
        return { ok: false, status: 503, json: async () => ({ error: 'respuesta temporal no disponible' }) };
      }
      return { ok: true, json: async () => ({ result: { accepted: true } }) };
    };

    try {
      const prefix = 'quick-payment:123e4567-e89b-42d3-a456-426614174000:attempt-1';
      await localDB.enqueueOfflineAction('UPDATE_TABLE', {
        id: 'table-1', status: 'OCCUPIED', activeOrder: { orderNumber: 'ORD-FAIL-1' }
      }, 'Preparar orden', tenantId, `${prefix}:00-order-prepare`);
      await localDB.enqueueOfflineAction('PAYMENT', { orderNumber: 'ORD-FAIL-1', payments: [{ amount: 1000, method: 'CASH' }] }, 'Registrar pago', tenantId, `${prefix}:01-payment`);
      await localDB.enqueueOfflineAction('DEDUCT_INVENTORY', { orderNumber: 'ORD-FAIL-1', items: [{ menuItemId: 'menu-1', quantity: 1 }] }, 'Descontar inventario', tenantId, `${prefix}:02-inventory`);
      await localDB.enqueueOfflineAction('EMIT_INVOICE', { orderNumber: 'ORD-FAIL-1', clave: 'clave-test', consecutivo: 'cons-test', documentType: 'TE', total: 1000 }, 'Registrar factura', tenantId, `${prefix}:03-invoice`);
      await localDB.enqueueOfflineAction('UPDATE_TABLE', {
        id: 'table-1', status: 'AVAILABLE', orderNumber: 'ORD-FAIL-1'
      }, 'Cerrar mesa después del pago', tenantId, `${prefix}:04-order-complete`);

      const syncResult = await localDB.syncAllPending(tenantId);
      assert.deepEqual(actions, ['UPDATE_TABLE', 'PAYMENT']);
      assert.equal(syncResult.failedCount, 1);
      const queue = await localDB.getAllItems('sync_queue');
      assert.equal(queue.find(item => item.id === `${prefix}:01-payment`).status, 'FAILED');
      assert.equal(queue.find(item => item.id === `${prefix}:02-inventory`).status, 'PENDING');
      assert.equal(queue.find(item => item.id === `${prefix}:03-invoice`).status, 'PENDING');
      assert.equal(queue.find(item => item.id === `${prefix}:04-order-complete`).status, 'PENDING');

      // Mientras el PAYMENT espera backoff, la cola no puede adelantar factura/inventario.
      await localDB.syncAllPending(tenantId);
      assert.deepEqual(actions, ['UPDATE_TABLE', 'PAYMENT']);
      const retryQueue = await localDB.getAllItems('sync_queue');
      assert.equal(retryQueue.find(item => item.id === `${prefix}:02-inventory`).status, 'PENDING');
      assert.equal(retryQueue.find(item => item.id === `${prefix}:03-invoice`).status, 'PENDING');
      assert.equal(retryQueue.find(item => item.id === `${prefix}:04-order-complete`).status, 'PENDING');
    } finally {
      localDB.setActiveTenantId('');
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
    }
  });
});

test('el replay de QuickPayment confirma PAYMENT antes de factura y cierre de mesa', async () => {
  await withFakeBrowser(async storage => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    localDB.setActiveTenantId(tenantId);
    storage.setItem('saborai_active_tenant_id', tenantId);
    storage.setItem('saborai_token', 'test-token');
    storage.setItem('saborai_account_user_id', 'test-user');
    const actions = [];
    const requestBodies = [];
    const paymentEvents = [];
    const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
    if (typeof globalThis.CustomEvent !== 'function') {
      Object.defineProperty(globalThis, 'CustomEvent', {
        configurable: true,
        value: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
      });
    }
    globalThis.window.dispatchEvent = event => { paymentEvents.push(event); return true; };
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      requestBodies.push(request);
      actions.push(request.action);
      return {
        ok: true,
        json: async () => ({ result: request.action === 'PAYMENT' ? { paymentIds: ['payment-confirmed'] } : { accepted: true } })
      };
    };

    try {
      const prefix = 'quick-payment:123e4567-e89b-42d3-a456-426614174000:attempt-success';
      const clientMetadata = { quickPayment: { tenantId, operationId: 'attempt-success', cashShift: { cashAmount: 1000 } } };
      await localDB.enqueueOfflineAction('UPDATE_TABLE', {
        id: 'table-1', status: 'OCCUPIED', activeOrder: { orderNumber: 'ORD-SUCCESS-1' }
      }, 'Preparar orden', tenantId, `${prefix}:00-order-prepare`);
      await localDB.enqueueOfflineAction('PAYMENT', { orderNumber: 'ORD-SUCCESS-1', payments: [{ amount: 1000, method: 'CASH' }] }, 'Registrar pago', tenantId, `${prefix}:01-payment`, clientMetadata);
      await localDB.enqueueOfflineAction('DEDUCT_INVENTORY', { orderNumber: 'ORD-SUCCESS-1', items: [{ menuItemId: 'menu-1', quantity: 1 }] }, 'Descontar inventario', tenantId, `${prefix}:02-inventory`);
      await localDB.enqueueOfflineAction('EMIT_INVOICE', { orderNumber: 'ORD-SUCCESS-1', clave: 'clave-test', consecutivo: 'cons-test', documentType: 'TE', total: 1000 }, 'Registrar factura', tenantId, `${prefix}:03-invoice`);
      await localDB.enqueueOfflineAction('UPDATE_TABLE', {
        id: 'table-1', status: 'AVAILABLE', orderNumber: 'ORD-SUCCESS-1'
      }, 'Cerrar mesa después del pago', tenantId, `${prefix}:04-order-complete`);

      await localDB.syncAllPending(tenantId);
      assert.deepEqual(actions, ['UPDATE_TABLE', 'PAYMENT', 'DEDUCT_INVENTORY', 'EMIT_INVOICE', 'UPDATE_TABLE']);
      const queue = await localDB.getAllItems('sync_queue');
      assert.ok(queue.filter(item => item.id.startsWith(prefix)).every(item => item.status === 'SYNCED' && item.synced));
      assert.equal(paymentEvents.length, 1);
      assert.equal(paymentEvents[0].type, 'saborai_payment_synced');
      assert.deepEqual(paymentEvents[0].detail.clientMetadata, clientMetadata);
      const paymentRequest = requestBodies.find(request => request.action === 'PAYMENT');
      assert.equal(Object.hasOwn(paymentRequest, 'clientMetadata'), false);
    } finally {
      localDB.setActiveTenantId('');
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      if (previousCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', previousCustomEvent);
      else delete globalThis.CustomEvent;
    }
  });
});

test('enqueueOfflineAction falla en forma cerrada si la cola no se puede persistir', async () => {
  await withFakeBrowser(async storage => {
    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    localDB.setActiveTenantId(tenantId);
    storage.setItem('saborai_active_tenant_id', tenantId);
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error('quota exceeded'); };
    try {
      await assert.rejects(
        localDB.enqueueOfflineAction('PAYMENT', { orderNumber: 'ORD-QUOTA', payments: [{ amount: 500, method: 'CASH' }] }, 'Pago', tenantId, 'quick-payment:test:01-payment'),
        /No se pudo guardar la operación en la cola local/
      );
    } finally {
      storage.setItem = originalSetItem;
      localDB.setActiveTenantId('');
    }
  });
});
