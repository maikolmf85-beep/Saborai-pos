import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReservation, normalizeTableLayout } from '../api/_utils/directWrites.ts';
import { ROLE_PERMISSIONS, hasRolePermission } from '../api/_utils/rolePermissions.ts';

const reservation = {
  id: '7ca52b36-4f5b-40dc-8ea3-d67204b82b54',
  tableId: 'table-1',
  tableName: 'Mesa 1',
  zone: 'Terraza',
  customerName: 'María Solís',
  customerPhone: '+506 8000-0000',
  customerEmail: 'maria@example.cr',
  reservedAt: '2026-10-29T19:00:00-06:00',
  durationMinutes: 90,
  partySize: 4,
  status: 'CONFIRMED',
  notes: 'Silla infantil',
  arrivedAt: null,
  seatedAt: null,
  tenantId: 'forged-tenant',
  role: 'ADMIN'
};

test('normaliza el plano a campos permitidos y rechaza posiciones fuera del rango', () => {
  assert.deepEqual(normalizeTableLayout([{
    id: 'table-1', number: 1, name: 'Mesa 1', zone: 'Terraza', seats: 4,
    shape: 'round', x: 22.5, y: 74, rotation: 90, status: 'OCCUPIED'
  }]), [{
    id: 'table-1', number: 1, name: 'Mesa 1', zone: 'Terraza', seats: 4,
    shape: 'round', x: 22.5, y: 74, rotation: 90
  }]);
  assert.throws(() => normalizeTableLayout([{
    id: 'table-1', number: 1, name: 'Mesa 1', zone: 'Terraza', seats: 4,
    shape: 'square', x: 101, y: 0
  }]), /posición/);
  assert.throws(() => normalizeTableLayout([
    { id: 'table-1', number: 1, name: 'Mesa 1', zone: '', seats: 2, shape: 'square', x: 1, y: 1 },
    { id: 'table-1', number: 2, name: 'Mesa 2', zone: '', seats: 2, shape: 'square', x: 2, y: 2 }
  ]), /duplicados/);
});

test('proyecta la reserva sin aceptar tenant o rol enviados por el navegador', () => {
  const safe = normalizeReservation(reservation);
  assert.equal(safe.customerEmail, 'maria@example.cr');
  assert.equal(safe.reservedAt, '2026-10-30T01:00:00.000Z');
  assert.equal('tenantId' in safe, false);
  assert.equal('role' in safe, false);
  assert.throws(() => normalizeReservation({ ...reservation, status: 'PAID' }), /estado/);
  assert.throws(() => normalizeReservation({ ...reservation, id: 'not-a-uuid' }), /identificador/);
  assert.throws(() => normalizeReservation({ ...reservation, partySize: 0 }), /tamaño/);
});

test('cada escritura tiene una política explícita, consultada con el rol persistido', () => {
  const roles = ROLE_PERMISSIONS.directWrites;
  assert.equal(hasRolePermission('ADMIN', roles.SAVE_TABLE_LAYOUT), true);
  assert.equal(hasRolePermission('WAITER', roles.SAVE_TABLE_LAYOUT), false);
  assert.equal(hasRolePermission('SALONERO', roles.UPSERT_TABLE_RESERVATION), true);
  assert.equal(hasRolePermission('CAJERO', roles.DELETE_TABLE_RESERVATION), true);
  assert.equal(hasRolePermission('WAITER', roles.CASH_CONTROL_SYNC), true);
  assert.equal(hasRolePermission('WAITER', roles.CASH_CONTROL_IMPORT), false);
  assert.equal(hasRolePermission('OWNER', roles.CASH_CONTROL_IMPORT), false);
  assert.equal(hasRolePermission(undefined, roles.CASH_CONTROL_SYNC), false);
});
