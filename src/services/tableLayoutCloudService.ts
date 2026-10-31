import { supabaseClient } from '../lib/supabaseClient';
import { persistTableLayoutWithClient } from './tableLayoutConcurrency';
import { validateTableLayout } from './tableLayoutValidation';
import type { TableLayoutReadResult, TableLayoutRecord } from './tableLayoutValidation';

export { projectTableLayout, tableLayoutSignature, validateTableLayout } from './tableLayoutValidation';
export type { TableLayoutItem, TableLayoutReadResult, TableLayoutRecord, TableLayoutShape } from './tableLayoutValidation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCloudTenantUuid(tenantId: string | null | undefined): tenantId is string {
  return typeof tenantId === 'string' && UUID_PATTERN.test(tenantId);
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

export async function upsertTableLayout(
  tenantId: string,
  layout: unknown,
  baseLayout: unknown = []
): Promise<TableLayoutRecord | null> {
  const validated = validateTableLayout(layout);
  const validatedBase = validateTableLayout(baseLayout);
  if (!isCloudTenantUuid(tenantId) || !supabaseClient || !validated || !validatedBase) return null;
  return persistTableLayoutWithClient(
    supabaseClient,
    tenantId,
    validated,
    validatedBase,
    asRecord
  );
}

/** Seed only an absent row; a concurrent insert wins without replacing its layout. */
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
      .upsert({ tenant_id: tenantId, layout: validated }, { onConflict: 'tenant_id', ignoreDuplicates: true });
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
