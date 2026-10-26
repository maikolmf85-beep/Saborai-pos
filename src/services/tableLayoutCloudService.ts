import { supabaseClient } from '../lib/supabaseClient';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCloudTenantUuid(tenantId: string | null | undefined): tenantId is string {
  return typeof tenantId === 'string' && UUID_PATTERN.test(tenantId);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate and project the exact supported fields; order/status data is discarded. */
export function validateTableLayout(value: unknown): TableLayoutItem[] | null {
  if (!Array.isArray(value)) return null;
  const result: TableLayoutItem[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return null;
    if (!isFiniteNumber(item.number) || typeof item.name !== 'string' || typeof item.zone !== 'string') return null;
    if (!Number.isInteger(item.seats) || (item.seats as number) < 1) return null;
    if (item.shape !== 'square' && item.shape !== 'round' && item.shape !== 'bar') return null;
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return null;
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

function asRecord(data: any): TableLayoutRecord | null {
  if (!data) return null;
  const layout = validateTableLayout(data.layout);
  if (!layout) return null;
  return {
    layout,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null
  };
}

export async function readTableLayout(tenantId: string): Promise<TableLayoutReadResult> {
  if (!isCloudTenantUuid(tenantId) || !supabaseClient) {
    return { available: false, exists: false, record: null };
  }
  try {
    const { data, error } = await supabaseClient
      .from('pos_table_layouts')
      .select('layout, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) return { available: false, exists: false, record: null };
    if (!data) return { available: true, exists: false, record: null };
    const record = asRecord(data);
    return record
      ? { available: true, exists: true, record }
      : { available: false, exists: false, record: null };
  } catch {
    return { available: false, exists: false, record: null };
  }
}

export async function upsertTableLayout(tenantId: string, layout: unknown): Promise<boolean> {
  const validated = validateTableLayout(layout);
  if (!isCloudTenantUuid(tenantId) || !supabaseClient || !validated) return false;
  try {
    const { error } = await supabaseClient
      .from('pos_table_layouts')
      .upsert({
        tenant_id: tenantId,
        layout: validated,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id' });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Seed only an absent row. `ignoreDuplicates` makes concurrent first launches
 * safe: if another device wins the insert, its layout is retained.
 */
export async function seedTableLayoutIfMissing(
  tenantId: string,
  layout: unknown
): Promise<TableLayoutReadResult> {
  const validated = validateTableLayout(layout);
  if (!isCloudTenantUuid(tenantId) || !supabaseClient || !validated) {
    return { available: false, exists: false, record: null };
  }
  const existing = await readTableLayout(tenantId);
  if (!existing.available || existing.exists) return existing;
  try {
    const { error } = await supabaseClient
      .from('pos_table_layouts')
      .upsert({
        tenant_id: tenantId,
        layout: validated,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id', ignoreDuplicates: true });
    if (error) return { available: false, exists: false, record: null };
    return await readTableLayout(tenantId);
  } catch {
    return { available: false, exists: false, record: null };
  }
}

export function subscribeToTableLayout(
  tenantId: string,
  onLayout: (record: TableLayoutRecord) => void
): (() => void) | null {
  if (!isCloudTenantUuid(tenantId) || !supabaseClient) return null;
  try {
    const channel = supabaseClient
      .channel(`tenant-${tenantId}-table-layout`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pos_table_layouts',
        filter: `tenant_id=eq.${tenantId}`
      }, (payload: any) => {
        const record = asRecord(payload.new);
        if (record) onLayout(record);
      })
      .subscribe();
    return () => {
      void supabaseClient?.removeChannel(channel).catch(() => {});
    };
  } catch {
    return null;
  }
}
