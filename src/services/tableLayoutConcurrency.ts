import type { TableLayoutItem, TableLayoutRecord } from './tableLayoutValidation';

function sameItem(left: TableLayoutItem | undefined, right: TableLayoutItem | undefined): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Three-way merge por ID: aplica cambios locales sobre la base conocida y
 * conserva cambios remotos independientes. Ante edición simultánea de la misma
 * mesa, prevalece la versión remota para evitar sobrescribirla silenciosamente.
 */
export function mergeConcurrentTableLayouts(
  baseLayout: readonly TableLayoutItem[],
  localLayout: readonly TableLayoutItem[],
  remoteLayout: readonly TableLayoutItem[]
): TableLayoutItem[] {
  const base = new Map(baseLayout.map(item => [item.id, item]));
  const local = new Map(localLayout.map(item => [item.id, item]));
  const remote = new Map(remoteLayout.map(item => [item.id, item]));
  const orderedIds = [...new Set([...remoteLayout, ...localLayout, ...baseLayout].map(item => item.id))];
  const result: TableLayoutItem[] = [];

  for (const id of orderedIds) {
    const previous = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);
    const localChanged = !sameItem(previous, localItem);
    const remoteChanged = !sameItem(previous, remoteItem);
    const chosen = localChanged && !remoteChanged ? localItem : remoteItem;
    if (chosen) result.push(chosen);
  }
  return result;
}

type LayoutRowParser = (value: unknown) => TableLayoutRecord | null;

/** Guarda con CAS sobre updated_at; si otra sesión gana la carrera, relee, mezcla y reintenta. */
export async function persistTableLayoutWithClient(
  client: any,
  tenantId: string,
  localLayout: TableLayoutItem[],
  baseLayout: TableLayoutItem[],
  parseRow: LayoutRowParser,
  maxAttempts = 5
): Promise<TableLayoutRecord | null> {
  if (!client || !tenantId || !Array.isArray(localLayout) || !Array.isArray(baseLayout)) return null;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data: currentData, error: readError } = await client
        .from('pos_table_layouts')
        .select('layout, updated_at')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (readError) return null;

      if (!currentData) {
        const { data: inserted, error: insertError } = await client
          .from('pos_table_layouts')
          .insert({ tenant_id: tenantId, layout: localLayout })
          .select('layout, updated_at')
          .single();
        if (!insertError && inserted) return parseRow(inserted);
        if (insertError?.code === '23505' || insertError?.code === '409') continue;
        return null;
      }

      const current = parseRow(currentData);
      if (!current || !current.updatedAt) return null;
      const merged = mergeConcurrentTableLayouts(baseLayout, localLayout, current.layout);
      if (JSON.stringify(merged) === JSON.stringify(current.layout)) return current;

      const { data: updated, error: updateError } = await client
        .from('pos_table_layouts')
        .update({ layout: merged })
        .eq('tenant_id', tenantId)
        .eq('updated_at', current.updatedAt)
        .select('layout, updated_at')
        .maybeSingle();
      if (updateError) return null;
      if (updated) return parseRow(updated);
      // Another writer changed the row after our read; reload and merge again.
    }
  } catch {
    return null;
  }
  return null;
}
