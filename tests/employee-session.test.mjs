import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeAuthContext,
  buildEmployeeTokenClaims,
  employeeSessionActorMatches,
  normalizeEmployeeRoster
} from '../api/_utils/employeeSession.ts';

const employee = {
  id: 'employee-db-uuid',
  tenant_id: 'tenant-uuid',
  external_id: 'usr_pos_1',
  name: 'Ana Rojas',
  email: 'ana@example.cr',
  role: 'CAJERO',
  is_active: true
};
const tenant = { id: 'tenant-uuid', user_id: 'owner-uuid' };
const owner = { id: 'owner-uuid', email: 'owner@example.cr', active: true };

test('normaliza colaboradores y conserva solo campos permitidos', () => {
  const roster = normalizeEmployeeRoster([{
    id: ' staff-1 ',
    name: ' Ana Rojas ',
    email: 'ANA@example.cr',
    phone: ' +506 8000-0000 ',
    role: 'CAJERO',
    pin: '0427',
    active: false,
    tenantId: 'otro-tenant',
    isAdmin: true
  }]);

  assert.deepEqual(roster, [{
    externalId: 'staff-1',
    name: 'Ana Rojas',
    email: 'ana@example.cr',
    phone: '+506 8000-0000',
    role: 'CAJERO',
    active: false,
    pin: '0427'
  }]);
});

test('rechaza roles arbitrarios, PIN inválido y empleados duplicados', () => {
  assert.throws(() => normalizeEmployeeRoster([{ id: 's1', name: 'Ana', role: 'OWNER', pin: '1234' }]), /rol/);
  assert.throws(() => normalizeEmployeeRoster([{ id: 's1', name: 'Ana', role: 'SALONERO', pin: '12x4' }]), /PIN/);
  assert.throws(() => normalizeEmployeeRoster([
    { id: 's1', name: 'Ana', role: 'SALONERO', pin: '1234' },
    { id: 's1', name: 'Ana 2', role: 'CAJERO', pin: '4321' }
  ]), /duplicados/);
  assert.throws(() => normalizeEmployeeRoster({ id: 's1' }), /lista/);
});

test('resuelve rol desde empleado activo vinculado al tenant y al dueño correcto', () => {
  const context = buildEmployeeAuthContext(employee, tenant, owner);
  assert.deepEqual(context, {
    userId: 'owner-uuid',
    email: 'ana@example.cr',
    role: 'CAJERO',
    tenantId: 'tenant-uuid',
    employeeId: 'employee-db-uuid',
    employeeExternalId: 'usr_pos_1',
    employeeName: 'Ana Rojas'
  });
});

test('rechaza empleado inactivo, tenant distinto, dueño distinto o rol no admitido', () => {
  assert.equal(buildEmployeeAuthContext({ ...employee, is_active: false }, tenant, owner), null);
  assert.equal(buildEmployeeAuthContext(employee, { ...tenant, id: 'other-tenant' }, owner), null);
  assert.equal(buildEmployeeAuthContext(employee, tenant, { ...owner, id: 'other-owner' }), null);
  assert.equal(buildEmployeeAuthContext({ ...employee, role: 'ROOT' }, tenant, owner), null);
  assert.equal(buildEmployeeAuthContext(employee, tenant, { ...owner, active: false }), null);
});

test('los claims no incluyen un rol controlado por el cliente', () => {
  const claims = buildEmployeeTokenClaims(employee, tenant, owner);
  assert.equal(claims.identityType, 'employee');
  assert.equal(claims.employeeId, 'employee-db-uuid');
  assert.equal(claims.tenantId, 'tenant-uuid');
  assert.equal('role' in claims, false);
});

test('una operación offline solo coincide con el actor y empleado de la sesión actual', () => {
  const employeeSession = { userId: 'owner-uuid', employeeId: 'employee-db-uuid' };
  assert.equal(employeeSessionActorMatches('owner-uuid', 'employee-db-uuid', employeeSession), true);
  assert.equal(employeeSessionActorMatches('owner-uuid', 'other-employee-uuid', employeeSession), false);
  assert.equal(employeeSessionActorMatches('other-owner', 'employee-db-uuid', employeeSession), false);
  assert.equal(employeeSessionActorMatches('owner-uuid', null, employeeSession), false);
  assert.equal(employeeSessionActorMatches('owner-uuid', null, { userId: 'owner-uuid' }), true);
  assert.equal(employeeSessionActorMatches('owner-uuid', undefined, { userId: 'owner-uuid' }), false);
});
