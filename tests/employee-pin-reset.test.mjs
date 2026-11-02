import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeOwnerEmployeePinResetAttempt,
  isOwnerAdminSession,
  parseOwnEmployeePinResetInput
} from '../api/_utils/employeePinReset.ts';

test('solo la sesión raíz de un ADMIN propietario con tenant puede restablecer su propio PIN', () => {
  assert.equal(isOwnerAdminSession({ userId: 'owner-1', tenantId: 'tenant-1', role: 'ADMIN' }), true);
  assert.equal(isOwnerAdminSession({ userId: 'owner-1', tenantId: 'tenant-1', role: 'ADMIN', employeeId: 'employee-1' }), false);
  assert.equal(isOwnerAdminSession({ userId: 'owner-1', tenantId: 'tenant-1', role: 'ADMIN', employeeId: '' }), false);
  assert.equal(isOwnerAdminSession({ userId: 'owner-1', tenantId: 'tenant-1', role: 'CAJERO' }), false);
  assert.equal(isOwnerAdminSession({ userId: 'owner-1', role: 'ADMIN' }), false);
  assert.equal(isOwnerAdminSession({ tenantId: 'tenant-1', role: 'ADMIN' }), false);
});

test('acepta solo contraseña actual y PIN ASCII de cuatro dígitos, incluidos ceros iniciales', () => {
  assert.deepEqual(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '0042' }), {
    currentPassword: 'Cuenta Segura!',
    newPin: '0042'
  });
  assert.deepEqual(parseOwnEmployeePinResetInput({ currentPassword: ' pass con espacios ', newPin: '9876' }), {
    currentPassword: ' pass con espacios ',
    newPin: '9876'
  });
});

test('rechaza email, identificadores o tenant enviados por el cliente como objetivo', () => {
  assert.equal(parseOwnEmployeePinResetInput({ email: 'owner@example.test', newPin: '1234' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '1234', email: 'owner@example.test' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '1234', userId: 'otro-usuario' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '1234', tenantId: 'otro-tenant' }), null);
});

test('rechaza contraseña vacía o excesiva, PIN incompleto e inputs malformados', () => {
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: '', newPin: '1234' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'x'.repeat(1025), newPin: '1234' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '123' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '12x4' }), null);
  assert.equal(parseOwnEmployeePinResetInput({ currentPassword: 'Cuenta Segura!', newPin: '１２３４' }), null);
  assert.equal(parseOwnEmployeePinResetInput(['Cuenta Segura!', '1234']), null);
  assert.equal(parseOwnEmployeePinResetInput(null), null);
});

test('consume el límite persistente usando solo el ID del propietario autenticado', async () => {
  const calls = [];
  const database = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: true, error: null };
    }
  };

  assert.equal(await consumeOwnerEmployeePinResetAttempt(database, 'owner-1'), true);
  assert.deepEqual(calls, [{
    name: 'consume_owner_employee_pin_reset_attempt',
    args: { p_user_id: 'owner-1' }
  }]);
});

test('deniega el límite agotado y propaga errores del RPC para fallar cerrado', async () => {
  const deniedDatabase = { rpc: async () => ({ data: false, error: null }) };
  assert.equal(await consumeOwnerEmployeePinResetAttempt(deniedDatabase, 'owner-1'), false);

  const failedDatabase = { rpc: async () => ({ data: true, error: new Error('database unavailable') }) };
  await assert.rejects(consumeOwnerEmployeePinResetAttempt(failedDatabase, 'owner-1'), /database unavailable/);
});
