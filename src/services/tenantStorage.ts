import { createDemoSeed, DEMO_TENANT_ID, type DemoSeed } from './demoSeed.ts';

const STORAGE_PREFIX = 'saborai:tenant:';

const OPERATIONAL_KEYS = [
  'menu',
  'tables',
  'staff',
  'zones',
  'inventory_ingredients',
  'inventory_movements',
  'hacienda_config',
  'hacienda_invoices',
  'cash_registers',
  'current_terminal_id',
  'shifts_history',
  'shifts_map',
  'printers_config_v2',
  'customers',
  'table_reservations',
  'table_reservations_outbox',
  'notion_records',
  'kds_orders',
  'subscription',
  'audit_events'
] as const;

const LEGACY_KEY_MAP: Record<string, TenantStorageKey> = {
  saborai_menu: 'menu',
  saborai_tables: 'tables',
  saborai_staff: 'staff',
  saborai_zones: 'zones',
  saborai_inventory_ingredients: 'inventory_ingredients',
  saborai_inventory_movements: 'inventory_movements',
  saborai_hacienda_invoices: 'hacienda_invoices',
  saborai_cash_registers: 'cash_registers',
  saborai_current_terminal_id: 'current_terminal_id',
  saborai_shifts_history: 'shifts_history',
  saborai_shifts_map: 'shifts_map',
  saborai_printers_config_v2: 'printers_config_v2',
  saborai_customers: 'customers',
  saborai_subscription: 'subscription',
  saborai_notion_records: 'notion_records',
  saborai_kds_orders: 'kds_orders',
  saborai_audit_events: 'audit_events'
};

export type TenantStorageKey = typeof OPERATIONAL_KEYS[number] | string;

function normalizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function isLocalDemoTenantId(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && /^tenant_demo(?:_|$)/i.test(tenantId.trim());
}

export function isCloudTenantId(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId.trim());
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

function redactTenantHaciendaSecrets<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const tenant = value as Record<string, any>;
  if (!tenant.haciendaConfig || typeof tenant.haciendaConfig !== 'object') return value;
  return {
    ...tenant,
    haciendaConfig: {
      ...tenant.haciendaConfig,
      atvUsername: undefined,
      atvPassword: undefined,
      pinP12: undefined,
      p12Base64: undefined
    }
  } as T;
}

/** Lee la configuración heredada solo si la copia global pertenece al tenant autenticado. */
export function getLegacyHaciendaConfigForTenant<T>(tenantId: string): T | null {
  const scoped = getTenantItem<T>('hacienda_config', tenantId);
  if (scoped) return scoped;
  if (typeof window === 'undefined' || !tenantId) return null;
  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const legacyTenant = rawTenant ? JSON.parse(rawTenant) : null;
    if (!legacyTenant || String(legacyTenant.id) !== String(tenantId)) return null;
    const rawConfig = localStorage.getItem('saborai_hacienda_config');
    return rawConfig ? JSON.parse(rawConfig) as T : null;
  } catch {
    return null;
  }
}

/** Elimina copias legadas solo después de confirmar que el perfil remoto se guardó o ya existe. */
export function clearLegacyHaciendaSecretsForTenant(tenantId: string): void {
  if (typeof window === 'undefined' || !tenantId) return;
  removeTenantItem('hacienda_config', tenantId);

  const scopedProfileKey = tenantStorageKey('tenant_profile', tenantId);
  if (scopedProfileKey) {
    try {
      const rawProfile = localStorage.getItem(scopedProfileKey);
      if (rawProfile) localStorage.setItem(scopedProfileKey, JSON.stringify(redactTenantHaciendaSecrets(JSON.parse(rawProfile))));
    } catch {}
  }

  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const legacyTenant = rawTenant ? JSON.parse(rawTenant) : null;
    if (legacyTenant && String(legacyTenant.id) === String(tenantId)) {
      localStorage.setItem('saborai_tenant', JSON.stringify(redactTenantHaciendaSecrets(legacyTenant)));
      localStorage.removeItem('saborai_hacienda_config');
    }
  } catch {}
}

export function clearTenantData(tenantId: string): void {
  if (typeof window === 'undefined') return;
  const normalizedId = normalizeId(tenantId);
  OPERATIONAL_KEYS.forEach(key => localStorage.removeItem(`${STORAGE_PREFIX}${normalizedId}:${key}`));
}

function clearStoredDemoData(): void {
  if (typeof window === 'undefined') return;
  const demoScopedPrefix = `${STORAGE_PREFIX}tenant_demo`;
  const demoOnlyPrefixes = [
    'saborai_table_positions_tenant_demo',
    'saborai_daily_cash_status:tenant_demo',
    'saborai_cash_control_migration:tenant_demo',
    'saborai_reservation_reminders_v1:tenant_demo'
  ];
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && (key.startsWith(demoScopedPrefix) || demoOnlyPrefixes.some(prefix => key.startsWith(prefix)))) {
      localStorage.removeItem(key);
    }
  }
}

export function clearLegacyOperationalData(): void {
  if (typeof window === 'undefined') return;
  [
    'saborai_menu',
    'saborai_tables',
    'saborai_staff',
    'saborai_zones',
    'saborai_inventory_ingredients',
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

export function clearLegacyCashControlData(): void {
  if (typeof window === 'undefined') return;
  [
    'saborai_cash_registers',
    'saborai_current_terminal_id',
    'saborai_active_shift',
    'saborai_shifts_history',
    'saborai_shifts_map'
  ].forEach(key => localStorage.removeItem(key));
}

/** Recupera datos previos solo cuando pertenecen al tenant autenticado. */
export function migrateLegacyDataToTenant(tenantId: string): boolean {
  if (typeof window === 'undefined' || !tenantId || isLocalDemoTenantId(tenantId)) return false;

  try {
    const legacyTenantRaw = localStorage.getItem('saborai_tenant');
    const legacyTenant = legacyTenantRaw ? JSON.parse(legacyTenantRaw) : null;
    if (!legacyTenant || String(legacyTenant.id) !== String(tenantId)) return false;
    localStorage.setItem('saborai_tenant', JSON.stringify(redactTenantHaciendaSecrets(legacyTenant)));

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

/** Limpia exclusivamente el espacio Demo y vuelve a instalar su seed ficticia. */
export function startCleanDemoSession(tenantId: string = DEMO_TENANT_ID): DemoSeed {
  if (!isLocalDemoTenantId(tenantId)) {
    throw new Error('La sesión de demostración requiere un tenant local tenant_demo.');
  }

  clearStoredDemoData();
  setActiveTenantId(tenantId);
  const seed = createDemoSeed();
  setTenantItem('zones', seed.zones, tenantId);
  setTenantItem('tables', seed.tables, tenantId);
  setTenantItem('menu', seed.menuItems, tenantId);
  setTenantItem('cash_registers', seed.cashRegisters, tenantId);
  setTenantItem('current_terminal_id', seed.cashRegisters[0]?.id || '', tenantId);
  setTenantItem('shifts_map', {}, tenantId);
  setTenantItem('shifts_history', [], tenantId);
  setTenantItem('staff', [], tenantId);
  setTenantItem('kds_orders', [], tenantId);
  setTenantItem('table_reservations', [], tenantId);
  setTenantItem('table_reservations_outbox', [], tenantId);
  setTenantItem('audit_events', [], tenantId);
  return seed;
}
