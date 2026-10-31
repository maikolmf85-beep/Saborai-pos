export type TableWithId = { id: string };

/** null significa que el payload no es un snapshot reconocible, no una lista vacía. */
export function readTableSnapshot(value: unknown): TableWithId[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some(table => !table || typeof table !== 'object' || Array.isArray(table) || typeof table.id !== 'string' || !table.id.trim())) {
    return null;
  }
  return value as TableWithId[];
}

/** Los snapshots reemplazan el conjunto completo; los deltas conservan lo no mencionado. */
export function resolveRealtimeTables<T extends TableWithId>(
  currentTables: readonly T[],
  incomingValue: unknown,
  isSnapshot: boolean
): T[] | null {
  const incomingTables = readTableSnapshot(incomingValue);
  if (!incomingTables) return null;
  if (isSnapshot) return [...incomingTables] as T[];

  const merged = new Map(currentTables.map(table => [table.id, table]));
  for (const incoming of incomingTables) {
    merged.set(incoming.id, { ...merged.get(incoming.id), ...incoming } as T);
  }
  return [...merged.values()];
}
