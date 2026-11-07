import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { closeDailyCashAfterSync } from '../src/services/dailyCashCloseFlow.ts';
import {
  confirmOpenDailyCashFromRemote,
  isConfirmedOpenDailyCashForRegister,
  isOnlyTerminalAssignmentConflictForDailyCash
} from '../src/services/cashControlSync.ts';

const dailyStatus = {
  registerId: 'register-remote-1',
  registerName: 'Caja principal',
  businessDate: '2026-11-06',
  timezone: 'America/Costa_Rica',
  isOpen: true,
  isClosed: false,
  openedAt: '2026-11-06T06:00:00.000Z'
};

const terminalConflict = {
  terminalId: 'terminal-existing',
  registerId: 'register-remote-1',
  localRegisterId: 'register-local-1'
};

const target = {
  kind: 'daily',
  tenantId: 'tenant-1',
  registerId: 'register-local-1',
  cloudRegisterId: 'register-remote-1',
  businessDate: '2026-11-06',
  timezone: 'America/Costa_Rica'
};

function flowOptions(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    registerId: 'register-local-1',
    status: dailyStatus,
    openTablesCount: 0,
    syncPending: async () => {},
    getPendingItems: async () => [],
    flushCloudSync: async () => {},
    closeRemotely: async () => ({ closed: true }),
    commitLocally: () => {},
    ...overrides
  };
}

test('cierra caja diaria con contexto exacto sin exigir un turno abierto', async () => {
  const calls = [];
  let localState = 'OPEN';
  const result = await closeDailyCashAfterSync(flowOptions({
    syncPending: async tenantId => { calls.push(['sync-payments', tenantId]); },
    getPendingItems: async tenantId => { calls.push(['pending-items', tenantId]); return []; },
    flushCloudSync: async closeTarget => {
      calls.push(['flush-config', closeTarget]);
      assert.deepEqual(closeTarget, target);
      const eligible = isOnlyTerminalAssignmentConflictForDailyCash(
        ['No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.'],
        terminalConflict,
        closeTarget,
        'tenant-1'
      );
      assert.equal(eligible, true);
      assert.equal(await confirmOpenDailyCashFromRemote(
        'tenant-1',
        closeTarget,
        async (tenantId, registerId) => {
          calls.push(['fresh-daily-status', tenantId, registerId]);
          return dailyStatus;
        }
      ), true);
    },
    closeRemotely: async closeTarget => {
      calls.push(['close-server', closeTarget]);
      return { closed: true, closedAt: '2026-11-06T20:00:00.000Z' };
    },
    commitLocally: result => {
      calls.push(['commit-local']);
      localState = result.closed ? 'CLOSED' : 'OPEN';
    }
  }));

  assert.equal(result.closed, true);
  assert.equal(localState, 'CLOSED');
  assert.deepEqual(calls.map(([name]) => name), [
    'sync-payments', 'pending-items', 'flush-config', 'fresh-daily-status', 'close-server', 'commit-local'
  ]);
});

test('no cierra si quedan cobros pendientes después de sincronizar', async () => {
  const calls = [];
  await assert.rejects(closeDailyCashAfterSync(flowOptions({
    syncPending: async () => { calls.push('sync'); },
    getPendingItems: async () => { calls.push('pending'); return [{ action: 'PAYMENT' }]; },
    flushCloudSync: async () => { calls.push('flush'); },
    closeRemotely: async () => { calls.push('close'); },
    commitLocally: () => { calls.push('commit'); }
  })), /Hay cobros pendientes de sincronizar/);
  assert.deepEqual(calls, ['sync', 'pending']);
});

test('mesas o comandas abiertas bloquean el cierre antes de sincronizar', async () => {
  const calls = [];
  await assert.rejects(closeDailyCashAfterSync(flowOptions({
    openTablesCount: 2,
    syncPending: async () => { calls.push('sync'); },
    flushCloudSync: async () => { calls.push('flush'); },
    closeRemotely: async () => { calls.push('close'); }
  })), /2 mesa\(s\) tienen una comanda abierta/);
  assert.deepEqual(calls, []);
});

test('una apertura diaria cerrada o inexistente bloquea el cierre', async () => {
  for (const status of [
    { ...dailyStatus, isOpen: false, isClosed: false },
    { ...dailyStatus, isOpen: true, isClosed: true }
  ]) {
    await assert.rejects(closeDailyCashAfterSync(flowOptions({ status })), /Primero debe abrirse la caja del día/);
  }
});

test('solo confirma una apertura remota del tenant, caja, fecha local y sucursal exactos', () => {
  assert.equal(isConfirmedOpenDailyCashForRegister(dailyStatus, 'tenant-1', target), true);
  assert.equal(isConfirmedOpenDailyCashForRegister({ ...dailyStatus, isOpen: false }, 'tenant-1', target), false);
  assert.equal(isConfirmedOpenDailyCashForRegister({ ...dailyStatus, isClosed: true }, 'tenant-1', target), false);
  assert.equal(isConfirmedOpenDailyCashForRegister({ ...dailyStatus, registerId: 'register-remote-2' }, 'tenant-1', target), false);
  assert.equal(isConfirmedOpenDailyCashForRegister({ ...dailyStatus, businessDate: '2026-11-05' }, 'tenant-1', target), false);
  assert.equal(isConfirmedOpenDailyCashForRegister({ ...dailyStatus, timezone: 'UTC' }, 'tenant-1', target), false);
  assert.equal(isConfirmedOpenDailyCashForRegister(dailyStatus, 'tenant-2', target), false);
});

