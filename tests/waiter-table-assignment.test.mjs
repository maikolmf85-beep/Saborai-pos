import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getAssignableTableWaiters, assignTableWaiter } from '../src/services/waiterTableAssignment.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tableMapSource = read('../src/components/TableMap.tsx');
const assignmentModalSource = read('../src/components/WaiterAssignmentModal.tsx');
const waiterPinModalSource = read('../src/components/WaiterPinModal.tsx');
const switchModalSource = read('../src/components/QuickWaiterSwitchModal.tsx');
const appSource = read('../src/App.tsx');

const staff = (id, role, overrides = {}) => ({
  id,
  name: `Persona ${id}`,
  email: `${id}@example.invalid`,
  phone: `+506 0000-${id}`,
  restaurantName: 'SaborAI',
  role,
  active: true,
  ...overrides
});

const table = (overrides = {}) => ({
  id: 'table-1',
  number: 1,
  name: 'Mesa 1',
  seats: 4,
  shape: 'round',
  status: 'AVAILABLE',
  zone: 'Salón',
  x: 20,
  y: 30,
  ...overrides
});

test('la lista de asignación incluye solo saloneros activos, sin roles de caja o administración', () => {
  const currentUser = staff('current-waiter', 'WAITER');
  const eligible = getAssignableTableWaiters([
    staff('waiter', 'SALONERO'),
    staff('legacy-waiter', 'WAITER'),
    staff('inactive', 'SALONERO', { active: false }),
    staff('cashier', 'CAJERO'),
    staff('waiter-cashier', 'SALONERO_CAJA'),
    staff('admin', 'ADMIN')
  ], currentUser);

  assert.deepEqual(eligible.map((person) => person.id), ['waiter', 'legacy-waiter', 'current-waiter']);
  assert.deepEqual(eligible.map((person) => person.role), ['SALONERO', 'WAITER', 'WAITER']);
});

test('la primera asignación crea la comanda sin PIN y solo cambia el salonero de mesa', () => {
  const waiter = staff('waiter', 'SALONERO');
  const originalTable = table();
  const assignedTable = assignTableWaiter(originalTable, waiter, {
    orderNumber: 'ORD-1234',
    openedAt: '08:15 p. m.'
  });

  assert.equal(assignedTable.status, 'OCCUPIED');
  assert.deepEqual(assignedTable.activeOrder, {
    orderNumber: 'ORD-1234',
    server: waiter.name,
    openedAt: '08:15 p. m.',
    subAccounts: [{ id: 1, name: 'Cuenta 1' }],
    items: []
  });
  assert.equal(originalTable.activeOrder, undefined);
  assert.equal(waiter.role, 'SALONERO');
  assert.equal(assignedTable.activeOrder.server, waiter.name);
});

test('asignar un salonero a una comanda existente conserva cuenta, artículos y estado', () => {
  const existingOrder = {
    orderNumber: 'ORD-8800',
    server: 'Mesero General',
    openedAt: '07:10 p. m.',
    subAccounts: [{ id: 2, name: 'Cuenta 2' }],
    items: [{ id: 'item-1', name: 'Casado', price: 3500, quantity: 1 }]
  };
  const existingTable = table({ status: 'PRE_CHECK', activeOrder: existingOrder });
  const assignedTable = assignTableWaiter(existingTable, staff('waiter', 'SALONERO'));

  assert.equal(assignedTable.status, 'PRE_CHECK');
  assert.equal(assignedTable.activeOrder.orderNumber, 'ORD-8800');
  assert.equal(assignedTable.activeOrder.server, 'Persona waiter');
  assert.equal(assignedTable.activeOrder.openedAt, '07:10 p. m.');
  assert.deepEqual(assignedTable.activeOrder.subAccounts, existingOrder.subAccounts);
  assert.deepEqual(assignedTable.activeOrder.items, existingOrder.items);
});

test('el selector inicial es una selección de nombre sin PIN, PII ni activación de sesión', () => {
  assert.match(assignmentModalSource, /onClick=\{\(\) => onSelectWaiter\(staff\)\}/);
  assert.match(assignmentModalSource, /getAssignableTableWaiters\(staffList, currentUser\)/);
  assert.doesNotMatch(assignmentModalSource, /\bpin\b|onAuthenticateStaff|activateStaffSession|createEmployeeSession|\bemail\b|\bphone\b/i);
  assert.match(tableMapSource, /needsInitialAssignment/);
  assert.match(tableMapSource, /onSelectWaiter=\{handleWaiterAssigned\}/);
  const assignmentHandler = tableMapSource.match(/const handleWaiterAssigned = \(staff: UserProfile\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.ok(assignmentHandler);
  assert.doesNotMatch(assignmentHandler, /onAuthenticateStaff|handleSwitchWaiter|activateStaffSession/);
  assert.match(tableMapSource, /onAuthenticateStaff\(staff, pin\)/);
  assert.match(tableMapSource, /onSelectWaiter=\{handleWaiterAssigned\}/);
  assert.match(waiterPinModalSource, /eligibleStaff = staffList\.filter\(isAssignableTableWaiter\)/);
  assert.match(waiterPinModalSource, /onConfirm\(selectedStaff, inputPin\)/);
});

test('cambiar de usuario sigue enviando el PIN y no conserva atajos sin PIN', () => {
  assert.match(switchModalSource, /if \(nextPin\.length === 4\)\s*\{\s*validatePin\(nextPin\);/);
  assert.match(switchModalSource, /await onSwitchUser\(selectedStaff, inputPin\)/);
  assert.match(switchModalSource, /onSwitchUser: \(staff: UserProfile, pin: string\)/);
  assert.match(switchModalSource, /await onSwitchUser\(newMember, newPin\)/);
  assert.doesNotMatch(switchModalSource, /saborai_fast_user_switch_no_pin|Entrar directo sin digitar PIN|onSwitchUser\((?:staff|newMember)\)/);
  assert.match(appSource, /const handleSwitchWaiter = async \(staff: UserProfile, pin: string\)/);
  assert.match(appSource, /activateStaffSession\(staff, pin\)/);
  assert.match(appSource, /onSwitchUser=\{async \(staff, pin\) => \{ await handleSwitchWaiter\(staff, pin\); \}\}/);
});
