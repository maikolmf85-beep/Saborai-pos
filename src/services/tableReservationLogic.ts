import type { Table } from '../types';
import type { TableReservation, TableReservationInput } from '../types/tableReservation';

export const RESERVATION_REMINDER_LEAD_MINUTES = 30;
const RESERVED_STATUSES = new Set<TableReservation['status']>(['CONFIRMED', 'ARRIVED', 'SEATED']);
const VISIBLE_RESERVATION_STATUSES = new Set<TableReservation['status']>(['CONFIRMED', 'ARRIVED']);

export interface BulkReservationDraft {
  customerName: string;
  customerPhone: string;
  time: string;
  partySize: string;
  tableId: string;
}

export function hasTableReservationTimeConflict(
  reservations: TableReservation[],
  tableId: string,
  reservedAtIso: string,
  durationMinutes: number,
  ignoreId?: string
): TableReservation | undefined {
  const start = new Date(reservedAtIso).getTime();
  const end = start + durationMinutes * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;

  return reservations.find(item => {
    if (item.id === ignoreId || item.tableId !== tableId || !RESERVED_STATUSES.has(item.status)) return false;
    const otherStart = new Date(item.reservedAt).getTime();
    const otherEnd = otherStart + item.durationMinutes * 60_000;
    return Number.isFinite(otherStart) && start < otherEnd && otherStart < end;
  });
}

export function getUpcomingReservationForTable(
  tableId: string,
  reservations: TableReservation[],
  nowMs = Date.now()
): TableReservation | undefined {
  return reservations
    .filter(item => item.tableId === tableId && VISIBLE_RESERVATION_STATUSES.has(item.status))
    .filter(item => {
      const start = new Date(item.reservedAt).getTime();
      const end = start + item.durationMinutes * 60_000;
      return Number.isFinite(start)
        && start - RESERVATION_REMINDER_LEAD_MINUTES * 60_000 <= nowMs
        && nowMs < end;
    })
    .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt))[0];
}

export function isReservationReminderDue(reservation: TableReservation, nowMs = Date.now()): boolean {
  if (reservation.status !== 'CONFIRMED') return false;
  const start = new Date(reservation.reservedAt).getTime();
  const reminderAt = start - RESERVATION_REMINDER_LEAD_MINUTES * 60_000;
  return Number.isFinite(start) && nowMs >= reminderAt && nowMs < start;
}

function parseLocalReservationTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const local = new Date(`${date}T${time}:00`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

export function prepareBulkTableReservationInputs(
  rows: BulkReservationDraft[],
  date: string,
  tables: Table[],
  reservations: TableReservation[],
  durationMinutes = 90,
  zoneFilter = ''
): { inputs: TableReservationInput[]; error?: never } | { inputs: []; error: string } {
  if (!rows.length) return { inputs: [], error: 'Agrega al menos una reserva a la lista.' };

  const conflictPool = [...reservations];
  const inputs: TableReservationInput[] = [];

  for (const [index, row] of rows.entries()) {
    const customerName = row.customerName.trim();
    const customerPhone = row.customerPhone.trim();
    if (!customerName) return { inputs: [], error: `Escribe el nombre de la reserva ${index + 1}.` };
    if (!customerPhone) return { inputs: [], error: `Escribe el teléfono de la reserva ${index + 1}.` };
    const reservedAt = parseLocalReservationTime(date, row.time);
    if (!reservedAt) return { inputs: [], error: `Revisa la fecha y hora de la reserva ${index + 1}.` };

    const partySize = Number(row.partySize);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
      return { inputs: [], error: `Indica entre 1 y 100 personas para la reserva ${index + 1}.` };
    }

    const salonTables = zoneFilter ? tables.filter(table => table.zone === zoneFilter) : tables;
    const manuallySelectedTable = row.tableId ? tables.find(table => table.id === row.tableId) : undefined;
    if (row.tableId && !manuallySelectedTable) {
      return { inputs: [], error: `La mesa seleccionada para la reserva ${index + 1} ya no existe.` };
    }
    if (manuallySelectedTable && zoneFilter && manuallySelectedTable.zone !== zoneFilter) {
      return { inputs: [], error: `La mesa seleccionada para la reserva ${index + 1} no pertenece al salón ${zoneFilter}.` };
    }

    const candidates = manuallySelectedTable
      ? [manuallySelectedTable]
      : [...salonTables].sort((a, b) => a.seats - b.seats || a.number - b.number);
    if (!candidates.length) {
      return { inputs: [], error: zoneFilter
        ? `No hay mesas configuradas en el salón ${zoneFilter}.`
        : `La mesa seleccionada para la reserva ${index + 1} ya no existe.` };
    }

    const table = candidates.find(candidate => candidate.seats >= partySize
      && !hasTableReservationTimeConflict(conflictPool, candidate.id, reservedAt, durationMinutes));
    if (!table) {
      return {
        inputs: [],
        error: `No hay una mesa libre con capacidad para ${customerName} a las ${row.time}${zoneFilter ? ` en el salón ${zoneFilter}` : ''}. Cambia la hora o elige otra mesa.`
      };
    }

    const input: TableReservationInput = {
      tableId: table.id,
      tableName: table.name || `Mesa ${table.number}`,
      zone: table.zone || 'General',
      customerName,
      customerPhone,
      reservedAt,
      durationMinutes,
      partySize,
      status: 'CONFIRMED',
      notes: ''
    };
    inputs.push(input);
    conflictPool.push({
      ...input,
      id: `bulk-preview-${index}`,
      tenantId: '',
      status: 'CONFIRMED',
      notes: '',
      arrivedAt: null,
      seatedAt: null,
      createdAt: '',
      updatedAt: ''
    });
  }

  return { inputs };
}
