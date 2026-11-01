import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readNonNegativeRevision,
  recordCommittedOrderRevisions,
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
