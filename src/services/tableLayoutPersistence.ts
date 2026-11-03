import type { Table } from '../types';

/**
 * El snapshot de IndexedDB es un respaldo. Si el caché síncrono ya conserva
 * coordenadas de una mesa, estas son más recientes que un snapshot demorado.
 * Para cachés antiguos sin geometría, se usan las coordenadas del snapshot.
 */
export function restoreTablePositionsFromSnapshot(
  snapshotTables: Table[],
  rawLocalTables: unknown
): Table[] {
  const localById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(rawLocalTables)) {
    for (const candidate of rawLocalTables) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const table = candidate as Record<string, unknown>;
      if (typeof table.id === 'string' && table.id.trim()) localById.set(table.id, table);
    }
  }

  return snapshotTables.map(snapshotTable => {
    const local = localById.get(snapshotTable.id);
    if (!local) return snapshotTable;
    const restored = { ...snapshotTable };
    if (typeof local.x === 'number' && Number.isFinite(local.x)) {
      restored.x = Math.max(0, Math.min(100, local.x));
    }
    if (typeof local.y === 'number' && Number.isFinite(local.y)) {
      restored.y = Math.max(0, Math.min(100, local.y));
    }
    if (typeof local.rotation === 'number' && Number.isFinite(local.rotation)) {
      restored.rotation = local.rotation;
    }
    return restored;
  });
}
