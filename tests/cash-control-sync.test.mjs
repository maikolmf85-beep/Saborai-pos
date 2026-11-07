import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptCashTerminalAssignment,
  buildClosedShiftCloudPayload,
  commitAfterSuccessfulRemoteClose,
  formatCashTerminalAssignmentConflict,
  isConfirmedOpenShiftForRegister,
  isOnlyTerminalAssignmentConflictForRegister,
  isUnrelatedRegisterCodeMatch,
  shouldApplyCloudSnapshot,
  shouldSyncClosedShift,
  updateClosedShiftIfNeeded
} from '../src/services/cashControlSync.ts';

const closedShift = {
  id: 'local-shift-1',
  status: 'CLOSED',
  closedAt: '2026-11-05T15:00:00.000Z',
  closedBy: { userId: 'usr_local_not_a_uuid', userName: 'Cajera' },
  countedCash: 12500,
  countedCards: 2000,
  countedSinpe: 1500,
  cashDifference: 500,
  differenceReason: 'Vuelto revisado',
  zReportGenerated: true,
  notes: 'Cierre de prueba',
  participants: [],
  movements: [],
  cashBreakdown: { bills10000: 1 },
  dataphonesBreakdown: [{ id: 'df_1', name: 'Datáfono 1', amount: 2000 }],
  systemSummary: { expectedCashInDrawer: 12000 }
};

test('muestra una sola vez el prefijo de error de asignación y conserva el diagnóstico', () => {
  const prefix = 'No se pudo asignar este dispositivo a la caja';
  assert.equal(
    formatCashTerminalAssignmentConflict(new Error(`${prefix}.`)),
    `${prefix}.`
  );
  assert.equal(
    formatCashTerminalAssignmentConflict(new Error(prefix.toLowerCase())),
    prefix.toLowerCase()
  );
  assert.equal(
    formatCashTerminalAssignmentConflict(new Error('La caja seleccionada ya tiene otra terminal activa.')),
    `${prefix}: La caja seleccionada ya tiene otra terminal activa.`
  );
  assert.equal(formatCashTerminalAssignmentConflict(''), prefix);
});

test('solo reconoce un conflicto único de terminal para la caja local exacta', () => {
  const terminalConflict = { localRegisterId: 'register-local-1' };
  const assignmentMessage = 'No se pudo asignar este dispositivo a la caja: ya hay otra terminal activa.';
  assert.equal(isOnlyTerminalAssignmentConflictForRegister(
    [assignmentMessage], terminalConflict, 'register-local-1'
  ), true);
  assert.equal(isOnlyTerminalAssignmentConflictForRegister(
    [assignmentMessage], terminalConflict, 'register-local-2'
  ), false);
  assert.equal(isOnlyTerminalAssignmentConflictForRegister(
    [assignmentMessage, 'No se pudo importar otra caja'], terminalConflict, 'register-local-1'
  ), false);
  assert.equal(isOnlyTerminalAssignmentConflictForRegister(
    ['No se pudo importar la caja'], terminalConflict, 'register-local-1'
  ), false);
  assert.equal(isOnlyTerminalAssignmentConflictForRegister(
    [assignmentMessage], undefined, 'register-local-1'
  ), false);
});

test('la sincronización reporta terminal previa activa sin alterar ni reasignar terminales', async () => {
  const state = { activeTerminalId: 'terminal-existing' };
  const calls = [];
  const result = await attemptCashTerminalAssignment(
    async () => {
      calls.push('ASSIGN_CASH_TERMINAL');
      if (state.activeTerminalId) {
        const error = new Error('CASH_TERMINAL_ALREADY_ASSIGNED');
        error.code = 'CASH_TERMINAL_ALREADY_ASSIGNED';
        throw error;
      }
      state.activeTerminalId = 'terminal-this-device';
    },
    async error => {
      calls.push('READ_EXISTING_TERMINAL');
      assert.equal(error.code, 'CASH_TERMINAL_ALREADY_ASSIGNED');
      return { terminalId: state.activeTerminalId, localRegisterId: 'register-local-1' };
    }
  );

  assert.equal(result.assignedTerminal, false);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /No se pudo asignar este dispositivo a la caja/);
  assert.deepEqual(result.terminalAssignmentConflict, {
    terminalId: 'terminal-existing', localRegisterId: 'register-local-1'
  });
  assert.deepEqual(calls, ['ASSIGN_CASH_TERMINAL', 'READ_EXISTING_TERMINAL']);
  assert.equal(state.activeTerminalId, 'terminal-existing');
});

