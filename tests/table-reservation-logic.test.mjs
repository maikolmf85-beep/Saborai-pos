import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUpcomingReservationForTable,
  hasTableReservationTimeConflict,
  isReservationReminderDue,
  prepareBulkTableReservationInputs
} from '../src/services/tableReservationLogic.ts';

function makeReservation(overrides = {}) {
  return {
    id: 'res-1',
    tenantId: 'tenant-1',
    tableId: 'table-1',
    tableName: 'Mesa 1',
    zone: 'Principal',
    customerName: 'Cliente de prueba',
    customerPhone: '8888-0000',
    reservedAt: '2026-11-05T18:00:00.000Z',
    durationMinutes: 90,
    partySize: 2,
    status: 'CONFIRMED',
    notes: '',
    arrivedAt: null,
    seatedAt: null,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
    ...overrides
  };
}

function makeTable(id, number, seats) {
  return {
    id,
    number,
    name: `Mesa ${number}`,
    seats,
    shape: 'round',
    status: 'AVAILABLE',
    zone: 'Principal',
    x: number * 10,
    y: number * 10
  };
}

test('detecta solapamientos de la misma mesa y permite reservas contiguas', () => {
  const existing = makeReservation();
  assert.equal(
    hasTableReservationTimeConflict([existing], 'table-1', '2026-11-05T18:30:00.000Z', 60),
    existing
  );
  assert.equal(
    hasTableReservationTimeConflict([existing], 'table-1', '2026-11-05T19:30:00.000Z', 60),
    undefined
  );
  assert.equal(
    hasTableReservationTimeConflict([makeReservation({ status: 'CANCELLED' })], 'table-1', '2026-11-05T18:30:00.000Z', 60),
    undefined
  );
});

test('encuentra reservas visibles desde 30 minutos antes hasta que termina su duración', () => {
  const reservation = makeReservation({ reservedAt: '2026-11-05T18:30:00.000Z' });
  assert.equal(getUpcomingReservationForTable('table-1', [reservation], Date.parse('2026-11-05T18:00:00.000Z'))?.id, 'res-1');
  assert.equal(getUpcomingReservationForTable('table-1', [reservation], Date.parse('2026-11-05T17:59:00.000Z')), undefined);
  assert.equal(getUpcomingReservationForTable('table-1', [reservation], Date.parse('2026-11-05T19:00:00.000Z'))?.id, 'res-1');
  assert.equal(getUpcomingReservationForTable('table-1', [makeReservation({ status: 'NO_SHOW' })], Date.parse('2026-11-05T18:00:00.000Z')), undefined);
});

test('activa un recordatorio solo durante la ventana previa a la hora reservada', () => {
  const reservation = makeReservation({ reservedAt: '2026-11-05T18:30:00.000Z' });
  assert.equal(isReservationReminderDue(reservation, Date.parse('2026-11-05T18:00:00.000Z')), true);
  assert.equal(isReservationReminderDue(reservation, Date.parse('2026-11-05T18:29:00.000Z')), true);
  assert.equal(isReservationReminderDue(reservation, Date.parse('2026-11-05T17:59:00.000Z')), false);
  assert.equal(isReservationReminderDue(reservation, Date.parse('2026-11-05T18:30:00.000Z')), false);
  assert.equal(isReservationReminderDue({ ...reservation, status: 'CANCELLED' }, Date.parse('2026-11-05T18:00:00.000Z')), false);
});

test('asigna automáticamente mesas con capacidad sin duplicar horarios del mismo lote', () => {
  const tables = [makeTable('table-2', 2, 2), makeTable('table-4', 4, 4), makeTable('table-6', 6, 6)];
  const existing = [makeReservation({ tableId: 'table-2', reservedAt: new Date('2026-11-05T18:00:00').toISOString() })];
  const result = prepareBulkTableReservationInputs([
    { customerName: 'Ana', customerPhone: '8888-0001', time: '18:00', partySize: '2', tableId: '' },
    { customerName: 'Luis', customerPhone: '8888-0002', time: '18:00', partySize: '3', tableId: '' }
  ], '2026-11-05', tables, existing);

  assert.equal('error' in result, false);
  assert.deepEqual(result.inputs.map(input => input.tableId), ['table-4', 'table-6']);
  assert.equal(result.inputs[0].reservedAt, result.inputs[1].reservedAt);
});

test('rechaza una fila si la mesa elegida se solapa o no tiene capacidad', () => {
  const result = prepareBulkTableReservationInputs([
    { customerName: 'Ana', customerPhone: '8888-0001', time: '18:00', partySize: '3', tableId: 'table-2' }
  ], '2026-11-05', [makeTable('table-2', 2, 2)], []);
  assert.equal('error' in result, true);
  if ('error' in result) assert.match(result.error, /No hay una mesa libre/);
});

test('no crea el lote cuando faltan datos obligatorios', () => {
  const result = prepareBulkTableReservationInputs([
    { customerName: 'Ana', customerPhone: '', time: '18:00', partySize: '2', tableId: '' }
  ], '2026-11-05', [makeTable('table-2', 2, 2)], []);
  assert.equal('error' in result, true);
  if ('error' in result) assert.match(result.error, /teléfono/);
});
