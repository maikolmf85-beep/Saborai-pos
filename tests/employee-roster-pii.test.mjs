import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authorizeEmployeeRosterRead,
  buildEmployeeRosterPayload
} from '../api/_utils/employeeRoster.ts';

const owner = {
  id: 'owner-1',
  name: 'Dueño',
  email: 'owner@example.cr',
  phone: '+506 8888-0000',
  restaurant_name: 'Restaurante Demo',
  role: 'ADMIN',
  active: true
};
const employeeRows = [{
  external_id: 'employee-1',
  name: 'Ana Rojas',
  email: 'ana@example.cr',
  phone: '+506 8777-0000',
  role: 'SALONERO',
  is_active: true
}];
const employeeAuth = {
  userId: 'owner-1',
  email: 'ana@example.cr',
  role: 'SALONERO',
  tenantId: 'tenant-1',
  employeeId: 'employee-db-1'
};
const adminAuth = {
  userId: 'owner-1',
  email: 'owner@example.cr',
  role: 'ADMIN',
  tenantId: 'tenant-1'
};

test('una sesión anónima no puede leer el roster operativo', () => {
  assert.deepEqual(authorizeEmployeeRosterRead(null, 'operational'), {
    allowed: false,
    status: 401,
    error: 'No autorizado.'
  });
});

test('una sesión de empleado recibe solo ID, nombre, rol y estado para operación', () => {
  const access = authorizeEmployeeRosterRead(employeeAuth, 'operational');
  assert.equal(access.allowed, true);
  if (!access.allowed) return;
  assert.equal(access.includeContacts, false);
  const payload = buildEmployeeRosterPayload(access, owner, employeeRows);
  assert.deepEqual(payload.employees[0], {
    id: 'employee-1',
    name: 'Ana Rojas',
    role: 'SALONERO',
    active: true
  });
  assert.deepEqual(payload.owner, {
    id: 'owner-1',
    name: 'Dueño',
    role: 'ADMIN',
    active: true
  });
  assert.doesNotMatch(JSON.stringify(payload), /owner@example\.cr|ana@example\.cr|8888-0000|8777-0000/);
});

test('un empleado no puede leer contactos; ADMIN sí puede solo mediante la vista protegida', () => {
  const denied = authorizeEmployeeRosterRead(employeeAuth, 'contacts');
  assert.equal(denied.allowed, false);
  if (!denied.allowed) assert.equal(denied.status, 403);

  const adminAccess = authorizeEmployeeRosterRead(adminAuth, 'contacts');
  assert.equal(adminAccess.allowed, true);
  if (!adminAccess.allowed) return;
  assert.equal(adminAccess.includeContacts, true);
  const payload = buildEmployeeRosterPayload(adminAccess, owner, employeeRows);
  assert.equal(payload.owner.email, 'owner@example.cr');
  assert.equal(payload.owner.phone, '+506 8888-0000');
  assert.equal(payload.employees[0].email, 'ana@example.cr');
  assert.equal(payload.employees[0].phone, '+506 8777-0000');
});

test('la vista operativa tampoco entrega contactos aunque la solicite ADMIN', () => {
  const access = authorizeEmployeeRosterRead(adminAuth, 'operational');
  assert.equal(access.allowed, true);
  if (!access.allowed) return;
  assert.equal(access.includeContacts, false);
  const payload = buildEmployeeRosterPayload(access, owner, employeeRows);
  assert.doesNotMatch(JSON.stringify(payload), /owner@example\.cr|ana@example\.cr|8888-0000|8777-0000/);
});

test('la ruta separada valida el token y usa la política ADMIN antes de consultar contactos', async () => {
  const source = await readFile(new URL('../api/auth.ts', import.meta.url), 'utf8');
  assert.match(source, /rawAction === 'employee-roster-admin'/);
  assert.match(source, /authenticateRequest\(req\)/);
  assert.match(source, /authorizeEmployeeRosterRead\(auth,\s*includeContacts\s*\?\s*'contacts'\s*:\s*'operational'\)/);
  assert.match(source, /access\.includeContacts\s*\?\s*supabase\.from\('pos_employees'\)\s*\.select\('external_id, name, email, phone, role, is_active'\)/);
});
