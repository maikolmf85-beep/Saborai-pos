export type TableLayoutShape = 'square' | 'round' | 'bar';

/** Only geometry/identity fields belong in the shared floor-plan record. */
export interface TableLayoutItem {
  id: string;
  number: number;
  name: string;
  zone: string;
  seats: number;
  shape: TableLayoutShape;
  x: number;
  y: number;
  rotation?: number;
}

export interface TableLayoutRecord {
  layout: TableLayoutItem[];
  updatedAt: string | null;
}

export interface TableLayoutReadResult {
  available: boolean;
  exists: boolean;
  record: TableLayoutRecord | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate the exact fields and scalar constraints enforced by SQL. */
export function validateTableLayout(value: unknown): TableLayoutItem[] | null {
  if (!Array.isArray(value)) return null;
  const result: TableLayoutItem[] = [];
  const ids = new Set<string>();
  const allowedFields = new Set(['id', 'number', 'name', 'zone', 'seats', 'shape', 'x', 'y', 'rotation']);

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some(key => !allowedFields.has(key))) return null;
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return null;
    if (!isFiniteNumber(item.number) || !Number.isInteger(item.number) || item.number < 1) return null;
    if (typeof item.name !== 'string' || !item.name.trim() || typeof item.zone !== 'string') return null;
    if (!Number.isInteger(item.seats) || (item.seats as number) < 1) return null;
    if (item.shape !== 'square' && item.shape !== 'round' && item.shape !== 'bar') return null;
    if (!isFiniteNumber(item.x) || item.x < 0 || item.x > 100) return null;
    if (!isFiniteNumber(item.y) || item.y < 0 || item.y > 100) return null;
    if (item.rotation !== undefined && !isFiniteNumber(item.rotation)) return null;

    ids.add(item.id);
    result.push({
      id: item.id,
      number: item.number,
      name: item.name,
      zone: item.zone,
      seats: item.seats as number,
      shape: item.shape,
      x: item.x,
      y: item.y,
      ...(item.rotation === undefined ? {} : { rotation: item.rotation as number })
    });
  }
  return result;
}

export function projectTableLayout(tables: Array<{
  id: string;
  number: number;
  name: string;
  zone: string;
  seats: number;
  shape: TableLayoutShape;
  x: number;
  y: number;
  rotation?: number;
}>): TableLayoutItem[] {
  return tables.map(table => ({
    id: table.id,
    number: table.number,
    name: table.name,
    zone: table.zone,
    seats: table.seats,
    shape: table.shape,
    x: table.x,
    y: table.y,
    ...(table.rotation === undefined ? {} : { rotation: table.rotation })
  }));
}

export function tableLayoutSignature(layout: TableLayoutItem[]): string {
  return JSON.stringify(layout);
}
