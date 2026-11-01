import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPendingItemsForTenant } from '../src/services/db.ts';
import {
  readNonNegativeRevision,
  recordCommittedOrderRevisions,
  isShiftLifecycleAction,
  relatedCashShiftIds,
  relatedOrderNumbers,
  withLatestQueuedRevisions
} from '../src/services/orderSyncRevisions.ts';

test('interpreta revisiones válidas y rechaza negativos, fracciones y valores inseguros', () => {
  assert.equal(readNonNegativeRevision(0), 0);
  assert.equal(readNonNegativeRevision('12'), 12);
  assert.equal(readNonNegativeRevision(-1), null);
  assert.equal(readNonNegativeRevision(1.5), null);
  assert.equal(readNonNegativeRevision(Number.MAX_SAFE_INTEGER + 1), null);
});

test('una operación offline aún no enviada usa la revisión del guardado anterior confirmado', () => {
  const revisions = new Map();
  recordCommittedOrderRevisions('UPDATE_TABLE', { activeOrder: { orderNumber: 'ORD-1' } }, { cloudRevision: 4 }, revisions);

  const queued = { id: 'table-1', activeOrder: { orderNumber: 'ORD-1', cloudRevision: 3, items: [] } };
  const prepared = withLatestQueuedRevisions('UPDATE_TABLE', queued, revisions, false);
  assert.equal(prepared.activeOrder.cloudRevision, 4);
  assert.equal(queued.activeOrder.cloudRevision, 3);
});

test('un resultado de red ambiguo conserva exactamente la revisión original para idempotencia', () => {
  const revisions = new Map([['ORD-1', 5]]);
  const queued = { activeOrder: { orderNumber: 'ORD-1', cloudRevision: 4 } };
  const prepared = withLatestQueuedRevisions('UPDATE_TABLE', queued, revisions, true);
  assert.equal(prepared, queued);
  assert.equal(prepared.activeOrder.cloudRevision, 4);
});

test('la transferencia encadena las dos revisiones y reporta ambos órdenes afectados', () => {
  const revisions = new Map();
  const payload = {
    sourceOrderNumber: 'ORD-A',
    destinationOrderNumber: 'ORD-B',
    expectedSourceRevision: 2,
    expectedDestinationRevision: 7
  };
  const affected = relatedOrderNumbers('TRANSFER_TABLE_ITEM', payload);
  assert.deepEqual(affected, ['ORD-A', 'ORD-B']);

  recordCommittedOrderRevisions('TRANSFER_TABLE_ITEM', payload, {
    sourceRevision: 3,
    destinationRevision: 8
  }, revisions);
  const nextTransfer = withLatestQueuedRevisions('TRANSFER_TABLE_ITEM', payload, revisions, false);
  assert.equal(nextTransfer.expectedSourceRevision, 3);
  assert.equal(nextTransfer.expectedDestinationRevision, 8);
});

test('los pagos y demás operaciones de una comanda quedan bloqueados junto con el orden afectado', () => {
  assert.deepEqual(relatedOrderNumbers('PAYMENT', { orderNumber: 'ORD-P' }), ['ORD-P']);
  assert.deepEqual(relatedOrderNumbers('DEDUCT_INVENTORY', { orderNumber: 'ORD-I' }), ['ORD-I']);
  assert.deepEqual(relatedOrderNumbers('UPDATE_TABLE', { activeOrder: { orderNumber: 'ORD-U' } }), ['ORD-U']);
});


test('las acciones de turno, comanda y traslado se asocian al mismo turno estable', () => {
  assert.deepEqual(relatedCashShiftIds('OPEN_CASH_SHIFT', { shiftId: 'shift-local-1' }), ['shift-local-1']);
  assert.deepEqual(relatedCashShiftIds('CLOSE_CASH_SHIFT', { shiftId: 'shift-local-1' }), ['shift-local-1']);
  assert.deepEqual(relatedCashShiftIds('UPDATE_TABLE', { cashShiftId: 'shift-local-1' }), ['shift-local-1']);
  assert.deepEqual(relatedCashShiftIds('TRANSFER_TABLE_ITEM', { cashShiftId: 'shift-local-1' }), ['shift-local-1']);
  assert.equal(isShiftLifecycleAction('OPEN_CASH_SHIFT'), true);
  assert.equal(isShiftLifecycleAction('TRANSFER_TABLE_ITEM'), false);
});

test('IDs vacíos o ausentes no crean dependencias falsas entre turnos', () => {
  assert.deepEqual(relatedCashShiftIds('TRANSFER_TABLE_ITEM', { cashShiftId: '  ' }), []);
  assert.deepEqual(relatedCashShiftIds('PAYMENT', { cashShiftId: 'shift-local-1' }), []);
});


test('la cola offline conserva apertura → operaciones → cierre mediante secuencia monotónica', () => {
  const timestamp = '2026-11-01T12:00:00.000Z';
  const base = { tenantId: 'tenant-1', synced: false, status: 'PENDING', timestamp };
  const ordered = filterPendingItemsForTenant([
    { ...base, id: 'close', sequence: 400, action: 'CLOSE_CASH_SHIFT', payload: { shiftId: 'shift-1' } },
    { ...base, id: 'transfer', sequence: 300, action: 'TRANSFER_TABLE_ITEM', payload: { cashShiftId: 'shift-1' } },
    { ...base, id: 'update', sequence: 200, action: 'UPDATE_TABLE', payload: { cashShiftId: 'shift-1' } },
    { ...base, id: 'open', sequence: 100, action: 'OPEN_CASH_SHIFT', payload: { shiftId: 'shift-1' } },
    { ...base, id: 'other-tenant', sequence: 50, tenantId: 'tenant-2', action: 'UPDATE_TABLE', payload: {} }
  ], 'tenant-1');
  assert.deepEqual(ordered.map(item => item.id), ['open', 'update', 'transfer', 'close']);
});
