import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addOrIncrementUnsentOrderItem,
  shouldCloseOrderAfterPayment
} from '../src/services/orderItemUtils.ts';

const item = (overrides = {}) => ({
  id: 'item-1',
  name: 'Hamburguesa',
  quantity: 1,
  subAccountId: 1,
  selectedModifiers: [],
  ...overrides
});

test('compone varias adiciones en una misma comanda sin perder unidades', () => {
  let items = [];
  items = addOrIncrementUnsentOrderItem(items, item());
  items = addOrIncrementUnsentOrderItem(items, item({ id: 'item-2' }));
  items = addOrIncrementUnsentOrderItem(items, item({ id: 'item-3' }));

  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 3);
});

test('no combina líneas con modificadores distintos', () => {
  const base = item({ selectedModifiers: [{ modifierName: 'Queso', choiceName: 'Extra', extraPrice: 500 }] });
  const other = item({
    id: 'item-2',
    selectedModifiers: [{ modifierName: 'Cebolla', choiceName: 'Sin cebolla', extraPrice: 0 }]
  });

  const result = addOrIncrementUnsentOrderItem([base], other);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(row => row.quantity), [1, 1]);
});

test('aumentar una línea enviada al KDS agrega o aumenta solo la variante idéntica no enviada', () => {
  const sent = item({ id: 'sent', kdsStatus: 'IN_PREPARATION' });
  const unsentSame = item({ id: 'unsent', quantity: 2 });
  const candidate = item({ id: 'increment', quantity: 3 });

  const result = addOrIncrementUnsentOrderItem([sent, unsentSame], candidate);
  assert.equal(result.length, 2);
  assert.equal(result[0].quantity, 1);
  assert.equal(result[1].quantity, 5);
});

test('una cuenta cierra la orden solo si no quedan artículos de otra cuenta', () => {
  const items = [{ subAccountId: 1 }, { subAccountId: 2 }];

  assert.equal(shouldCloseOrderAfterPayment(items, 1), false);
  assert.equal(shouldCloseOrderAfterPayment([{ subAccountId: 1 }], 1), true);
  assert.equal(shouldCloseOrderAfterPayment(items, 'ALL'), true);
});
