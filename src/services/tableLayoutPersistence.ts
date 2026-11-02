import type { Table } from '../types';

/** True only when the raw local cache contains geometry, before defaults are normalized. */
export function hasStoredTableGeometry(value: unknown): value is Table[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const table = candidate as Partial<Table>;
    return typeof table.id === 'string' && Number.isFinite(table.x) && Number.isFinite(table.y);
  });
}

/**
 * IndexedDB is a recovery source only when the synchronous tenant cache has no
 * saved geometry. It must not roll back a newer local layout during startup.
 */
export function restoreTablePositionsFromSnapshot(
  current: Table[],
  snapshotTables: Table[],
  localCacheHasGeometry: boolean
): Table[] {
  if (localCacheHasGeometry) return current;

  const snapshotById = new Map(snapshotTables.map(table => [table.id, table]));
  return current.map(table => {
    const cached = snapshotById.get(table.id);
    if (!cached) return table;
    return {
      ...table,
      x: Number.isFinite(cached.x) ? cached.x : table.x,
      y: Number.isFinite(cached.y) ? cached.y : table.y,
      rotation: cached.rotation
    };
  });
}
