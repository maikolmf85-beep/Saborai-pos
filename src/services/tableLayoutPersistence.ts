import type { Table } from '../types';

export const TABLE_LAYOUT_SYNC_WARNING_KEY = 'saborai_pending_table_layout_sync_warning';
export const TABLE_LAYOUT_SYNC_WARNING_EVENT = 'saborai_table_layout_sync_saved';
export const TABLE_LAYOUT_SYNC_WARNING_MESSAGE = 'La nube no confirmó el último cambio del plano. Los cambios siguen en este dispositivo y se reintentará; no borres sus datos locales hasta confirmar la sincronización.';

/**
 * IndexedDB es un respaldo demorado; la caché scoped de localStorage se escribe
 * sincrónicamente en cada cambio. Si existe una lista local válida, es dueña de
 * la membresía y de los datos del plano, incluso cuando está vacía; los campos
 * operativos del snapshot se conservan para no revertir estados de comandas.
 */
export function restoreTablePositionsFromSnapshot(
  snapshotTables: Table[],
  rawLocalTables: unknown
): Table[] {
  const localById = new Map<string, Record<string, unknown>>();
  let localSnapshotIsValid = Array.isArray(rawLocalTables);
  const localIds = new Set<string>();

  if (Array.isArray(rawLocalTables)) {
    for (const candidate of rawLocalTables) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        localSnapshotIsValid = false;
        continue;
      }
      const table = candidate as Record<string, unknown>;
      if (typeof table.id !== 'string' || !table.id.trim() || localIds.has(table.id)) {
        localSnapshotIsValid = false;
        continue;
      }
      localIds.add(table.id);
      localById.set(table.id, table);
    }
  }

  const snapshotById = new Map(snapshotTables.map(table => [table.id, table]));
  const sourceTables = localSnapshotIsValid
    ? rawLocalTables as Array<Record<string, unknown>>
    : snapshotTables as Array<Record<string, unknown>>;

  return sourceTables.map(source => {
    const id = typeof source.id === 'string' ? source.id : '';
    const local = localById.get(id);
    const snapshot = snapshotById.get(id);
    const restored = (localSnapshotIsValid && snapshot
      ? { ...snapshot }
      : { ...source }) as unknown as Table;

    if (localSnapshotIsValid && local && snapshot) {
      const restoredRecord = restored as unknown as Record<string, unknown>;
      for (const key of ['number', 'name', 'zone', 'seats', 'shape'] as const) {
        if (Object.prototype.hasOwnProperty.call(local, key)) restoredRecord[key] = local[key];
      }
    }

    if (local && typeof local.x === 'number' && Number.isFinite(local.x)) {
      restored.x = Math.max(0, Math.min(100, local.x));
    }
    if (local && typeof local.y === 'number' && Number.isFinite(local.y)) {
      restored.y = Math.max(0, Math.min(100, local.y));
    }
    if (local && typeof local.rotation === 'number' && Number.isFinite(local.rotation)) {
      restored.rotation = local.rotation;
    }
    return restored;
  });
}
