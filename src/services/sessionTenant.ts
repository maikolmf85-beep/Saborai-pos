import type { SaboraiSubscription } from '../components/WelcomeGate';
import type { HaciendaConfig, MenuItem, Table, TenantInfo, UserProfile } from '../types';
import { withoutEmployeePin } from './employeeSessionService.ts';
import { getTenantItem, isLocalDemoTenantId, setTenantItem } from './tenantStorage.ts';
import { resolveTenantZones } from './tenantZones.ts';

export function withoutHaciendaSecrets(config?: HaciendaConfig | null): HaciendaConfig | undefined {
  if (!config) return undefined;
  return {
    ...config,
    atvUsername: undefined,
    atvPassword: undefined,
    pinP12: undefined,
    p12Base64: undefined
  };
}

export function withPublicHaciendaConfig(tenant: TenantInfo): TenantInfo {
  return { ...tenant, haciendaConfig: withoutHaciendaSecrets(tenant.haciendaConfig) };
}

export function getTenantProfileWithLegacyFallback(tenantId: string): TenantInfo | null {
  const scopedTenant = getTenantItem<TenantInfo>('tenant_profile', tenantId);
  const storedZones = getTenantItem<string[]>('zones', tenantId);
  if (scopedTenant) {
    return withPublicHaciendaConfig({
      ...scopedTenant,
      zones: Array.isArray(storedZones) ? storedZones : (scopedTenant.zones || [])
    });
  }

  // Compatibilidad con sesiones anteriores: antes de esta reparación el
  // tenant completo se guardaba solamente en saborai_tenant.
  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const legacyTenant = rawTenant ? JSON.parse(rawTenant) as TenantInfo : null;
    return legacyTenant && String(legacyTenant.id) === String(tenantId)
      ? withPublicHaciendaConfig({ ...legacyTenant, zones: Array.isArray(storedZones) ? storedZones : (legacyTenant.zones || []) })
      : null;
  } catch {
    return null;
  }
}

export function redactEmployeePins(staff: UserProfile[]): UserProfile[] {
  return staff.map(member => withoutEmployeePin(member) as UserProfile);
}