test('un tenant discordante no inicia una lectura remota', async () => {
  let reads = 0;
  assert.equal(await confirmOpenDailyCashFromRemote(
    'tenant-2',
    target,
    async () => { reads += 1; return dailyStatus; }
  ), false);
  assert.equal(reads, 0);
});

test('solo tolera el único conflicto de terminal de la caja local y remota exactas', () => {
  const conflictMessage = 'No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.';
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash([conflictMessage], terminalConflict, target, 'tenant-1'), true);
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash([conflictMessage], terminalConflict, target, 'tenant-2'), false);
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash([conflictMessage], { ...terminalConflict, localRegisterId: 'register-other' }, target, 'tenant-1'), false);
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash([conflictMessage], { ...terminalConflict, registerId: 'register-remote-2' }, target, 'tenant-1'), false);
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash([conflictMessage, 'No se pudo importar otra caja.'], terminalConflict, target, 'tenant-1'), false);
  assert.equal(isOnlyTerminalAssignmentConflictForDailyCash(['No se pudo importar otra caja.'], terminalConflict, target, 'tenant-1'), false);
});

test('otros conflictos detienen el flujo antes del cierre remoto o local', async () => {
  const conflicts = [
    'No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.',
    'No se pudo importar otra caja.'
  ];
  let remoteCloseCalls = 0;
  let localCommitCalls = 0;
  await assert.rejects(closeDailyCashAfterSync(flowOptions({
    flushCloudSync: async closeTarget => {
      const allowed = isOnlyTerminalAssignmentConflictForDailyCash(conflicts, terminalConflict, closeTarget, 'tenant-1');
      if (!allowed) throw new Error(conflicts.join(' '));
    },
    closeRemotely: async () => { remoteCloseCalls += 1; return { closed: true }; },
    commitLocally: () => { localCommitCalls += 1; }
  })), /No se pudo importar otra caja/);
  assert.equal(remoteCloseCalls, 0);
  assert.equal(localCommitCalls, 0);
});

test('una lectura remota fallida aborta y no permite cerrar', async () => {
  let remoteCloseCalls = 0;
  let localCommitCalls = 0;
  await assert.rejects(closeDailyCashAfterSync(flowOptions({
    flushCloudSync: async closeTarget => {
      if (!isOnlyTerminalAssignmentConflictForDailyCash(
        ['No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.'],
        terminalConflict,
        closeTarget,
        'tenant-1'
      )) throw new Error('Conflicto no elegible.');
      await confirmOpenDailyCashFromRemote('tenant-1', closeTarget, async () => {
        throw new Error('Servidor de estado no disponible');
      });
    },
    closeRemotely: async () => { remoteCloseCalls += 1; return { closed: true }; },
    commitLocally: () => { localCommitCalls += 1; }
  })), /Servidor de estado no disponible/);
  assert.equal(remoteCloseCalls, 0);
  assert.equal(localCommitCalls, 0);
});

test('un rechazo del cierre remoto no cambia el estado local', async () => {
  let localState = 'OPEN';
  let localCommitCalls = 0;
  await assert.rejects(closeDailyCashAfterSync(flowOptions({
    closeRemotely: async () => { throw new Error('Cierre diario rechazado por el servidor'); },
    commitLocally: () => { localCommitCalls += 1; localState = 'CLOSED'; }
  })), /Cierre diario rechazado por el servidor/);
  assert.equal(localState, 'OPEN');
  assert.equal(localCommitCalls, 0);
});

test('la pantalla manda el objetivo diario al vaciado y actualiza la caché solo después de confirmar el cierre remoto', async () => {
  const modal = await readFile(new URL('../src/components/CashShiftModal.tsx', import.meta.url), 'utf8');
  const flowStart = modal.indexOf('const result = await closeDailyCashAfterSync({');
  const closeStart = modal.indexOf("'CLOSE_DAILY_CASH'", flowStart);
  const commitStart = modal.indexOf('commitLocally: remoteResult => {', flowStart);
  assert.notEqual(flowStart, -1);
  assert.notEqual(closeStart, -1);
  assert.notEqual(commitStart, -1);
  assert.match(modal.slice(flowStart, closeStart), /flushCloudSync: target => cashShiftService\.flushCloudSync\(target\)/);
  assert.match(modal.slice(flowStart, commitStart), /openTablesCount: tables\.filter\(isOpenDiningTable\)\.length/);
  assert.match(modal.slice(flowStart, commitStart), /getPendingItems: tenantId => localDB\.getPendingItems\(tenantId\)/);
});
