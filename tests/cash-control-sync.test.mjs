import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClosedShiftCloudPayload,
  formatCashTerminalAssignmentConflict,
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
