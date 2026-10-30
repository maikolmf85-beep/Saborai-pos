import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRolePermission, ROLE_PERMISSIONS } from '../api/_utils/rolePermissions.ts';

test('la configuración y prueba de Hacienda se reserva a ADMIN', () => {
  assert.equal(hasRolePermission('ADMIN', ROLE_PERMISSIONS.haciendaSettings), true);
  assert.equal(hasRolePermission('CAJERO', ROLE_PERMISSIONS.haciendaSettings), false);
  assert.equal(hasRolePermission('SALONERO_CAJA', ROLE_PERMISSIONS.haciendaSettings), false);
});

test('facturación e historial fiscal corresponden a roles con caja', () => {
  for (const role of ['ADMIN', 'CAJERO']) {
    assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.haciendaOperations), true);
    assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.haciendaHistory), true);
  }
  assert.equal(hasRolePermission('SALONERO', ROLE_PERMISSIONS.haciendaOperations), false);
  assert.equal(hasRolePermission('SALONERO_CAJA', ROLE_PERMISSIONS.haciendaOperations), false);
  assert.equal(hasRolePermission('WAITER', ROLE_PERMISSIONS.haciendaHistory), false);
});

test('sync de mesas admite roles operativos; pagos, inventario y facturas requieren rol de caja', () => {
  for (const role of ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER']) {
    assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.offlineSync.UPDATE_TABLE), true);
  }
  for (const action of ['PAYMENT', 'DEDUCT_INVENTORY']) {
    for (const role of ['ADMIN', 'CAJERO', 'SALONERO_CAJA']) {
      assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.offlineSync[action]), true);
    }
    for (const role of ['SALONERO', 'WAITER']) {
      assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.offlineSync[action]), false);
    }
  }
  for (const role of ['ADMIN', 'CAJERO']) {
    assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.offlineSync.EMIT_INVOICE), true);
  }
  for (const role of ['SALONERO', 'SALONERO_CAJA', 'WAITER']) {
    assert.equal(hasRolePermission(role, ROLE_PERMISSIONS.offlineSync.EMIT_INVOICE), false);
  }
  assert.equal(hasRolePermission(undefined, ROLE_PERMISSIONS.offlineSync.PAYMENT), false);
});
