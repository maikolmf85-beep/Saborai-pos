const STORAGE_PREFIX = 'saborai:tenant:';

const OPERATIONAL_KEYS = [
  'menu',
  'tables',
  'staff',
  'inventory_movements',
  'hacienda_config',
  'hacienda_invoices',
  'cash_registers',
  'shifts_history',
  'shifts_map',
  'printers_config_v2',
  'notion_records',
  'kds_orders',
  'subscription'
] as const;

export type TenantStorageKey = typeof OPERATIONAL_KEYS[number] | string;

function normalizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function getStoredTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  const explicit = localStorage.getItem('saborai_active_tenant_id');
  if (explicit) return explicit;

  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const tenant = rawTenant ? JSON.parse(rawTenant) : null;
    return tenant?.id ? String(tenant.id) : null;
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string): void {
  if (typeof window === 'undefined' || !tenantId) return;
  localStorage.setItem('saborai_active_tenant_id', tenantId);
}

export function tenantStorageKey(key: TenantStorageKey, tenantId?: string | null): string | null {
  const resolvedTenantId = tenantId || getStoredTenantId();
  if (!resolvedTenantId) return null;
  return `${STORAGE_PREFIX}${normalizeId(resolvedTenantId)}:${key}`;
}

export function getTenantItem<T>(key: TenantStorageKey, tenantId?: string | null): T | null {
  const scopedKey = tenantStorageKey(key, tenantId);
  if (!scopedKey || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(scopedKey);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function setTenantItem(key: TenantStorageKey, value: unknown, tenantId?: string | null): void {
  const scopedKey = tenantStorageKey(key, tenantId);
  if (!scopedKey || typeof window === 'undefined') return;
  try {
    localStorage.setItem(scopedKey, JSON.stringify(value));
  } catch {}
}

export function removeTenantItem(key: TenantStorageKey, tenantId?: string | null): void {
  const scopedKey = tenantStorageKey(key, tenantId);
  if (scopedKey && typeof window !== 'undefined') localStorage.removeItem(scopedKey);
}

export function hasTenantItem(key: TenantStorageKey, tenantId?: string | null): boolean {
  const scopedKey = tenantStorageKey(key, tenantId);
  return Boolean(scopedKey && typeof window !== 'undefined' && localStorage.getItem(scopedKey));
}

export function clearTenantData(tenantId: string): void {
  if (typeof window === 'undefined') return;
  const normalizedId = normalizeId(tenantId);
  OPERATIONAL_KEYS.forEach(key => localStorage.removeItem(`${STORAGE_PREFIX}${normalizedId}:${key}`));
}

export function clearLegacyOperationalData(): void {
  if (typeof window === 'undefined') return;
  [
    'saborai_menu',
    'saborai_tables',
    'saborai_staff',
    'saborai_inventory_movements',
    'saborai_hacienda_config',
    'saborai_hacienda_invoices',
    'saborai_cash_registers',
    'saborai_shifts_history',
    'saborai_shifts_map',
    'saborai_printers_config_v2',
    'saborai_notion_records',
    'saborai_kds_orders'
  ].forEach(key => localStorage.removeItem(key));
}

export function startCleanDemoSession(tenantId: string): void {
  clearLegacyOperationalData();
  clearTenantData(tenantId);
  setActiveTenantId(tenantId);
}
