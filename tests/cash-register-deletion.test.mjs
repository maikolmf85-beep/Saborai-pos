import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveCashRegisterInCloud,
  deleteCashRegisterFromState,
  getVisibleCashRegisters
} from '../src/services/cashRegisterDeletion.ts';

test('archiva la caja remota por legacy_id antes de completar el borrado local', async () => {
  const calls = [];
  await archiveCashRegisterInCloud('tenant-1', 'local-register-1', {
    findByLegacyId: async (tenantId, legacyId) => {
      calls.push(['legacy', tenantId, legacyId]);
      return { id: 'cloud-register-1' };
    },
    findById: async () => {
      calls.push(['id']);
      return null;
    },
    deactivate: async (tenantId, cloudId) => calls.push(['deactivate', tenantId, cloudId])
  });

  assert.deepEqual(calls, [
    ['legacy', 'tenant-1', 'local-register-1'],
    ['deactivate', 'tenant-1', 'cloud-register-1']
  ]);
});

test('usa el ID remoto cuando la caja no tiene legacy_id', async () => {
  const calls = [];
  await archiveCashRegisterInCloud('tenant-1', 'cloud-register-2', {
    findByLegacyId: async () => null,
    findById: async (tenantId, id) => {
      calls.push(['id', tenantId, id]);
      return { id };
    },
    deactivate: async (tenantId, cloudId) => calls.push(['deactivate', tenantId, cloudId])
  });

  assert.deepEqual(calls, [
    ['id', 'tenant-1', 'cloud-register-2'],
    ['deactivate', 'tenant-1', 'cloud-register-2']
  ]);
});

test('un fallo remoto impide confirmar el borrado y conserva el estado anterior', async () => {
  const registers = [{ id: 'box-1' }, { id: 'box-2' }];
  await assert.rejects(
    deleteCashRegisterFromState(registers, {}, 'box-1', 'box-1', async () => {
      throw new Error('falló Supabase');
    }),
    /falló Supabase/
  );
  assert.deepEqual(registers, [{ id: 'box-1' }, { id: 'box-2' }]);
});

test('el turno abierto bloquea el borrado sin llamar al archivo remoto', async () => {
  let archiveCalled = false;
  await assert.rejects(
    deleteCashRegisterFromState(
      [{ id: 'box-1' }],
      { 'box-1': { id: 'shift-1' } },
      'box-1',
      'box-1',
      async () => { archiveCalled = true; }
    ),
    /turno abierto/
  );
  assert.equal(archiveCalled, false);
});

test('elimina localmente después de archivar y cambia la caja actual si corresponde', async () => {
  let archived = false;
  const result = await deleteCashRegisterFromState(
    [{ id: 'box-1' }, { id: 'box-2' }],
    {},
    'box-1',
    'box-1',
    async () => { archived = true; }
  );

  assert.equal(archived, true);
  assert.deepEqual(result, {
    registers: [{ id: 'box-2' }],
    currentTerminalId: 'box-2'
  });
});

test('la hidratación mantiene disponibles solo las cajas activas', () => {
  const records = [
    { id: 'box-1', is_active: true },
    { id: 'box-2', is_active: false }
  ];
  assert.deepEqual(getVisibleCashRegisters(records), [{ id: 'box-1', is_active: true }]);
});
