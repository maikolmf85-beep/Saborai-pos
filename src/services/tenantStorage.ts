const STORAGE_PREFIX = 'saborai:tenant:';

const OPERATIONAL_KEYS = [
  'menu',
  'tables',
  'staff',
  'zones',
  'inventory_movements',
  'hacienda_config',
  'hacienda_invoices',
  'cash_registers',
  'current_terminal_id',
  'shifts_history',
  'shifts_map',
  'printers_config_v2',
  'customers',
  'notion_records',
  'kds_orders',
  'subscription'
] as const;

const LEGACY_KEY_MAP: Record<string, TenantStorageKey> = {
  saborai_menu: 'menu',
  saborai_tables: 'tables',
  saborai_staff: 'staff',
  saborai_zones: 'zones',
  saborai_inventory_movements: 'inventory_movements',
  saborai_hacienda_config: 'hacienda_config',
  saborai_hacienda_invoices: 'hacienda_invoices',
  saborai_cash_registers: 'cash_registers',
  saborai_current_terminal_id: 'current_terminal_id',
  saborai_shifts_history: 'shifts_history',
  saborai_shifts_map: 'shifts_map',
  saborai_printers_config_v2: 'printers_config_v2',
  saborai_customers: 'customers',
  saborai_subscription: 'subscription',
  saborai_notion_records: 'notion_records',
  saborai_kds_orders: 'kds_orders'
};

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
    'saborai_zones',
    'saborai_inventory_movements',
    'saborai_hacienda_config',
    'saborai_hacienda_invoices',
    'saborai_cash_registers',
    'saborai_current_terminal_id',
    'saborai_active_shift',
    'saborai_shifts_history',
    'saborai_shifts_map',
    'saborai_printers_config_v2',
    'saborai_customers',
    'saborai_subscription',
    'saborai_notion_records',
    'saborai_kds_orders'
  ].forEach(key => localStorage.removeItem(key));
}

/** Recupera datos previos solo cuando pertenecen al tenant autenticado. */
export function migrateLegacyDataToTenant(tenantId: string): boolean {
  if (typeof window === 'undefined' || !tenantId) return false;

  try {
    const legacyTenantRaw = localStorage.getItem('saborai_tenant');
    const legacyTenant = legacyTenantRaw ? JSON.parse(legacyTenantRaw) : null;
    if (!legacyTenant || String(legacyTenant.id) !== String(tenantId)) return false;

    let migrated = false;
    Object.entries(LEGACY_KEY_MAP).forEach(([legacyKey, scopedKey]) => {
      const legacyValue = localStorage.getItem(legacyKey);
      if (!legacyValue || hasTenantItem(scopedKey, tenantId)) return;
      try {
        setTenantItem(scopedKey, JSON.parse(legacyValue), tenantId);
        migrated = true;
      } catch {}
    });
    setActiveTenantId(tenantId);
    return migrated;
  } catch {
    return false;
  }
}

export function startCleanDemoSession(tenantId: string): void {
  clearLegacyOperationalData();
  clearTenantData(tenantId);
  setActiveTenantId(tenantId);
}