test('confirma el mismo turno OPEN, tenant y caja activa antes de tolerar el conflicto', () => {
  const snapshot = {
    registers: [{ id: 'register-remote-1', legacy_id: 'register-local-1', tenant_id: 'tenant-1', is_active: true }],
    shifts: [{ id: 'shift-remote-1', legacy_id: 'shift-local-1', tenant_id: 'tenant-1', status: 'OPEN', cash_register_id: 'register-remote-1' }]
  };
  const target = { kind: 'shift', shiftId: 'shift-local-1', registerId: 'register-local-1' };
  assert.equal(isConfirmedOpenShiftForRegister(snapshot, 'tenant-1', target, 'register-remote-1'), true);
  assert.equal(isConfirmedOpenShiftForRegister(snapshot, 'tenant-1', target, 'register-remote-2'), false);
  assert.equal(isConfirmedOpenShiftForRegister({
    ...snapshot,
    shifts: [{ ...snapshot.shifts[0], cash_register_id: 'register-remote-2' }]
  }, 'tenant-1', target, 'register-remote-1'), false);
  assert.equal(isConfirmedOpenShiftForRegister({
    ...snapshot,
    shifts: [{ ...snapshot.shifts[0], status: 'CLOSED' }]
  }, 'tenant-1', target, 'register-remote-1'), false);
  assert.equal(isConfirmedOpenShiftForRegister(snapshot, 'other-tenant', target, 'register-remote-1'), false);
});

test('no marca localmente el turno cerrado si el servidor rechaza el cierre', async () => {
  const shift = { status: 'OPEN' };
  let localCommitCount = 0;
  await assert.rejects(
    commitAfterSuccessfulRemoteClose(
      async () => { throw new Error('Cierre rechazado por el servidor'); },
      () => { localCommitCount += 1; shift.status = 'CLOSED'; }
    ),
    /Cierre rechazado por el servidor/
  );
  assert.equal(shift.status, 'OPEN');
  assert.equal(localCommitCount, 0);

  const result = await commitAfterSuccessfulRemoteClose(
    async () => ({ closedAt: '2026-11-06T20:00:00.000Z' }),
    () => { shift.status = 'CLOSED'; }
  );
  assert.equal(result.closedAt, '2026-11-06T20:00:00.000Z');
  assert.equal(shift.status, 'CLOSED');
});

test('descarta el snapshot que empezó antes de una mutación local', () => {
  assert.equal(shouldApplyCloudSnapshot(4, 5), false);
  assert.equal(shouldApplyCloudSnapshot(5, 5), true);
});

test('distingue un código DGT repetido de la misma caja remota', () => {
  assert.equal(isUnrelatedRegisterCodeMatch('local-new', undefined, 'remote-old'), true);
  assert.equal(isUnrelatedRegisterCodeMatch('remote-old', undefined, 'remote-old'), false);
  assert.equal(isUnrelatedRegisterCodeMatch('local-id', 'remote-same', 'remote-same'), false);
  assert.equal(isUnrelatedRegisterCodeMatch('local-id', 'remote-legacy', 'remote-other'), true);
  assert.equal(isUnrelatedRegisterCodeMatch('local-id', undefined, undefined), false);
});

test('solo sincroniza la transición de un turno remoto OPEN a CLOSED', () => {
  assert.equal(shouldSyncClosedShift('OPEN', 'CLOSED'), true);
  assert.equal(shouldSyncClosedShift('OPEN', 'OPEN'), false);
  assert.equal(shouldSyncClosedShift('CLOSED', 'CLOSED'), false);
  assert.equal(shouldSyncClosedShift('VOIDED', 'CLOSED'), false);
});

test('construye el cierre remoto con arqueo y no envía un ID no UUID a closed_by', () => {
  const payload = buildClosedShiftCloudPayload(closedShift);
  assert.equal(payload.status, 'CLOSED');
  assert.equal(payload.legacy_id, closedShift.id);
  assert.equal(payload.closed_at, closedShift.closedAt);
  assert.equal(payload.expected_cash, 12000);
  assert.equal(payload.counted_cash, 12500);
  assert.equal(payload.difference, 500);
  assert.equal(payload.counted_cards, 2000);
  assert.equal(payload.counted_sinpe, 1500);
  assert.equal(payload.difference_reason, 'Vuelto revisado');
  assert.equal(payload.z_report_generated, true);
  assert.equal('closed_by' in payload, false);

  const validUuid = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(buildClosedShiftCloudPayload({
    ...closedShift,
    closedBy: { userId: validUuid, userName: 'Cajera' }
  }).closed_by, validUuid);
});

test('actualiza por el ID remoto solamente al cerrar y exige confirmación de la fila', async () => {
  const calls = [];
  const updated = await updateClosedShiftIfNeeded('OPEN', 'remote-shift-9', closedShift, async (id, payload) => {
    calls.push({ id, payload });
    return { data: { id }, error: null };
  });
  assert.equal(updated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'remote-shift-9');
  assert.equal(calls[0].payload.status, 'CLOSED');

  const skipped = await updateClosedShiftIfNeeded('CLOSED', 'remote-shift-9', closedShift, async () => {
    assert.fail('no debe actualizarse un turno ya cerrado');
  });
  assert.equal(skipped, false);
});

test('informa fallos y respuestas vacías del update para no tratarlo como cierre confirmado', async () => {
  await assert.rejects(
    updateClosedShiftIfNeeded('OPEN', 'remote-shift-9', closedShift, async () => ({
      data: null,
      error: { message: 'RLS rechazó la actualización' }
    })),
    /RLS rechazó la actualización/
  );
  await assert.rejects(
    updateClosedShiftIfNeeded('OPEN', 'remote-shift-9', closedShift, async () => ({ data: null, error: null })),
    /No se confirmó/
  );
});
