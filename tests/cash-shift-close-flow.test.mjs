import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { closeCashShiftAfterSync } from '../src/services/cashShiftCloseFlow.ts';
import {
  isConfirmedOpenShiftForRegister,
  isOnlyTerminalAssignmentConflictForRegister
} from '../src/services/cashControlSync.ts';

const shift = {
  id: 'shift-local-1',
  status: 'OPEN',
  cashRegisterId: 'register-local-1'
};

const terminalConflict = {
  terminalId: 'terminal-existing',
  registerId: 'register-remote-1',
  localRegisterId: 'register-local-1',
  registerName: 'Caja principal',
  deviceName: 'Terminal previa'
};

const migrationResult = {
  importedRegisters: 0,
  importedShifts: 0,
  assignedTerminal: false,
  skippedExisting: 1,
  conflicts: ['No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.'],
  migrationMarker: '2026-11-06T20:00:00.000Z',
  terminalAssignmentConflict: terminalConflict
};

const cloudSnapshot = {
  registers: [{
    id: 'register-remote-1',
    legacy_id: 'register-local-1',
    tenant_id: 'tenant-1',
    is_active: true
  }],
  shifts: [{
    id: 'shift-remote-1',
    legacy_id: 'shift-local-1',
    tenant_id: 'tenant-1',
    status: 'OPEN',
    cash_register_id: 'register-remote-1'
  }]
};

test('una terminal previa activa no impide cerrar el mismo turno OPEN de su caja y tenant', async () => {
  const calls = [];
  const closed = await closeCashShiftAfterSync({
    tenantId: 'tenant-1',
    registerId: 'register-local-1',
    shift,
    syncPending: async tenantId => { calls.push(['sync-payments', tenantId]); },
    getPendingItems: async tenantId => { calls.push(['pending-items', tenantId]); return []; },
    flushCloudSync: async target => {
      calls.push(['flush-config', target]);
      assert.deepEqual(target, { shiftId: 'shift-local-1', registerId: 'register-local-1' });
      assert.equal(isOnlyTerminalAssignmentConflictForRegister(
        migrationResult.conflicts,
        migrationResult.terminalAssignmentConflict,
        target.registerId
      ), true);
      assert.equal(isConfirmedOpenShiftForRegister(
        cloudSnapshot,
        'tenant-1',
        target,
        terminalConflict.registerId
      ), true);
      return migrationResult;
    },
    getActiveShift: registerId => {
      calls.push(['active-shift', registerId]);
      return shift;
    },
    closeShift: async () => {
      calls.push(['close-server']);
      return { closed: true };
    }
  });

  assert.deepEqual(closed, { closed: true });
  assert.deepEqual(calls.map(([name]) => name), [
    'sync-payments', 'pending-items', 'flush-config', 'active-shift', 'close-server'
  ]);
  assert.equal(migrationResult.assignedTerminal, false);
  assert.equal(terminalConflict.terminalId, 'terminal-existing');
});

test('mantiene detenido el cierre cuando queda un cobro pendiente tras intentar sincronizar', async () => {
  const calls = [];
  await assert.rejects(
    closeCashShiftAfterSync({
      tenantId: 'tenant-1',
      registerId: 'register-local-1',
      shift,
      syncPending: async () => { calls.push('sync-payments'); },
      getPendingItems: async () => {
        calls.push('pending-items');
        return [{ action: 'PAYMENT', synced: false }];
      },
      flushCloudSync: async () => { calls.push('flush-config'); },
      getActiveShift: () => { calls.push('active-shift'); return shift; },
      closeShift: async () => { calls.push('close-server'); return { closed: true }; }
    }),
    /Hay cobros pendientes de sincronizar/
  );
  assert.deepEqual(calls, ['sync-payments', 'pending-items']);
});

test('la integración conserva el reporte de configuración y no llama a reasignación automática', async () => {
  const cloudService = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');
  const importStart = cloudService.indexOf('async importLocalConfiguration(');
  const importEnd = cloudService.indexOf('\n  async reassignTerminal(', importStart);
  assert.notEqual(importStart, -1);
  assert.notEqual(importEnd, -1);
  const importer = cloudService.slice(importStart, importEnd);
  assert.match(importer, /attemptCashTerminalAssignment/);
  assert.match(importer, /ASSIGN_CASH_TERMINAL/);
  assert.match(importer, /conflicts\.push\(\.\.\.assignment\.conflicts\)/);
  assert.doesNotMatch(importer, /REASSIGN_CASH_TERMINAL|reassignTerminal\(/);
});

test('el flujo muestra errores de cierre al componente en lugar de tratarlos como éxito', async () => {
  const modal = await readFile(new URL('../src/components/CashShiftModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /catch \(err: any\) \{\s*setCloseError\(err\.message \|\| 'Error al cerrar el turno\.'/);
  assert.match(modal, /closeCashShiftAfterSync\(/);
});
