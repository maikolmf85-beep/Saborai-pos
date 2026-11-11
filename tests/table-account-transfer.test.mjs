import test from 'node:test';
import assert from 'node:assert/strict';
import { getTransferableZonesForBranch, transferTableAccount } from '../src/services/tableAccountTransfer.ts';

const orderItems = [
  { id: 'item-2', name: 'Café', price: 1200, quantity: 1, category: 'Bar' },
  { id: 'item-1', name: 'Casado', price: 4500, quantity: 2, category: 'Cocina', notes: 'Sin ensalada' }
];
const sourceTable = {
  id: 'table-1', number: 1, name: 'Mesa 1', seats: 4, shape: 'square',
  status: 'OCCUPIED', zone: 'Salón principal', x: 20, y: 30,
  activeOrder: {
    orderNumber: 'ORD-1001', server: 'Luis', openedAt: '10:00',
    subAccounts: [{ id: 1, name: 'Cuenta 1' }, { id: 2, name: 'Ana' }],
    items: orderItems
  }
};
const destinationTable = {
  id: 'table-2', number: 2, name: 'Mesa 2', seats: 2, shape: 'round',
  status: 'AVAILABLE', zone: 'Salón principal', x: 60, y: 30
};
const tables = [sourceTable, destinationTable];
const sameBranchZones = ['Salón principal', 'Terraza'];

test('calcula salones destino únicamente con turnos abiertos de cajas de la misma sucursal', () => {
  const zones = getTransferableZonesForBranch([
    { id: 'register-a', branchCode: '001', linkedZones: ['Salón principal'] },
    { id: 'register-b', branchCode: '001', linkedZones: ['Terraza'] },
    { id: 'register-c', branchCode: '002', linkedZones: ['Patio'] }
  ], [
    { cashRegisterId: 'register-a', status: 'OPEN' },
    { cashRegisterId: 'register-b', status: 'OPEN' },
    { cashRegisterId: 'register-c', status: 'OPEN' }
  ], '001');
  assert.deepEqual(zones.sort(), ['Salón principal', 'Terraza']);
});

function getTable(result, id) {
  return result.tables.find(table => table.id === id);
}

test('traslada la cuenta completa y conserva orden, número, subcuentas y detalles de los productos', () => {
  const result = transferTableAccount(tables, [], 'table-1', 'table-2', sameBranchZones);
  assert.ok(result);
  const source = getTable(result, 'table-1');
  const destination = getTable(result, 'table-2');
  assert.equal(source.status, 'AVAILABLE');
  assert.equal(source.activeOrder, undefined);
  assert.equal(destination.status, 'OCCUPIED');
  assert.equal(destination.activeOrder.orderNumber, 'ORD-1001');
  assert.deepEqual(destination.activeOrder.subAccounts, sourceTable.activeOrder.subAccounts);
  assert.deepEqual(destination.activeOrder.items, orderItems);
  assert.deepEqual(destination.activeOrder.items.map(item => item.id), ['item-2', 'item-1']);
  assert.equal(destination.activeOrder.server, 'Luis');
  assert.equal(destination.activeOrder.openedAt, '10:00');
});

test('conserva estado de pre-cuenta y mueve al KDS solo tickets relacionados con la cuenta', () => {
  const sourceWithPrecheck = { ...sourceTable, status: 'PRE_CHECK' };
  const relatedKds = {
    id: 'kds-1', tableNumber: 1, tableName: 'Mesa 1', server: 'Luis',
    timestamp: new Date('2026-11-11T10:00:00Z'), status: 'IN_PREPARATION', station: 'Cocina',
    items: [{ id: 'item-1', name: 'Casado', quantity: 2 }]
  };
  const unrelatedKds = { ...relatedKds, id: 'kds-old', items: [{ id: 'old-item', name: 'Sopa', quantity: 1 }] };
  const result = transferTableAccount([sourceWithPrecheck, destinationTable], [relatedKds, unrelatedKds], 'table-1', 'table-2', sameBranchZones);
  assert.ok(result);
  assert.equal(getTable(result, 'table-2').status, 'PRE_CHECK');
  assert.equal(result.kdsOrders[0].tableNumber, 2);
  assert.equal(result.kdsOrders[0].tableName, 'Mesa 2');
  assert.equal(result.kdsOrders[0].status, 'IN_PREPARATION');
  assert.deepEqual(result.kdsOrders[1], unrelatedKds);
});

test('rechaza una mesa destino ocupada, reservada, de otro salón o la misma mesa', () => {
  const occupied = { ...destinationTable, status: 'OCCUPIED', activeOrder: { orderNumber: 'ORD-2', items: [] } };
  const reserved = { ...destinationTable, status: 'RESERVED' };
  const otherZone = { ...destinationTable, zone: 'Terraza' };
  assert.equal(transferTableAccount([sourceTable, occupied], [], 'table-1', 'table-2', sameBranchZones), null);
  assert.equal(transferTableAccount([sourceTable, reserved], [], 'table-1', 'table-2', sameBranchZones), null);
  assert.equal(transferTableAccount([sourceTable, otherZone], [], 'table-1', 'table-2', ['Salón principal']), null);
  assert.equal(transferTableAccount(tables, [], 'table-1', 'table-1', sameBranchZones), null);
});

test('permite cambiar de salón dentro de las zonas habilitadas de la misma sucursal', () => {
  const terraceTable = { ...destinationTable, id: 'table-3', number: 3, name: 'Mesa 3', zone: 'Terraza' };
  const result = transferTableAccount([sourceTable, terraceTable], [], 'table-1', 'table-3', sameBranchZones);
  assert.ok(result);
  assert.equal(getTable(result, 'table-3').zone, 'Terraza');
  assert.equal(getTable(result, 'table-3').activeOrder.orderNumber, 'ORD-1001');
});

test('rechaza el traslado desde una mesa sin comanda activa', () => {
  const emptySource = { ...sourceTable, status: 'AVAILABLE', activeOrder: undefined };
  assert.equal(transferTableAccount([emptySource, destinationTable], [], 'table-1', 'table-2', sameBranchZones), null);
});
