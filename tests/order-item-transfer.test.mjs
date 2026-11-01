import test from 'node:test';
import assert from 'node:assert/strict';
import { transferOrderItemAcrossTables } from '../src/services/orderItemTransfer.ts';

const sourceItem = {
  id: 'item-1',
  name: 'Hamburguesa',
  price: 4500,
  quantity: 3,
  subAccountId: 2,
  dinerName: 'Ana',
  notes: 'Sin cebolla',
  cabysCode: '1234567890123',
  taxRate: 0.13,
  category: 'Cocina',
  selectedModifiers: [{ modifierName: 'Término', choiceName: 'Bien cocida', extraPrice: 0 }]
};

const sourceTable = {
  id: 'table-1', number: 1, name: 'Mesa 1', seats: 4, shape: 'square',
  status: 'OCCUPIED', zone: 'Salón', x: 20, y: 20,
  activeOrder: {
    orderNumber: 'ORD-1001', server: 'Luis', openedAt: '10:00',
    subAccounts: [{ id: 1, name: 'Cuenta 1' }, { id: 2, name: 'Ana' }],
    items: [sourceItem]
  }
};

const destinationTable = {
  id: 'table-2', number: 2, name: 'Mesa 2', seats: 2, shape: 'round',
  status: 'OCCUPIED', zone: 'Salón', x: 60, y: 20,
  activeOrder: {
    orderNumber: 'ORD-1002', server: 'Marta', openedAt: '10:05',
    subAccounts: [{ id: 1, name: 'Cuenta 1' }],
    items: []
  }
};

const tables = [sourceTable, destinationTable];

function findTable(result, id) {
  return result.tables.find(table => table.id === id);
}

test('traslada una línea completa a la primera cuenta existente y conserva sus detalles', () => {
  const result = transferOrderItemAcrossTables(tables, [], sourceTable, 'table-2', 'item-1', 3);

  assert.ok(result);
  assert.equal(findTable(result, 'table-1').activeOrder.items.length, 0);
  const moved = findTable(result, 'table-2').activeOrder.items[0];
  assert.equal(moved.id, 'item-1');
  assert.equal(moved.quantity, 3);
  assert.equal(moved.subAccountId, 1);
  assert.equal(moved.dinerName, 'Cuenta 1');
  assert.equal(moved.price, 4500);
  assert.equal(moved.notes, 'Sin cebolla');
  assert.deepEqual(moved.selectedModifiers, sourceItem.selectedModifiers);
  assert.equal(findTable(result, 'table-1').status, 'OCCUPIED');
  assert.equal(findTable(result, 'table-2').activeOrder.orderNumber, 'ORD-1002');
});

test('traslada una cantidad parcial en una línea nueva y deja el saldo en la comanda original', () => {
  const result = transferOrderItemAcrossTables(tables, [], sourceTable, 'table-2', 'item-1', 1);

  assert.ok(result);
  const remaining = findTable(result, 'table-1').activeOrder.items[0];
  const moved = findTable(result, 'table-2').activeOrder.items[0];
  assert.equal(remaining.id, 'item-1');
  assert.equal(remaining.quantity, 2);
  assert.notEqual(moved.id, 'item-1');
  assert.equal(moved.quantity, 1);
  assert.equal(moved.notes, 'Sin cebolla');
  assert.equal(moved.subAccountId, 1);
});

test('no permite destinos sin comanda abierta, la misma mesa ni cantidades inválidas', () => {
  const availableTable = { ...destinationTable, status: 'AVAILABLE', activeOrder: undefined };
  assert.equal(transferOrderItemAcrossTables([sourceTable, availableTable], [], sourceTable, 'table-2', 'item-1', 1), null);
  assert.equal(transferOrderItemAcrossTables(tables, [], sourceTable, 'table-1', 'item-1', 1), null);
  assert.equal(transferOrderItemAcrossTables(tables, [], sourceTable, 'table-2', 'item-1', 0), null);
  assert.equal(transferOrderItemAcrossTables(tables, [], sourceTable, 'table-2', 'item-1', 4), null);
});

test('mueve el renglón KDS con su estado y deja el saldo en el ticket original', () => {
  const item = { ...sourceItem, kdsStatus: 'PENDING', kdsOrderId: 'kds-1' };
  const sourceWithKds = {
    ...sourceTable,
    activeOrder: { ...sourceTable.activeOrder, items: [item] }
  };
  const sourceKdsOrder = {
    id: 'kds-1', tableNumber: 1, tableName: 'Mesa 1', server: 'Luis',
    timestamp: new Date('2026-11-01T10:00:00Z'), status: 'IN_PREPARATION', station: 'Cocina',
    items: [{ id: 'item-1', name: 'Hamburguesa', quantity: 3, notes: 'Sin cebolla', modifiers: ['Bien cocida'], completed: true }]
  };

  const result = transferOrderItemAcrossTables([sourceWithKds, destinationTable], [sourceKdsOrder], sourceWithKds, 'table-2', 'item-1', 1);

  assert.ok(result);
  assert.equal(result.kdsOrders.length, 2);
  const originalTicket = result.kdsOrders.find(order => order.id === 'kds-1');
  const transferTicket = result.kdsOrders.find(order => order.isTransfer);
  assert.equal(originalTicket.items[0].quantity, 2);
  assert.equal(transferTicket.tableName, 'Mesa 2');
  assert.equal(transferTicket.server, 'Marta');
  assert.equal(transferTicket.status, 'IN_PREPARATION');
  assert.equal(transferTicket.items[0].quantity, 1);
  assert.equal(transferTicket.items[0].completed, true);
  assert.equal(result.movedItem.kdsOrderId, transferTicket.id);
  assert.equal(findTable(result, 'table-1').activeOrder.items[0].quantity, 2);
});

test('si se traslada la última línea de un ticket KDS, conserva su registro en la comanda destino', () => {
  const item = { ...sourceItem, quantity: 1, kdsStatus: 'READY', kdsOrderId: 'kds-2' };
  const sourceWithKds = {
    ...sourceTable,
    activeOrder: { ...sourceTable.activeOrder, items: [item] }
  };
  const sourceKdsOrder = {
    id: 'kds-2', tableNumber: 1, tableName: 'Mesa 1', server: 'Luis',
    timestamp: new Date('2026-11-01T10:00:00Z'), status: 'READY', station: 'Cocina',
    items: [{ id: 'item-1', name: 'Hamburguesa', quantity: 1, completed: true }]
  };

  const result = transferOrderItemAcrossTables([sourceWithKds, destinationTable], [sourceKdsOrder], sourceWithKds, 'table-2', 'item-1', 1);

  assert.ok(result);
  assert.equal(result.kdsOrders.some(order => order.id === 'kds-2'), false);
  const transferTicket = result.kdsOrders[0];
  assert.equal(transferTicket.isTransfer, true);
  assert.equal(transferTicket.status, 'READY');
  assert.equal(transferTicket.items[0].id, 'item-1');
});
