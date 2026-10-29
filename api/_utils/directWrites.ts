export const TABLE_LAYOUT_SHAPES = ['square', 'round', 'bar'] as const;
export const RESERVATION_STATUSES = ['CONFIRMED', 'ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW'] as const;

export interface ValidatedTableLayoutItem {
  id: string;
  number: number;
  name: string;
  zone: string;
  seats: number;
  shape: typeof TABLE_LAYOUT_SHAPES[number];
  x: number;
  y: number;
  rotation?: number;
}

export interface ValidatedReservation {
  id: string;
  tableId: string;
  tableName: string;
  zone: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  reservedAt: string;
  durationMinutes: number;
  partySize: number;
  status: typeof RESERVATION_STATUSES[number];
  notes: string;
  arrivedAt: string | null;
  seatedAt: string | null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function boundedText(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} no es válido.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) throw new Error(`${label} no es válido.`);
  return normalized;
}

function isoDate(value: unknown, label: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} no es válida.`);
  return new Date(value).toISOString();
}

export function normalizeTableLayout(value: unknown): ValidatedTableLayoutItem[] {
  if (!Array.isArray(value) || value.length > 250) throw new Error('El diseño de mesas no es válido.');
  const ids = new Set<string>();
  return value.map((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('El diseño contiene una mesa inválida.');
    }
    const id = boundedText(candidate.id, 'El identificador de mesa', 120);
    if (ids.has(id)) throw new Error('El diseño contiene identificadores de mesa duplicados.');
    ids.add(id);
    if (!Number.isInteger(candidate.number) || candidate.number < 1
      || !Number.isInteger(candidate.seats) || candidate.seats < 1
      || typeof candidate.x !== 'number' || !Number.isFinite(candidate.x) || candidate.x < 0 || candidate.x > 100
      || typeof candidate.y !== 'number' || !Number.isFinite(candidate.y) || candidate.y < 0 || candidate.y > 100
      || (candidate.rotation !== undefined && (typeof candidate.rotation !== 'number' || !Number.isFinite(candidate.rotation)))
      || !TABLE_LAYOUT_SHAPES.includes(candidate.shape)) {
      throw new Error('La posición o configuración de una mesa no es válida.');
    }
    return {
      id,
      number: candidate.number,
      name: boundedText(candidate.name, 'El nombre de mesa', 120),
      zone: boundedText(candidate.zone, 'La zona', 120, true),
      seats: candidate.seats,
      shape: candidate.shape,
      x: candidate.x,
      y: candidate.y,
      ...(candidate.rotation === undefined ? {} : { rotation: candidate.rotation })
    };
  });
}

export function normalizeReservation(value: unknown): ValidatedReservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La reserva no es válida.');
  const raw = value as Record<string, unknown>;
  if (!isUuid(raw.id)) throw new Error('El identificador de la reserva no es válido.');
  if (!Number.isInteger(raw.durationMinutes) || Number(raw.durationMinutes) < 15 || Number(raw.durationMinutes) > 720) {
    throw new Error('La duración de la reserva no es válida.');
  }
  if (!Number.isInteger(raw.partySize) || Number(raw.partySize) < 1 || Number(raw.partySize) > 100) {
    throw new Error('El tamaño del grupo no es válido.');
  }
  if (!RESERVATION_STATUSES.includes(raw.status as typeof RESERVATION_STATUSES[number])) {
    throw new Error('El estado de la reserva no es válido.');
  }

  const customerEmail = raw.customerEmail === null || raw.customerEmail === undefined || raw.customerEmail === ''
    ? null
    : boundedText(raw.customerEmail, 'El correo del cliente', 320).toLowerCase();
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new Error('El correo del cliente no es válido.');
  }

  return {
    id: raw.id,
    tableId: boundedText(raw.tableId, 'La mesa', 120),
    tableName: boundedText(raw.tableName, 'El nombre de mesa', 120),
    zone: boundedText(raw.zone ?? '', 'La zona', 120, true),
    customerName: boundedText(raw.customerName, 'El nombre del cliente', 160),
    customerPhone: boundedText(raw.customerPhone, 'El teléfono del cliente', 40),
    customerEmail,
    reservedAt: isoDate(raw.reservedAt, 'La fecha de la reserva') as string,
    durationMinutes: Number(raw.durationMinutes),
    partySize: Number(raw.partySize),
    status: raw.status as typeof RESERVATION_STATUSES[number],
    notes: boundedText(raw.notes ?? '', 'Las notas', 1000, true),
    arrivedAt: isoDate(raw.arrivedAt, 'La hora de llegada', true),
    seatedAt: isoDate(raw.seatedAt, 'La hora de ubicación', true)
  };
}
