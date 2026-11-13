import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearQuickPaymentAttempt,
  getQuickPaymentAttemptByOperationId,
  getOrCreateQuickPaymentAttempt,
  isQuickPaymentEffectApplied,
  markQuickPaymentEffectApplied,
  quickPaymentOperationIds,
  shouldApplyQuickPaymentLocalEffects
} from '../src/services/quickPaymentAttempt.ts';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  key(index) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

async function withStorage(callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: new MemoryStorage() });
  try { return await callback(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('QuickPayment reusa la misma clave y factura para el mismo intento tras un resultado ambiguo', async () => {
  await withStorage(async () => {
    const seed = { tenantId: 'tenant-1', orderNumber: 'ORD-1', items: [{ id: 'item-1', quantity: 1 }], total: 1500 };
    let invoiceCreations = 0;
    const createInvoice = () => {
      invoiceCreations += 1;
      return { clave: 'clave-estable', consecutivo: 'consecutivo-estable', emissionDate: '2026-11-12T12:00:00.000Z' };
    };
    const first = await getOrCreateQuickPaymentAttempt(seed, createInvoice);
    const retry = await getOrCreateQuickPaymentAttempt(seed, createInvoice);

    assert.equal(invoiceCreations, 1);
    assert.equal(retry.operationId, first.operationId);
    assert.equal(retry.clave, first.clave);
    assert.equal(retry.consecutivo, first.consecutivo);
    assert.equal(retry.emissionDate, first.emissionDate);

    const ids = quickPaymentOperationIds('tenant-1', first.operationId);
    assert.ok(ids.prepare < ids.payment);
    assert.ok(ids.payment < ids.inventory);
    assert.ok(ids.inventory < ids.invoice);
    assert.ok(ids.invoice < ids.complete);
    assert.deepEqual(ids, quickPaymentOperationIds('tenant-1', retry.operationId));
  });
});

test('las proyecciones locales esperan PAYMENT confirmado salvo en Demo local', () => {
  assert.equal(shouldApplyQuickPaymentLocalEffects(false, false), false);
  assert.equal(shouldApplyQuickPaymentLocalEffects(false, true), true);
  assert.equal(shouldApplyQuickPaymentLocalEffects(true, false), true);
});

test('cambios en venta o pagos producen otro intento y los efectos locales no se aplican dos veces', async () => {
  await withStorage(async () => {
    const first = await getOrCreateQuickPaymentAttempt(
      { tenantId: 'tenant-1', orderNumber: 'ORD-1', total: 1000, method: 'CASH' },
      () => ({ clave: 'clave-1', consecutivo: 'cons-1', emissionDate: '2026-11-12T12:00:00.000Z' })
    );
    const changed = await getOrCreateQuickPaymentAttempt(
      { tenantId: 'tenant-1', orderNumber: 'ORD-1', total: 1200, method: 'CASH' },
      () => ({ clave: 'clave-2', consecutivo: 'cons-2', emissionDate: '2026-11-12T12:01:00.000Z' })
    );

    assert.notEqual(changed.operationId, first.operationId);
    assert.equal(isQuickPaymentEffectApplied(first, 'cashShift'), false);
    const marked = markQuickPaymentEffectApplied(first, 'cashShift');
    assert.equal(isQuickPaymentEffectApplied(marked, 'cashShift'), true);
    assert.equal(isQuickPaymentEffectApplied(changed, 'cashShift'), false);
    clearQuickPaymentAttempt(first.storageKey);
    const recreated = await getOrCreateQuickPaymentAttempt(
      { tenantId: 'tenant-1', orderNumber: 'ORD-1', total: 1000, method: 'CASH' },
      () => ({ clave: 'clave-3', consecutivo: 'cons-3', emissionDate: '2026-11-12T12:02:00.000Z' })
    );
    assert.notEqual(recreated.operationId, first.operationId);
  });
});

test('recupera el intento por operationId cuando PAYMENT se confirma después del modal', async () => {
  await withStorage(async () => {
    const attempt = await getOrCreateQuickPaymentAttempt(
      { tenantId: 'tenant-1', orderNumber: 'ORD-ASYNC', total: 2500 },
      () => ({ clave: 'clave-async', consecutivo: 'cons-async', emissionDate: '2026-11-12T12:00:00.000Z' })
    );

    const recovered = getQuickPaymentAttemptByOperationId(attempt.operationId);
    assert.equal(recovered?.storageKey, attempt.storageKey);
    assert.equal(recovered?.fingerprint, attempt.fingerprint);
    assert.equal(getQuickPaymentAttemptByOperationId('missing-operation'), null);
  });
});