export function readInitialCurrentUser(): UserProfile | null {
  try {
    const saved = localStorage.getItem('saborai_user');
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export function readInitialSubscription(): SaboraiSubscription | null {
  try {
    return getTenantItem<SaboraiSubscription>('subscription') || null;
  } catch {
    return null;
  }
}

export function readInitialTenant(initialTenant: TenantInfo): TenantInfo {
  try {
    const saved = localStorage.getItem('saborai_tenant');
    const savedZones = getTenantItem<string[]>('zones');
    if (saved) {
      const parsed = JSON.parse(saved);
      return withPublicHaciendaConfig({
        ...initialTenant,
        ...parsed,
        zones: Array.isArray(savedZones) ? savedZones : (parsed.zones || []),
        taxRegime: parsed.taxRegime || 'TRADITIONAL',
        includeService10ByDefault: parsed.includeService10ByDefault ?? true,
        haciendaConfig: parsed.haciendaConfig
      });
    }
    return withPublicHaciendaConfig({ ...initialTenant, zones: savedZones || [] });
  } catch {
    return initialTenant;
  }
}

export interface RestoreSessionActions {
  activeTenantIdRef: { current: string };
  setIsLoadingAuth: (loading: boolean) => void;
  setCurrentUser: (user: UserProfile | null) => void;
  setTenant: (tenant: TenantInfo) => void;
  setMenuItems: (items: MenuItem[]) => void;
  setTables: (tables: Table[]) => void;
  setStaffList: (staff: UserProfile[]) => void;
  setSubscription: (subscription: SaboraiSubscription | null) => void;
  persistSubscription: (subscription: SaboraiSubscription | null, tenantId: string) => void;
  normalizeTablePositions: (tables: Table[]) => Table[];
  setLocalDbTenant: (tenantId: string) => void;
  activateTenant: (tenantId: string) => void;
  resumePendingSync: (tenantId: string) => void;
  fetchSession?: typeof fetch;
}

/** Valida el token con el backend y restaura únicamente la identidad efectiva que este devuelve. */
export async function restoreStoredSession(actions: RestoreSessionActions): Promise<void> {
  const activeTenantId = localStorage.getItem('saborai_active_tenant_id');
  if (isLocalDemoTenantId(activeTenantId)) {
    actions.setIsLoadingAuth(false);
    return;
  }
  const token = localStorage.getItem('saborai_token');
  if (!token) {
    actions.setIsLoadingAuth(false);
    return;
  }

  try {
    const request = actions.fetchSession || fetch;
    const response = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (response.ok && data.success) {
      actions.activeTenantIdRef.current = data.tenant.id;
      actions.setLocalDbTenant(data.tenant.id);
      try {
        localStorage.setItem('saborai_account_user_id', String(data.accountUserId || data.user.id));
        if (data.employeeSession && data.employeeId) localStorage.setItem('saborai_employee_id', String(data.employeeId));
        else localStorage.removeItem('saborai_employee_id');
      } catch {}
      actions.activateTenant(data.tenant.id);
      const user: UserProfile = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        phone: data.user.phone,
        restaurantName: data.user.restaurant_name,
        role: data.user.role,
        active: data.user.active
      };
      const savedTenant = getTenantProfileWithLegacyFallback(data.tenant.id);

      const tenantObj: TenantInfo = {
        id: data.tenant.id,
        name: data.tenant.name,
        cedulaJuridica: data.tenant.cedula_juridica || savedTenant?.cedulaJuridica || '',
        email: data.tenant.email,
        phone: data.tenant.phone,
        location: data.tenant.location || 'Costa Rica',
        plan: data.tenant.plan,
        status: data.tenant.status,
        currency: data.tenant.currency,
        monthlyFee: data.tenant.monthly_fee || 45000,
        onboardingCompleted: data.tenant.onboardingCompleted,
        taxRegime: savedTenant?.taxRegime || 'TRADITIONAL',
        includeService10ByDefault: savedTenant?.includeService10ByDefault ?? true,
        haciendaConfig: withoutHaciendaSecrets(savedTenant?.haciendaConfig),
        zones: resolveTenantZones(
          data.tenant.zones,
          getTenantItem<string[]>('zones', data.tenant.id) ?? savedTenant?.zones
        ),
        menuCategories: savedTenant?.menuCategories || []
      };
      const subscription: SaboraiSubscription = {
        mode: data.subscription?.mode === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
        email: user.email,
        activatedAt: data.subscription?.activated_at || new Date().toISOString(),
        trialEndsAt: data.subscription?.trial_ends_at
      };

      // La identidad y el rol efectivo vienen del JWT/backend. No aceptar
      // un usuario o rol alternativo desde localStorage.
      const effectiveUser = user;
      actions.setCurrentUser(effectiveUser);
      actions.activeTenantIdRef.current = tenantObj.id;
      actions.setTenant(tenantObj);
      actions.setMenuItems(getTenantItem<MenuItem[]>('menu', tenantObj.id) || []);
      actions.setTables(actions.normalizeTablePositions(getTenantItem<Table[]>('tables', tenantObj.id) || []));
      const cachedStaff = getTenantItem<UserProfile[]>('staff', tenantObj.id) || [effectiveUser];
      const effectiveStaff = data.employeeSession ? redactEmployeePins(cachedStaff) : cachedStaff;
      actions.setStaffList(effectiveStaff);
      if (data.employeeSession) setTenantItem('staff', effectiveStaff, tenantObj.id);
      actions.setSubscription(subscription);
      actions.persistSubscription(subscription, tenantObj.id);
      try {
        localStorage.setItem('saborai_user', JSON.stringify(effectiveUser));
        localStorage.setItem('saborai_tenant', JSON.stringify(tenantObj));
        setTenantItem('tenant_profile', tenantObj, tenantObj.id);
        setTenantItem('zones', tenantObj.zones || [], tenantObj.id);
      } catch {}
      actions.resumePendingSync(tenantObj.id);
    } else {
      // Token inválido o vencido.
      localStorage.removeItem('saborai_token');
      localStorage.removeItem('saborai_account_user_id');
      localStorage.removeItem('saborai_employee_id');
    }
  } catch (error) {
    console.error('Failed to validate session', error);
  } finally {
    actions.setIsLoadingAuth(false);
  }
}
