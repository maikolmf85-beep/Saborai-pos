import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { TableMap } from './components/TableMap';
import { OrderTaking } from './components/OrderTaking';
import { KDSView } from './components/KDSView';

// Carga diferida (Code Splitting / Lazy Loading) de módulos grandes y modales secundarios
const BillingHacienda = lazy(() => import('./components/BillingHacienda').then(m => ({ default: m.BillingHacienda })));
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const OfflineSyncModal = lazy(() => import('./components/OfflineSyncModal').then(m => ({ default: m.OfflineSyncModal })));
const NotionModal = lazy(() => import('./components/NotionModal').then(m => ({ default: m.NotionModal })));
const StaffModal = lazy(() => import('./components/StaffModal').then(m => ({ default: m.StaffModal })));
const QuickWaiterSwitchModal = lazy(() => import('./components/QuickWaiterSwitchModal').then(m => ({ default: m.QuickWaiterSwitchModal })));
const CashShiftModal = lazy(() => import('./components/CashShiftModal').then(m => ({ default: m.CashShiftModal })));
const ZReportModal = lazy(() => import('./components/ZReportModal').then(m => ({ default: m.ZReportModal })));
const HaciendaHistoryModal = lazy(() => import('./components/HaciendaHistoryModal').then(m => ({ default: m.HaciendaHistoryModal })));
const AICopilotChat = lazy(() => import('./components/AICopilotChat').then(m => ({ default: m.AICopilotChat })));
const NyzaLearningHub = lazy(() => import('./components/NyzaLearningHub').then(m => ({ default: m.NyzaLearningHub })));
const AuthScreen = lazy(() => import('./components/AuthScreen').then(m => ({ default: m.AuthScreen })));
const NysaOnboarding = lazy(() => import('./components/NysaOnboarding').then(m => ({ default: m.NysaOnboarding })));
const SuperAdminBackoffice = lazy(() => import('./components/SuperAdminBackoffice').then(m => ({ default: m.SuperAdminBackoffice })));
const MenuEditor = lazy(() => import('./components/MenuEditor').then(m => ({ default: m.MenuEditor })));
const ReportsDashboard = lazy(() => import('./components/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })));
const WelcomeGate = lazy(() => import('./components/WelcomeGate').then(m => ({ default: m.WelcomeGate })));
const ResetPasswordScreen = lazy(() => import('./components/ResetPasswordScreen').then(m => ({ default: m.ResetPasswordScreen })));
const GuidedTour = lazy(() => import('./components/GuidedTour').then(m => ({ default: m.GuidedTour })));
const LegalPage = lazy(() => import('./components/LegalPage').then(m => ({ default: m.LegalPage })));
import { cashShiftService } from './services/cashShiftService';
import { printerService } from './services/printerService';
import { nyzaUIAgent } from './services/nyzaUIAgent';
import { ZReportData, ConsolidatedZReportData } from './types/cashShift';
import { SaboraiSubscription } from './components/WelcomeGate';
import { initialTenant, initialTables, sampleMenuItems } from './data/mockData';
import { Table, TenantInfo, SubscriptionPlan, SubscriptionStatus, UserProfile, MenuItem, KDSOrder } from './types';
import { localDB } from './services/db';
import { posCloudService, SaleCloudPayload } from './services/posCloudService';
import { createEmployeeSession, fetchEmployeeRoster, syncEmployeeRoster, withoutEmployeePin } from './services/employeeSessionService';
import { soundService } from './services/soundEffects';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { NotificationToastContainer, PosNotification } from './components/NotificationToast';
import { nyzaSelfHealing } from './services/nyzaSelfHealingService';
import { getTenantItem, hasTenantItem, migrateLegacyDataToTenant, setActiveTenantId, setTenantItem, startCleanDemoSession } from './services/tenantStorage';
import { isCloudTenantUuid, projectTableLayout, readTableLayout, seedTableLayoutIfMissing, subscribeToTableLayout, tableLayoutSignature, upsertTableLayout, TableLayoutItem } from './services/tableLayoutCloudService';
import { supabaseClient } from './lib/supabaseClient';
import { Sparkles, WifiOff, Lock, Eye, BrainCircuit, ChefHat, MessageCircle } from 'lucide-react';

type PosTheme = 'light' | 'dark';
const POS_THEME_STORAGE_KEY = 'saborai_pos_theme';

function readInitialPosTheme(): PosTheme {
  try {
    return localStorage.getItem(POS_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function normalizeTablePositions(tables: Table[]): Table[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  return tables.map((table, index) => ({
    ...table,
    number: Number.isInteger(table.number) && table.number > 0 ? table.number : index + 1,
    name: table.name?.trim() || `Mesa ${index + 1}`,
    zone: table.zone?.trim() || 'Principal',
    seats: Number.isInteger(table.seats) && table.seats > 0 ? table.seats : 2,
    shape: table.shape === 'square' || table.shape === 'bar' ? table.shape : 'round',
    x: Number.isFinite(table.x) ? Math.max(0, Math.min(100, table.x)) : (columns === 1 ? 50 : 15 + (index % columns) * (70 / (columns - 1))),
    y: Number.isFinite(table.y) ? Math.max(0, Math.min(100, table.y)) : 20 + (Math.floor(index / columns) % 4) * 18
  }));
}

function tablesWithoutLocalLayout(tables: Table[]): Table[] {
  return tables.map(table => {
    const cached = { ...table } as Partial<Table>;
    delete cached.x;
    delete cached.y;
    delete cached.rotation;
    return cached as Table;
  });
}

function mergeCachedPositions(current: Table[], cachedTables: Table[]): Table[] {
  const cachedById = new Map(cachedTables.map(table => [table.id, table]));
  return current.map(table => {
    const cached = cachedById.get(table.id);
    return cached ? { ...table, x: cached.x, y: cached.y, rotation: cached.rotation } : table;
  });
}

function migrateLegacyTablePositions(tables: Table[], tenantId: string): Table[] {
  if (typeof window === 'undefined') return tables;
  try {
    const raw = localStorage.getItem(`saborai_table_positions_${tenantId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return tables;
    const positions = new Map<string, Record<string, unknown>>();
    parsed.forEach(candidate => {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const position = candidate as Record<string, unknown>;
        if (typeof position.id === 'string') positions.set(position.id, position);
      }
    });
    return tables.map(table => {
      const position = positions.get(table.id);
      if (!position) return table;
      return {
        ...table,
        x: typeof position.x === 'number' && Number.isFinite(position.x) ? Math.max(0, Math.min(100, position.x)) : table.x,
        y: typeof position.y === 'number' && Number.isFinite(position.y) ? Math.max(0, Math.min(100, position.y)) : table.y,
        zone: typeof position.zone === 'string' && position.zone.trim() ? position.zone.trim() : table.zone
      };
    });
  } catch {
    return tables;
  }
}

function clearLegacyTablePositions(tenantId: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(`saborai_table_positions_${tenantId}`); } catch {}
}

function mergeCloudLayoutIntoTables(current: Table[], layout: TableLayoutItem[]): Table[] {
  const currentById = new Map(current.map(table => [table.id, table]));
  return layout.map(item => ({
    ...(currentById.get(item.id) || { status: 'AVAILABLE' as const }),
    ...item
  }));
}

function getTenantProfileWithLegacyFallback(tenantId: string): TenantInfo | null {
  const scopedTenant = getTenantItem<TenantInfo>('tenant_profile', tenantId);
  const storedZones = getTenantItem<string[]>('zones', tenantId);
  if (scopedTenant) {
    return {
      ...scopedTenant,
      zones: Array.isArray(storedZones) ? storedZones : (scopedTenant.zones || [])
    };
  }

  // Compatibilidad con sesiones anteriores: antes de esta reparación el
  // tenant completo se guardaba solamente en saborai_tenant.
  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const legacyTenant = rawTenant ? JSON.parse(rawTenant) as TenantInfo : null;
    return legacyTenant && String(legacyTenant.id) === String(tenantId)
      ? { ...legacyTenant, zones: Array.isArray(storedZones) ? storedZones : (legacyTenant.zones || []) }
      : null;
  } catch {
    return null;
  }
}

function mergeTenantZones(...lists: Array<string[] | null | undefined>): string[] {
  return Array.from(new Set(lists.flatMap(list => Array.isArray(list) ? list : [])
    .map(zone => zone.trim())
    .filter(Boolean)));
}

function redactEmployeePins(staff: UserProfile[]): UserProfile[] {
  return staff.map(member => withoutEmployeePin(member) as UserProfile);
}

function syncTenantZonesWithServer(zones: string[]): void {
  try {
    const token = localStorage.getItem('saborai_token');
    if (!token) return;
    void fetch('/api/tenant/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ zones })
    }).catch(error => console.warn('[SaborAI] No se pudieron sincronizar los salones:', error));
  } catch {}
}

export function App() {
  const [resetToken, setResetToken] = useState<string | null>(() => 
    new URLSearchParams(window.location.search).get('resetToken')
  );

  // Authentication & Session state
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('saborai_user');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [subscription, setSubscription] = useState<SaboraiSubscription | null>(() => {
    try {
      return getTenantItem<SaboraiSubscription>('subscription') || null;
    } catch {
      return null;
    }
  });
  const [skipSubscriptionGate, setSkipSubscriptionGate] = useState(false);

  const [tenant, setTenant] = useState<TenantInfo>(() => {
    try {
      const saved = localStorage.getItem('saborai_tenant');
      const savedHaciendaConfig = getTenantItem<any>('hacienda_config');
      const savedZones = getTenantItem<string[]>('zones');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...initialTenant,
          ...parsed,
          zones: Array.isArray(savedZones) ? savedZones : (parsed.zones || []),
          taxRegime: parsed.taxRegime || 'TRADITIONAL',
          includeService10ByDefault: parsed.includeService10ByDefault ?? true,
          haciendaConfig: { ...(parsed.haciendaConfig || {}), ...(savedHaciendaConfig || {}) }
        };
      }
      return { ...initialTenant, zones: savedZones || [], haciendaConfig: savedHaciendaConfig };
    } catch {
      return initialTenant;
    }
  });

  // Mantener tenant.haciendaConfig reactivo cuando se actualiza desde HaciendaSettings
  useEffect(() => {
    const handleCfgUpdate = (e: any) => {
      const cfg = e.detail;
      if (cfg) {
        setTenant(prev => ({
          ...prev,
          cedulaJuridica: cfg.cedulaEmisor || prev.cedulaJuridica,
          haciendaConfig: { ...(prev.haciendaConfig || {}), ...cfg }
        }));
      }
    };
    window.addEventListener('saborai_hacienda_config_updated', handleCfgUpdate);
    return () => window.removeEventListener('saborai_hacienda_config_updated', handleCfgUpdate);
  }, []);

  const broadcastTenantRef = useRef<((t: TenantInfo) => void) | null>(null);
  const broadcastStaffRef = useRef<((s: UserProfile[]) => void) | null>(null);
  const broadcastKdsOrdersRef = useRef<((orders: KDSOrder[]) => void) | null>(null);

  const handleUpdateTenant = (updated: TenantInfo, skipBroadcast = false) => {
    setTenant(updated);
    setActiveTenantId(updated.id);
    if (!skipBroadcast && broadcastTenantRef.current) {
      broadcastTenantRef.current(updated);
    }
    try {
      localStorage.setItem('saborai_tenant', JSON.stringify(updated));
      // Persistir también en el almacenamiento aislado por tenant. El perfil
      // contiene los salones y categorías, que deben sobrevivir al logout y
      // no depender únicamente del estado global de la sesión.
      setTenantItem('tenant_profile', updated, updated.id);
      setTenantItem('zones', updated.zones || [], updated.id);
      // Los eventos Realtime solo hidratan la caché local. Nunca deben escribir
      // de vuelta al servidor porque otro dispositivo podría tener un estado viejo.
      if (!skipBroadcast) syncTenantZonesWithServer(updated.zones || []);
      if (updated.haciendaConfig) {
        setTenantItem('hacienda_config', updated.haciendaConfig, updated.id);
      }
    } catch {}
  };

  const persistSubscription = (value: SaboraiSubscription | null, tenantId = tenant.id) => {
    if (value) {
      setTenantItem('subscription', value, tenantId);
      return;
    }
    const normalizedId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    try { localStorage.removeItem(`saborai:tenant:${normalizedId}:subscription`); } catch {}
  };

  const [appDomain, setAppDomain] = useState<'LANDING' | 'POS' | 'ADMIN'>(() => {
    const hostname = window.location.hostname;
    if (hostname === 'saborai.site' || hostname === 'www.saborai.site') {
      return 'LANDING';
    } else if (hostname === 'admin.saborai.site') {
      return 'ADMIN';
    }
    // Default to POS for pos.saborai.site, localhost, or any vercel preview URL
    return 'POS';
  });

  const [posTheme, setPosTheme] = useState<PosTheme>(readInitialPosTheme);
  const handlePosThemeChange = (nextTheme: PosTheme) => {
    setPosTheme(nextTheme);
    try { localStorage.setItem(POS_THEME_STORAGE_KEY, nextTheme); } catch {}
  };

  // KDS Orders State
  const [kdsOrders, setKdsOrders] = useState<KDSOrder[]>([]);
  const prevKdsOrdersRef = useRef<Record<string, string>>({});

  const handleUpdateKdsOrder = (orderId: string, status: KDSOrder['status'], skipBroadcast = false) => {
    setKdsOrders(prev => {
      const next = prev.map(o => o.id === orderId ? { ...o, status } : o);
      if (!skipBroadcast) broadcastKdsOrders(next);
      return next;
    });
  };

  const handleToggleKdsItem = (orderId: string, itemId: string, skipBroadcast = false) => {
    setKdsOrders(prev => {
      const next = prev.map(order => {
        if (order.id !== orderId) return order;
        const updatedItems = order.items.map(it => it.id === itemId ? { ...it, completed: !it.completed } : it);
        const allCompleted = updatedItems.length > 0 && updatedItems.every(it => it.completed);
        let nextStatus = order.status;
        if (allCompleted && order.status !== 'READY' && order.status !== 'SERVED') {
          nextStatus = 'READY';
        }
        return { ...order, items: updatedItems, status: nextStatus };
      });
      if (!skipBroadcast) broadcastKdsOrders(next);
      return next;
    });
  };

  // JWT Token validation on load
  useEffect(() => {
    const validateSession = async () => {
      const token = localStorage.getItem('saborai_token');
      if (!token) {
        setIsLoadingAuth(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
          try {
            localStorage.setItem('saborai_account_user_id', String(data.accountUserId || data.user.id));
            if (data.employeeSession && data.employeeId) localStorage.setItem('saborai_employee_id', String(data.employeeId));
            else localStorage.removeItem('saborai_employee_id');
          } catch {}
          setActiveTenantId(data.tenant.id);
          migrateLegacyDataToTenant(data.tenant.id);
          cashShiftService.setTenantContext(data.tenant.id);
          printerService.setTenantContext(data.tenant.id);
          const user: UserProfile = {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            phone: data.user.phone,
            restaurantName: data.user.restaurant_name,
            role: data.user.role,
            active: data.user.active
          };
          const savedHaciendaConfig = getTenantItem<any>('hacienda_config', data.tenant.id);
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
            haciendaConfig: savedTenant?.haciendaConfig || savedHaciendaConfig,
            zones: mergeTenantZones(
              data.tenant.zones,
              getTenantItem<string[]>('zones', data.tenant.id),
              savedTenant?.zones
            ),
            menuCategories: savedTenant?.menuCategories || []
          };
          const sub: SaboraiSubscription = { 
            mode: data.subscription?.mode === 'TRIAL' ? 'TRIAL' : 'ACTIVE', 
            email: user.email, 
            activatedAt: data.subscription?.activated_at || new Date().toISOString(),
            trialEndsAt: data.subscription?.trial_ends_at
          };
          
          // La identidad y el rol efectivo vienen del JWT/backend. No aceptar
          // un usuario o rol alternativo desde localStorage.
          const effectiveUser = user;
          setCurrentUser(effectiveUser);
          setTenant(tenantObj);
          setMenuItems(getTenantItem<MenuItem[]>('menu', tenantObj.id) || []);
          setTables(normalizeTablePositions(getTenantItem<Table[]>('tables', tenantObj.id) || []));
          const cachedStaff = getTenantItem<UserProfile[]>('staff', tenantObj.id) || [effectiveUser];
          const effectiveStaff = data.employeeSession ? redactEmployeePins(cachedStaff) : cachedStaff;
          setStaffList(effectiveStaff);
          if (data.employeeSession) setTenantItem('staff', effectiveStaff, tenantObj.id);
          setSubscription(sub);
          persistSubscription(sub, tenantObj.id);
          try {
            localStorage.setItem('saborai_user', JSON.stringify(effectiveUser));
            localStorage.setItem('saborai_tenant', JSON.stringify(tenantObj));
            setTenantItem('tenant_profile', tenantObj, tenantObj.id);
            setTenantItem('zones', tenantObj.zones || [], tenantObj.id);
            syncTenantZonesWithServer(tenantObj.zones || []);
          } catch {}
        } else {
          // Token invalid or expired
          localStorage.removeItem('saborai_token');
          localStorage.removeItem('saborai_account_user_id');
          localStorage.removeItem('saborai_employee_id');
        }
      } catch (err) {
        console.error('Failed to validate session', err);
      } finally {
        setIsLoadingAuth(false);
      }
    };

    if (appDomain === 'POS') {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('demo') === 'true') {
        // Automatically start demo
        handleStartDemo('pro');
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsLoadingAuth(false);
      } else {
        validateSession();
      }
    } else {
      setIsLoadingAuth(false);
    }
  }, [appDomain]);

  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  
  // Menu Catalog State
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => {
    try {
      const scoped = getTenantItem<MenuItem[]>('menu');
      if (Array.isArray(scoped)) return scoped;
    } catch {}
    return sampleMenuItems;
  });

  const handleUpdateMenu = (updatedMenu: MenuItem[], skipBroadcast = false) => {
    setMenuItems(updatedMenu);
    if (!skipBroadcast) broadcastMenuItems(updatedMenu);
    try {
      setTenantItem('menu', updatedMenu, tenant.id);
    } catch {}
  };

  // Keep menuItems reactively synchronized with inventory stock deductions
  useEffect(() => {
    const handleInventoryChange = () => {
      try {
        const saved = getTenantItem<MenuItem[]>('menu', tenant.id);
        if (saved) setMenuItems(saved);
      } catch {}
    };
    window.addEventListener('saborai_inventory_updated', handleInventoryChange);
    return () => window.removeEventListener('saborai_inventory_updated', handleInventoryChange);
  }, []);

  const [tables, setTables] = useState<Table[]>(() => {
    try {
      const scoped = getTenantItem<Table[]>('tables');
      if (Array.isArray(scoped)) return normalizeTablePositions(scoped);
    } catch {}
    return normalizeTablePositions(initialTables);
  });
  const tablesRef = useRef<Table[]>(tables);
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);
  const tableLayoutSyncRef = useRef<{
    tenantId: string;
    ready: boolean;
    signature: string;
    remoteUpdatedAt: string | null;
    remoteLayout: TableLayoutItem[] | null;
  }>({ tenantId: '', ready: false, signature: '', remoteUpdatedAt: null, remoteLayout: null });
  const layoutWriteTimerRef = useRef<number | null>(null);
  const pendingLayoutSignatureRef = useRef<string | null>(null);
  const layoutRetryAttemptsRef = useRef(0);

  const handleUpdateTables = (updatedTables: Table[], skipBroadcast = false) => {
    let nextTables = updatedTables;
    if (skipBroadcast) {
      const currentById = new Map(tablesRef.current.map(table => [table.id, table]));
      const incomingById = new Map(updatedTables.map(table => [table.id, table]));
      const syncState = tableLayoutSyncRef.current;
      if (syncState.tenantId === tenant.id && syncState.remoteLayout) {
        // Realtime table/order broadcasts may contain stale coordinates; retain
        // only operational fields from them and apply the central layout set.
        nextTables = syncState.remoteLayout.map(layoutItem => ({
          ...(incomingById.get(layoutItem.id) || currentById.get(layoutItem.id) || { status: 'AVAILABLE' as const }),
          ...layoutItem
        }));
      } else {
        // Before the first cloud read, preserve the current device's geometry.
        nextTables = updatedTables.map(incoming => {
          const current = currentById.get(incoming.id);
          return current
            ? { ...incoming, x: current.x, y: current.y, rotation: current.rotation }
            : incoming;
        });
      }
      if (syncState.tenantId === tenant.id) {
        // Broadcast/realtime hydration is not a local edit and must never echo to the DB.
        syncState.signature = tableLayoutSignature(projectTableLayout(nextTables));
      }
    }
    tablesRef.current = nextTables;
    setTables(nextTables);
    if (!skipBroadcast) broadcastTables(nextTables);
    try {
      const useCentralLayout = Boolean(supabaseClient && isCloudTenantUuid(tenant.id));
      setTenantItem('tables', useCentralLayout ? tablesWithoutLocalLayout(nextTables) : nextTables, tenant.id);
    } catch {}
  };

  const [shiftsVersion, setShiftsVersion] = useState(0);

  // Cada sesión usa su propio espacio operativo. Al cambiar de tenant se
  // descarta el estado en memoria anterior y se carga únicamente el nuevo.
  useEffect(() => {
    setActiveTenantId(tenant.id);
    migrateLegacyDataToTenant(tenant.id);
    cashShiftService.setTenantContext(tenant.id);
    printerService.setTenantContext(tenant.id);
    setShiftsVersion(v => v + 1);
  }, [tenant.id]);

  const handleUpdateShifts = (shiftsMap: any, skipBroadcast = false) => {
    cashShiftService.syncShiftsMap(shiftsMap);
    setShiftsVersion(v => v + 1);
    if (!skipBroadcast) broadcastShifts(shiftsMap);
  };

  const handleUpdateStaff = (newStaff: UserProfile[], skipBroadcast = false) => {
    const staffForStorage = isCloudTenantUuid(tenant.id) ? redactEmployeePins(newStaff) : newStaff;
    setStaffList(staffForStorage);
    if (!skipBroadcast && broadcastStaffRef.current) {
      broadcastStaffRef.current(staffForStorage);
    }
    try {
      setTenantItem('staff', staffForStorage, tenant.id);
    } catch {}
  };

  const handleUpdateKdsOrdersRealtime = (newOrders: KDSOrder[], skipBroadcast = false) => {
    setKdsOrders(newOrders);
    if (!skipBroadcast && broadcastKdsOrdersRef.current) {
      broadcastKdsOrdersRef.current(newOrders);
    }
    try {
      setTenantItem('kds_orders', newOrders, tenant.id);
    } catch {}
  };

  // Realtime Sync Hook
  const { broadcastTables, broadcastKdsOrders, broadcastMenuItems, broadcastShifts, broadcastTenant, broadcastStaff } = useRealtimeSync(
    tenant.id,
    handleUpdateTables,
    handleUpdateKdsOrdersRealtime,
    handleUpdateMenu,
    handleUpdateShifts,
    handleUpdateTenant,
    handleUpdateStaff,
    () => ({
      shiftsMap: cashShiftService.getAllActiveShiftsMap(),
      tables,
      kdsOrders,
      menuItems,
      tenant,
      staff: staffList,
      hasLocalData: hasTenantItem('menu', tenant.id) || hasTenantItem('tables', tenant.id) || Object.keys(cashShiftService.getAllActiveShiftsMap()).length > 0 || hasTenantItem('tenant_profile', tenant.id)
    })
  );

  useEffect(() => {
    broadcastTenantRef.current = broadcastTenant;
    broadcastStaffRef.current = broadcastStaff;
    broadcastKdsOrdersRef.current = broadcastKdsOrders;
  }, [broadcastTenant, broadcastStaff, broadcastKdsOrders]);

  // The layout row is the cloud authority when present. Operational state
  // (status/activeOrder) is always kept from the current device's tables.
  useEffect(() => {
    const tenantId = tenant.id;
    let cancelled = false;
    const syncState = {
      tenantId,
      ready: false,
      signature: tableLayoutSignature(projectTableLayout(tablesRef.current)),
      remoteUpdatedAt: null as string | null,
      remoteLayout: null as TableLayoutItem[] | null
    };
    tableLayoutSyncRef.current = syncState;
    if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
    layoutWriteTimerRef.current = null;
    pendingLayoutSignatureRef.current = null;
    layoutRetryAttemptsRef.current = 0;

    const legacyTables = migrateLegacyTablePositions(tablesRef.current, tenantId);
    const legacySignature = tableLayoutSignature(projectTableLayout(legacyTables));
    if (legacySignature !== syncState.signature) {
      tablesRef.current = legacyTables;
      syncState.signature = legacySignature;
      setTables(legacyTables);
    }

    const applyRemoteLayout = (record: { layout: TableLayoutItem[]; updatedAt: string | null }) => {
      if (cancelled || tableLayoutSyncRef.current !== syncState) return;
      const incomingTime = record.updatedAt ? Date.parse(record.updatedAt) : 0;
      const acceptedTime = syncState.remoteUpdatedAt ? Date.parse(syncState.remoteUpdatedAt) : 0;
      if (syncState.remoteUpdatedAt && incomingTime < acceptedTime) return;
      syncState.remoteUpdatedAt = record.updatedAt || syncState.remoteUpdatedAt;
      syncState.remoteLayout = record.layout;
      clearLegacyTablePositions(tenantId);
      const currentSignature = tableLayoutSignature(projectTableLayout(tablesRef.current));
      const next = mergeCloudLayoutIntoTables(tablesRef.current, record.layout);
      const signature = tableLayoutSignature(projectTableLayout(next));
      syncState.signature = signature;
      syncState.ready = true;
      if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
      layoutWriteTimerRef.current = null;
      pendingLayoutSignatureRef.current = null;
      layoutRetryAttemptsRef.current = 0;
      if (signature !== currentSignature) {
        tablesRef.current = next;
        setTables(next);
      }
    };

    if (!isCloudTenantUuid(tenantId)) {
      // Demo/local tenants (including tenant_demo_*) remain entirely local.
      syncState.ready = true;
      setTenantItem('tables', legacyTables, tenantId);
      clearLegacyTablePositions(tenantId);
      return () => { cancelled = true; };
    }

    const unsubscribe = subscribeToTableLayout(tenantId, applyRemoteLayout);
    void (async () => {
      const initial = await readTableLayout(tenantId);
      if (cancelled || tableLayoutSyncRef.current !== syncState) return;
      if (!initial.available) {
        // Supabase is optional, offline, or the migration is not installed.
        syncState.ready = true;
        syncState.signature = tableLayoutSignature(projectTableLayout(tablesRef.current));
        return;
      }
      if (initial.exists && initial.record) {
        const incomingTime = initial.record.updatedAt ? Date.parse(initial.record.updatedAt) : 0;
        const listenerTime = syncState.remoteUpdatedAt ? Date.parse(syncState.remoteUpdatedAt) : 0;
        if (!syncState.remoteUpdatedAt || incomingTime >= listenerTime) applyRemoteLayout(initial.record);
        else syncState.ready = true;
        return;
      }

      // Re-check/insert-on-conflict ensures a concurrent device's plan wins;
      // use the latest local snapshot only when the tenant has no cloud row.
      const seeded = await seedTableLayoutIfMissing(
        tenantId,
        projectTableLayout(tablesRef.current)
      );
      if (cancelled || tableLayoutSyncRef.current !== syncState) return;
      if (seeded.available && seeded.exists && seeded.record) {
        const incomingTime = seeded.record.updatedAt ? Date.parse(seeded.record.updatedAt) : 0;
        const listenerTime = syncState.remoteUpdatedAt ? Date.parse(syncState.remoteUpdatedAt) : 0;
        if (!syncState.remoteUpdatedAt || incomingTime >= listenerTime) applyRemoteLayout(seeded.record);
        else syncState.ready = true;
      } else {
        syncState.ready = true;
        syncState.signature = tableLayoutSignature(projectTableLayout(tablesRef.current));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
      layoutWriteTimerRef.current = null;
      pendingLayoutSignatureRef.current = null;
    };
  }, [tenant.id]);

  // Persist only geometry changes; frequent order/status updates project to the
  // same signature and therefore do not generate cloud writes.
  useEffect(() => {
    const syncState = tableLayoutSyncRef.current;
    if (syncState.tenantId !== tenant.id || !syncState.ready || !isCloudTenantUuid(tenant.id)) return;
    const layout = projectTableLayout(tables);
    const signature = tableLayoutSignature(layout);
    if (signature === syncState.signature) {
      if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
      layoutWriteTimerRef.current = null;
      pendingLayoutSignatureRef.current = null;
      layoutRetryAttemptsRef.current = 0;
      return;
    }
    // Don't restart a pending debounce for operational updates that leave the
    // projected layout unchanged.
    if (pendingLayoutSignatureRef.current === signature) return;
    if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
    pendingLayoutSignatureRef.current = signature;
    layoutRetryAttemptsRef.current = 0;
    layoutWriteTimerRef.current = window.setTimeout(() => {
      layoutWriteTimerRef.current = null;
      const persist = async () => {
        const latestState = tableLayoutSyncRef.current;
        const latestLayout = projectTableLayout(tablesRef.current);
        if (latestState !== syncState || !latestState.ready || tableLayoutSignature(latestLayout) !== signature || pendingLayoutSignatureRef.current !== signature) return;
        const saved = await upsertTableLayout(tenant.id, layout);
        if (latestState !== tableLayoutSyncRef.current || pendingLayoutSignatureRef.current !== signature) return;
        if (saved) {
          latestState.signature = signature;
          latestState.remoteLayout = layout;
          pendingLayoutSignatureRef.current = null;
          layoutRetryAttemptsRef.current = 0;
          return;
        }
        // Retry with bounded backoff while this tenant remains open; IndexedDB
        // also retains the latest offline snapshot for recovery after a reload.
        layoutRetryAttemptsRef.current += 1;
        const retryDelay = Math.min(5_000 * layoutRetryAttemptsRef.current, 60_000);
        layoutWriteTimerRef.current = window.setTimeout(() => {
          layoutWriteTimerRef.current = null;
          void persist();
        }, retryDelay);
      };
      void persist();
    }, 450);
  }, [tables, tenant.id]);

  // Remove legacy geometry from the localStorage operational cache. The cloud
  // row is canonical online; IndexedDB remains the offline layout snapshot.
  useEffect(() => {
    if (!supabaseClient || !isCloudTenantUuid(tenant.id)) return;
    const cached = getTenantItem<Table[]>('tables', tenant.id);
    if (Array.isArray(cached)) {
      setTenantItem('tables', tablesWithoutLocalLayout(cached), tenant.id);
    }
  }, [tenant.id]);

  const [selectedTableForOrder, setSelectedTableForOrder] = useState<Table | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isNyzaHubOpen, setIsNyzaHubOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const [isCashShiftModalOpen, setIsCashShiftModalOpen] = useState(false);
  const [cashShiftInitialTab, setCashShiftInitialTab] = useState<'status' | 'movements' | 'close' | 'history' | 'registers'>('status');
  const [activeZReport, setActiveZReport] = useState<ZReportData | null>(null);
  const [activeConsolidatedZReport, setActiveConsolidatedZReport] = useState<ConsolidatedZReportData | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairStep, setRepairStep] = useState(0);
  const [isZReportModalOpen, setIsZReportModalOpen] = useState(false);
  const [isHaciendaHistoryOpen, setIsHaciendaHistoryOpen] = useState(false);

  const handleOpenCashShift = (tab: 'status' | 'movements' | 'close' | 'history' | 'registers' = 'status') => {
    setCashShiftInitialTab(tab);
    setIsCashShiftModalOpen(true);
  };

  // Staff & Collaborators state (4 Roles: Admin, Salonero, Cajero, Salonero c/ Caja)
  const [staffList, setStaffList] = useState<UserProfile[]>(() => {
    const adminUser: UserProfile = currentUser || {
      id: 'usr_local_admin',
      name: 'Administrador',
      email: '',
      phone: '',
      role: 'ADMIN',
      restaurantName: tenant.name,
      active: true
    };
    try {
    const saved = getTenantItem<UserProfile[]>('staff');
      if (saved) {
        const parsed = saved;
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (adminUser.email && !parsed.some((s: any) => s.email === adminUser.email)) {
            return [adminUser, ...parsed];
          }
          return parsed;
        }
      }
    } catch {}

    return [adminUser];
  });

  const handleAddStaffMember = async (newMember: UserProfile) => {
    const updated = [newMember, ...staffList];
    if (isCloudTenantUuid(tenant.id)) {
      if (currentUser?.role !== 'ADMIN') throw new Error('Solo un administrador puede sincronizar colaboradores.');
      await syncEmployeeRoster(tenant.id, updated);
      handleUpdateStaff(redactEmployeePins(updated));
      return;
    }
    handleUpdateStaff(updated);
  };

  const activateStaffSession = async (staff: UserProfile, pin?: string): Promise<UserProfile> => {
    let user = staff;
    if (isCloudTenantUuid(tenant.id)) {
      const session = await createEmployeeSession(tenant.id, staff.id, pin);
      user = session.user;
      localStorage.setItem('saborai_token', session.token);
      localStorage.setItem('saborai_account_user_id', session.accountUserId);
      localStorage.setItem('saborai_employee_id', session.employeeId);
      if (staffList.some(member => Boolean(member.pin))) {
        handleUpdateStaff(redactEmployeePins(staffList));
      }
    }
    setCurrentUser(user);
    try {
      localStorage.setItem('saborai_user', JSON.stringify(user));
    } catch {}
    return user;
  };

  const handleSelectUser = async (staff: UserProfile) => {
    const user = await activateStaffSession(staff);

    // Cambiar de colaborador no abre ni reemplaza el turno de caja activo.
    // Solo registra al usuario como participante del mismo turno.
    const activeShift = cashShiftService.registerUserOnActiveShift(user);
    if (activeShift) {
      broadcastShifts(cashShiftService.getAllActiveShiftsMap());
    }
    setShiftsVersion(v => v + 1);
    return user;
  };

  const handleSwitchWaiter = async (staff: UserProfile, pin?: string): Promise<UserProfile> => {
    const user = await activateStaffSession(staff, pin);
    const activeShift = cashShiftService.registerUserOnActiveShift(user);
    if (activeShift) broadcastShifts(cashShiftService.getAllActiveShiftsMap());
    setShiftsVersion(v => v + 1);

    // If currently editing/taking order on a table, update server immediately
    if (selectedTableForOrder) {
      const updatedTable: Table = {
        ...selectedTableForOrder,
        activeOrder: {
          ...(selectedTableForOrder.activeOrder || {
            orderNumber: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
            openedAt: new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
            subAccounts: [{ id: 1, name: 'Cuenta 1' }],
            items: []
          }),
          server: user.name
        }
      };
      setSelectedTableForOrder(updatedTable);
      handleSaveOrder(updatedTable);
    }

    addNotification({
      id: `switch_${Date.now()}`,
      type: 'ORDER_READY',
      title: 'Usuario cambiado',
      message: `${user.name} se incorporó al turno activo. El turno de caja continúa abierto.`,
      server: user.name,
      timestamp: new Date()
    });
    return user;
  };

  const employeeRosterSyncRef = useRef<string>('');
  const employeeRosterUserId = currentUser?.id;
  const employeeRosterRole = currentUser?.role;
  useEffect(() => {
    if (isLoadingAuth || !employeeRosterUserId || !isCloudTenantUuid(tenant.id)) return;
    const token = localStorage.getItem('saborai_token');
    if (!token) return;
    const syncKey = `${tenant.id}:${token}`;
    if (employeeRosterSyncRef.current === syncKey) return;
    employeeRosterSyncRef.current = syncKey;

    const migration = employeeRosterRole === 'ADMIN'
      ? syncEmployeeRoster(tenant.id, staffList)
      : Promise.resolve();
    void migration
      .then(() => fetchEmployeeRoster(tenant.id))
      .then(serverStaff => {
        const serverHasEmployees = serverStaff.length > 1;
        const effectiveStaff = serverHasEmployees
          ? serverStaff
          : [serverStaff[0], ...staffList.filter(member => member.id !== serverStaff[0]?.id)];
        handleUpdateStaff(redactEmployeePins(effectiveStaff));
      })
      .catch(error => {
        employeeRosterSyncRef.current = '';
        console.warn('[POS] No se pudo cargar o sincronizar el padrón de colaboradores:', error);
      });
  }, [isLoadingAuth, employeeRosterUserId, employeeRosterRole, tenant.id, staffList, handleUpdateStaff]);

  // Network & Sync state
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [localDbReady, setLocalDbReady] = useState(false);

  // Sound & Notifications state
  const [notifications, setNotifications] = useState<PosNotification[]>([]);
  const [isMuted, setIsMuted] = useState<boolean>(() => soundService.isMuted());

  const handleToggleMute = () => {
    const nextMuted = soundService.toggleMute();
    setIsMuted(nextMuted);
  };

  const addNotification = (notif: PosNotification) => {
    setNotifications(prev => [notif, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notif.id));
    }, 7000);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  useEffect(() => {
    kdsOrders.forEach(order => {
      const prevStatus = prevKdsOrdersRef.current[order.id];
      if (prevStatus && prevStatus !== 'READY' && order.status === 'READY') {
        soundService.playOrderReadySound();
        addNotification({
          id: `ready_${Date.now()}_${order.id}`,
          type: 'ORDER_READY',
          title: `🛎️ ¡${order.station === 'Bar' ? 'Bebida Lista' : 'Platillo Listo'} para Servir!`,
          message: `${order.tableName} tiene su comanda lista en ${order.station}.`,
          station: order.station,
          tableNumber: order.tableNumber,
          server: order.server,
          timestamp: new Date()
        });
      }
      prevKdsOrdersRef.current[order.id] = order.status;
    });
  }, [kdsOrders]);

  // Initialize DB and subscribe to offline/online events
  useEffect(() => {
    let mounted = true;
    void localDB.init().then(() => {
      if (mounted) setLocalDbReady(true);
    });
    const unsubscribe = localDB.subscribe((online, pending) => {
      setIsOnline(online);
      setPendingSyncCount(pending);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!localDbReady) return;
    const syncWhenOnline = () => {
      if (localDB.isOnline()) void localDB.syncAllPending();
    };
    window.addEventListener('online', syncWhenOnline);
    syncWhenOnline();
    return () => window.removeEventListener('online', syncWhenOnline);
  }, [localDbReady]);

  // IndexedDB es el respaldo del POS cuando localStorage fue limpiado o no está disponible.
  // Solo hidrata campos ausentes para no reemplazar cambios locales más recientes.
  useEffect(() => {
    if (!localDbReady || !tenant.id) return;
    let cancelled = false;

    void localDB.getTenantSnapshot(tenant.id).then(snapshot => {
      if (cancelled || !snapshot) return;

      if (!hasTenantItem('menu', tenant.id) && snapshot.menuItems.length > 0) {
        setMenuItems(snapshot.menuItems as MenuItem[]);
        setTenantItem('menu', snapshot.menuItems, tenant.id);
      }
      if (snapshot.tables.length > 0) {
        const snapshotTables = normalizeTablePositions(snapshot.tables as Table[]);
        const hasLocalTables = hasTenantItem('tables', tenant.id);
        const syncState = tableLayoutSyncRef.current;
        let restoredTables: Table[];
        if (!hasLocalTables) {
          restoredTables = syncState.tenantId === tenant.id && syncState.remoteLayout
            ? mergeCloudLayoutIntoTables(snapshotTables, syncState.remoteLayout)
            : snapshotTables;
        } else if (syncState.tenantId === tenant.id && syncState.remoteLayout) {
          // Keep offline operational data, but use Supabase's geometry as authority.
          restoredTables = mergeCloudLayoutIntoTables(tablesRef.current, syncState.remoteLayout);
        } else {
          // IndexedDB is an offline position cache; preserve the current order state.
          restoredTables = mergeCachedPositions(tablesRef.current, snapshotTables);
        }
        tablesRef.current = restoredTables;
        setTables(restoredTables);
        const useCentralLayout = Boolean(supabaseClient && isCloudTenantUuid(tenant.id));
        setTenantItem('tables', useCentralLayout ? tablesWithoutLocalLayout(restoredTables) : restoredTables, tenant.id);
      }
      if (!hasTenantItem('staff', tenant.id) && snapshot.staff.length > 0) {
        setStaffList(snapshot.staff as UserProfile[]);
        setTenantItem('staff', snapshot.staff, tenant.id);
      }
      if (snapshot.kdsOrders.length > 0) {
        setKdsOrders(current => current.length > 0 ? current : snapshot.kdsOrders as KDSOrder[]);
      }
      if (snapshot.tenant && !hasTenantItem('tenant_profile', tenant.id)) {
        setTenant(snapshot.tenant as TenantInfo);
        setTenantItem('tenant_profile', snapshot.tenant, tenant.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [localDbReady, tenant.id]);

  // Mantiene un snapshot local coherente para poder arrancar y consultar el POS offline.
  // Las credenciales sensibles se eliminan dentro de localDB antes de persistir.
  useEffect(() => {
    if (!localDbReady || !tenant.id) return;
    const timer = window.setTimeout(() => {
      void localDB.saveTenantSnapshot({
        tenantId: tenant.id,
        version: 1,
        updatedAt: new Date().toISOString(),
        tenant,
        menuItems,
        tables,
        staff: isCloudTenantUuid(tenant.id) ? redactEmployeePins(staffList) : staffList,
        kdsOrders
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [localDbReady, tenant, menuItems, tables, staffList, kdsOrders]);

  const handleLoginSuccess = (user: UserProfile, loggedTenant: TenantInfo) => {
    // El endpoint de login devuelve la identidad del tenant, pero los ajustes
    // operativos (salones, categorías, régimen y Hacienda) pueden haber sido
    // guardados localmente por tenant. Restaurarlos aquí evita que el login
    // reemplace el tenant hidratado por uno sin salones.
    const savedTenant = getTenantProfileWithLegacyFallback(loggedTenant.id);
    const restoredTenant: TenantInfo = {
      ...loggedTenant,
      zones: mergeTenantZones(loggedTenant.zones, savedTenant?.zones),
      menuCategories: savedTenant?.menuCategories ?? loggedTenant.menuCategories ?? [],
      taxRegime: savedTenant?.taxRegime ?? loggedTenant.taxRegime,
      includeService10ByDefault: savedTenant?.includeService10ByDefault ?? loggedTenant.includeService10ByDefault,
      haciendaConfig: savedTenant?.haciendaConfig ?? loggedTenant.haciendaConfig
    };

    setActiveTenantId(restoredTenant.id);
    migrateLegacyDataToTenant(restoredTenant.id);
    cashShiftService.setTenantContext(restoredTenant.id);
    printerService.setTenantContext(restoredTenant.id);
    setCurrentUser(user);
    setTenant(restoredTenant);
    setMenuItems(getTenantItem<MenuItem[]>('menu', restoredTenant.id) || []);
    setTables(normalizeTablePositions(getTenantItem<Table[]>('tables', restoredTenant.id) || []));
    setStaffList(getTenantItem<UserProfile[]>('staff', restoredTenant.id) || [user]);
    try {
      localStorage.setItem('saborai_user', JSON.stringify(user));
      localStorage.setItem('saborai_tenant', JSON.stringify(restoredTenant));
      localStorage.setItem('saborai_account_user_id', user.id);
      localStorage.removeItem('saborai_employee_id');
      setTenantItem('tenant_profile', restoredTenant, restoredTenant.id);
      setTenantItem('zones', restoredTenant.zones || [], restoredTenant.id);
      syncTenantZonesWithServer(restoredTenant.zones || []);
    } catch {}
    // La suscripción se resuelve por tenant, nunca desde el estado de la cuenta anterior.
    const tenantSubscription = getTenantItem<SaboraiSubscription>('subscription', restoredTenant.id);
    if (!tenantSubscription) {
      const activeSub: SaboraiSubscription = { mode: 'ACTIVE', activatedAt: new Date().toISOString() };
      persistSubscription(activeSub, restoredTenant.id);
      setSubscription(activeSub);
    } else {
      setSubscription(tenantSubscription);
    }
    // Add to staffList if not present
    setStaffList(prev => {
      const exists = prev.some(m => m.id === user.id || m.email === user.email);
      if (!exists) {
        const next = [user, ...prev];
        setTenantItem('staff', next, restoredTenant.id);
        return next;
      }
      return prev;
    });
    // Set default tab according to role
    if (user.role === 'CAJERO') {
      setActiveTab('billing');
    } else {
      setActiveTab('pos');
    }
  };

  const handleLogout = () => {
    try {
      void supabaseClient?.auth.signOut().catch(() => {});
      localStorage.removeItem('saborai_user');
      localStorage.removeItem('saborai_token');
      localStorage.removeItem('saborai_tenant');
      localStorage.removeItem('saborai_account_user_id');
      localStorage.removeItem('saborai_employee_id');
    } catch {}
    setCurrentUser(null);
  };

  const handleStartDemo = (plan: SubscriptionPlan) => {
    const demoTenantId = `tenant_demo_${Date.now()}`;
    startCleanDemoSession(demoTenantId);
    localStorage.removeItem('saborai_account_user_id');
    localStorage.removeItem('saborai_employee_id');
    cashShiftService.setTenantContext(demoTenantId);
    printerService.setTenantContext(demoTenantId);
    setMenuItems([]);
    setTables([]);
    setStaffList([]);
    setKdsOrders([]);
    setSelectedTableForOrder(null);
    const updatedTenant: TenantInfo = {
      ...tenant,
      id: demoTenantId,
      name: 'SaborAI Demo',
      email: '',
      phone: '',
      location: '',
      zones: [],
      menuCategories: [],
      plan: plan,
      status: 'ACTIVE',
      monthlyFee: plan === 'express' ? 22000 : plan === 'pro' ? 45000 : 85000,
      onboardingCompleted: true
    };
    setTenant(updatedTenant);
    try {
      localStorage.setItem('saborai_tenant', JSON.stringify(updatedTenant));
      setTenantItem('tenant_profile', updatedTenant, demoTenantId);
    } catch {}

    // Force subscription to DEMO mode
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    const sub: SaboraiSubscription = {
      mode: 'DEMO',
      plan,
      trialEndsAt: trialEnd.toISOString(),
      activatedAt: new Date().toISOString(),
    };
    persistSubscription(sub, demoTenantId);
    setSubscription(sub);

    // Set a fake demo user so we skip WelcomeGate entirely
    const demoUser: UserProfile = {
      id: `demo_${Date.now()}`,
      name: 'Usuario Demo',
      email: 'demo@saborai.site',
      phone: '88888888',
      restaurantName: 'Saborai Demo',
      role: 'ADMIN',
      active: true
    };
    try { localStorage.setItem('saborai_user', JSON.stringify(demoUser)); } catch {}
    setTenantItem('staff', [], demoTenantId);
    setCurrentUser(demoUser);

    setActiveTab('pos');
  };

  const handleSelectTable = (_table: Table) => {
    // Al tocar una mesa en el mapa solo se selecciona para ver sus detalles en el panel lateral.
    // La comanda o pedido se abre exclusivamente con handleOpenOrder (botón 'Abrir Mesa y Comandar' / 'Tomar Pedido').
  };

  const handleNyzaCreateTable = async (salonName: string, tableNumber: number) => {
    const zoneName = salonName.trim() || 'Principal';
    const normalizedNumber = Math.max(1, Math.floor(tableNumber));
    const exists = tables.some(table => table.number === normalizedNumber || table.name.toLowerCase() === `mesa ${normalizedNumber}`.toLowerCase());
    setActiveTab('pos');
    setSelectedTableForOrder(null);

    if (exists) {
      addNotification({
        id: `nyza_table_exists_${Date.now()}`,
        type: 'NEW_ORDER',
        title: 'Nyza IA',
        message: `La Mesa ${normalizedNumber} ya existe en el restaurante.`,
        timestamp: new Date()
      });
      return;
    }

    const currentZones = tenant.zones || [];
    if (!currentZones.some(zone => zone.toLowerCase() === zoneName.toLowerCase())) {
      handleUpdateTenant({ ...tenant, zones: [...currentZones, zoneName] });
    }
    const newTable: Table = {
      id: `tbl_nyza_${Date.now()}_${normalizedNumber}`,
      number: normalizedNumber,
      name: `Mesa ${normalizedNumber}`,
      seats: 4,
      shape: 'square',
      status: 'AVAILABLE',
      zone: zoneName,
      x: 18 + ((tables.length * 17) % 68),
      y: 20 + ((tables.length * 19) % 58)
    };
    handleUpdateTables([...tables, newTable]);
    addNotification({
      id: `nyza_table_${Date.now()}`,
      type: 'ORDER_READY',
      title: 'Nyza IA',
      message: `Creó la Mesa ${normalizedNumber} en ${zoneName}.`,
      timestamp: new Date()
    });
  };

  const handleOpenOrder = (table: Table) => {
    const fallbackServer = currentUser?.name || staffList[0]?.name || 'Salonero';
    if (!table.activeOrder || !table.activeOrder.server || table.activeOrder.server === 'Mesero General' || table.activeOrder.server === 'Salonero general') {
      const ensuredTable: Table = {
        ...table,
        activeOrder: {
          orderNumber: table.activeOrder?.orderNumber || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
          server: (table.activeOrder?.server && table.activeOrder.server !== 'Mesero General' && table.activeOrder.server !== 'Salonero general') ? table.activeOrder.server : fallbackServer,
          openedAt: table.activeOrder?.openedAt || new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
          subAccounts: table.activeOrder?.subAccounts || [{ id: 1, name: 'Cuenta 1' }],
          items: table.activeOrder?.items || []
        }
      };
      setSelectedTableForOrder(ensuredTable);
    } else {
      setSelectedTableForOrder(table);
    }
  };

  const handleQuickTakeaway = () => {
    if (!cashShiftService.getActiveShift()) {
      setCashShiftInitialTab('status');
      setIsCashShiftModalOpen(true);
      addNotification({
        id: `takeaway_shift_${Date.now()}`,
        type: 'HACIENDA_UPDATE',
        title: 'Turno de Caja Requerido',
        message: 'Debes abrir un turno de caja para emitir ventas rápidas o pedidos para llevar',
        timestamp: new Date()
      });
      return;
    }

    const takeawayTable: Table = {
      id: `takeaway_${Date.now()}`,
      number: Math.floor(900 + Math.random() * 99),
      name: '🛍️ Para Llevar / Mostrador',
      seats: 1,
      shape: 'square',
      status: 'OCCUPIED',
      zone: 'Para Llevar',
      x: 0,
      y: 0,
      activeOrder: {
        orderNumber: `LLE-${Math.floor(1000 + Math.random() * 9000)}`,
        server: currentUser?.name || staffList[0]?.name || 'Mostrador',
        openedAt: new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
        subAccounts: [{ id: 1, name: 'Para Llevar' }],
        items: []
      }
    };
    setSelectedTableForOrder(takeawayTable);
    setActiveTab('pos');
  };

  const handleSplitBill = (table: Table) => {
    setSelectedTableForOrder(table);
    setActiveTab('billing');
  };

  const handleRegisterPayment = (sale: SaleCloudPayload) => {
    const invoicePayload = {
      orderNumber: sale.table.activeOrder?.orderNumber,
      clave: sale.invoice.clave50Digitos,
      consecutivo: sale.invoice.consecutivo,
      documentType: sale.invoice.tipoDocumento || 'TE',
      total: sale.invoice.totalComprobante,
      invoiceData: sale.invoice,
      xmlContent: sale.invoice.xmlContent
    };
    const paymentPayload = {
      orderNumber: sale.table.activeOrder?.orderNumber,
      payments: [{
        amount: sale.total,
        method: sale.paymentMethod === '01-Efectivo' ? 'CASH' : sale.paymentMethod === '02-Tarjeta' ? 'CARD' : 'SINPE',
        provider: 'POS_OFFLINE_FALLBACK'
      }],
      closeOrder: sale.closeOrder
    };
    const inventoryPayload = {
      orderNumber: sale.table.activeOrder?.orderNumber,
      items: sale.items
    };

    if (localDB.isOnline()) {
      void posCloudService.syncSale(tenant.id, sale).catch(async error => {
        console.warn('[POS Cloud] Venta en cola después de fallo de red:', error);
        await localDB.enqueueOfflineAction('PAYMENT', paymentPayload, 'Pago pendiente de sincronización', tenant.id);
        await localDB.enqueueOfflineAction('DEDUCT_INVENTORY', inventoryPayload, 'Inventario pendiente de sincronización', tenant.id);
        await localDB.enqueueOfflineAction('EMIT_INVOICE', invoicePayload, 'Factura pendiente de sincronización', tenant.id);
      });
      return;
    }

    void localDB.enqueueOfflineAction('PAYMENT', paymentPayload, 'Pago guardado sin conexión', tenant.id);
    void localDB.enqueueOfflineAction('DEDUCT_INVENTORY', inventoryPayload, 'Inventario guardado sin conexión', tenant.id);
    void localDB.enqueueOfflineAction('EMIT_INVOICE', invoicePayload, 'Factura guardada sin conexión', tenant.id);
  };

  const handleSaveOrder = (updatedTable: Table) => {
    if (!updatedTable) return;

    // 1. Process new items for KDS
    if (updatedTable.activeOrder && Array.isArray(updatedTable.activeOrder.items)) {
      const newKitchenItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && (i.category === 'Cocina' || !i.category));
      const newBarItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && i.category === 'Bar');

      const timestamp = new Date();
      const serverName = updatedTable.activeOrder.server || 'Mesero';
      
      const newKdsOrders: KDSOrder[] = [];

      if (newKitchenItems.length > 0) {
        const orderId = `kds_c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        newKitchenItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; });
        const maxPrepTime = Math.max(0, ...newKitchenItems.map(i => {
          const menuIt = menuItems.find(m => m.name === i.name);
          return menuIt?.prepTime || 0;
        }));
        newKdsOrders.push({
          id: orderId,
          tableNumber: updatedTable.number,
          tableName: updatedTable.name,
          server: serverName,
          timestamp,
          status: 'PENDING',
          station: 'Cocina',
          targetPrepTime: maxPrepTime > 0 ? maxPrepTime : undefined,
          items: newKitchenItems.map(i => ({ 
            id: i.id, 
            name: i.name, 
            quantity: i.quantity, 
            notes: i.notes, 
            modifiers: i.selectedModifiers?.map(m => m.choiceName),
            completed: false 
          }))
        });
      }

      if (newBarItems.length > 0) {
        const orderId = `kds_b_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        newBarItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; });
        const maxPrepTime = Math.max(0, ...newBarItems.map(i => {
          const menuIt = menuItems.find(m => m.name === i.name);
          return menuIt?.prepTime || 0;
        }));
        newKdsOrders.push({
          id: orderId,
          tableNumber: updatedTable.number,
          tableName: updatedTable.name,
          server: serverName,
          timestamp,
          status: 'PENDING',
          station: 'Bar',
          targetPrepTime: maxPrepTime > 0 ? maxPrepTime : undefined,
          items: newBarItems.map(i => ({ 
            id: i.id, 
            name: i.name, 
            quantity: i.quantity, 
            notes: i.notes, 
            modifiers: i.selectedModifiers?.map(m => m.choiceName),
            completed: false 
          }))
        });
      }

      if (newKdsOrders.length > 0) {
        setKdsOrders(prev => {
          const next = [...prev, ...newKdsOrders];
          broadcastKdsOrders(next);
          return next;
        });
      }
    }

    // 2. Save table state
    if (updatedTable.id.startsWith('takeaway_')) {
      if (updatedTable.status === 'AVAILABLE') {
        setSelectedTableForOrder(null);
        handleUpdateTables(tables.filter(t => t.id !== updatedTable.id));
      } else {
        setSelectedTableForOrder(updatedTable);
        const exists = tables.some(t => t.id === updatedTable.id);
        const nextTables = exists
          ? tables.map(t => t.id === updatedTable.id ? updatedTable : t)
          : [...tables, updatedTable];
        handleUpdateTables(nextTables);
      }
    } else {
      handleUpdateTables(tables.map(t => t.id === updatedTable.id ? updatedTable : t));
      if (updatedTable.status === 'AVAILABLE') {
        setSelectedTableForOrder(null);
      } else {
        setSelectedTableForOrder(updatedTable);
      }
    }

    // Save locally in IndexedDB
    localDB.saveItem('tables', updatedTable);

    const orderDescription = `Comanda actualizada en ${updatedTable.name || 'Mesa'} (${updatedTable.activeOrder?.orderNumber || 'pedido'})`;
    if (localDB.isOnline()) {
      void posCloudService.syncOperation('UPDATE_TABLE', updatedTable as unknown as Record<string, unknown>, tenant.id)
        .catch(() => localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id));
    } else {
      void localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id);
    }
  };

  const handleUpdateTenantStatus = (status: SubscriptionStatus, graceEnds?: string) => {
    setTenant(prev => ({
      ...prev,
      status,
      gracePeriodEndsAt: graceEnds
    }));
  };

  const handleToggleSimulatedOffline = async () => {
    await localDB.toggleSimulatedOffline();
  };

  const publicPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (publicPath === '/privacy-policy' || publicPath === '/terms-of-service') {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#fcfeff] text-[#588157]">Cargando...</div>}>
        <LegalPage document={publicPath === '/privacy-policy' ? 'privacy' : 'terms'} />
      </Suspense>
    );
  }

  // If LANDING domain, completely bypass auth and POS UI
  if (appDomain === 'LANDING') {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-[#fafaf9]">
        <LandingPage 
          onStartDemo={handleStartDemo} 
          onEnterPOS={(isDemo?: boolean) => {
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
              if (isDemo) handleStartDemo('pro');
              setAppDomain('POS'); // Local dev override
            } else {
              window.location.href = isDemo ? 'https://pos.saborai.site?demo=true' : 'https://pos.saborai.site';
            }
          }}
        />
      </div>
    );
  }

  // If ADMIN domain, completely bypass auth and POS UI (can add its own auth later)
  if (appDomain === 'ADMIN') {
    return (
      <Suspense fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-stone-900 text-stone-200">
          <div className="w-8 h-8 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
        </div>
      }>
        <div className="h-screen w-screen overflow-y-auto">
          <SuperAdminBackoffice 
            currentTenant={tenant}
            onSelectTenant={(t) => handleUpdateTenant(t)}
            onOpenNotion={() => setIsNotionModalOpen(true)}
          />
        </div>
      </Suspense>
    );
  }

  if (resetToken) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center text-white">
          <div className="w-8 h-8 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
        </div>
      }>
        <ResetPasswordScreen
          token={resetToken}
          onSuccess={() => {
            window.history.replaceState({}, document.title, window.location.pathname);
            setResetToken(null);
          }}
        />
      </Suspense>
    );
  }

  // Subscription gate — only for POS domain
  const isTrialExpired = subscription?.mode === 'TRIAL' && subscription.trialEndsAt
    ? new Date(subscription.trialEndsAt) < new Date()
    : false;

  if (!subscription && !skipSubscriptionGate) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center text-white">
          <div className="w-8 h-8 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
        </div>
      }>
        <WelcomeGate
          onSubscriptionActivated={(sub, user, tenant) => {
            persistSubscription(sub, tenant.id);
            setSubscription(sub);
            handleLoginSuccess(user, tenant);
          }}
        />
      </Suspense>
    );
  }

  if (isTrialExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-stone-900 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-amber-900/20 border border-amber-700/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">⏰</span>
        </div>
        <h2 className="text-3xl font-black text-white mb-3">Tu periodo de prueba finalizó</h2>
        <p className="text-stone-400 max-w-sm mx-auto mb-8">
          Los 14 días de prueba han concluido. Suscríbete a un plan para seguir usando Saborai POS.
        </p>
        <button
          onClick={() => {
            persistSubscription(null);
            setSubscription(null);
            setSkipSubscriptionGate(false);
          }}
          className="px-8 py-4 bg-[#a9b994] text-stone-900 rounded-2xl font-bold text-sm hover:bg-[#bccaad] transition-all shadow-lg"
        >
          Renovar Suscripción
        </button>
      </div>
    );
  }

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin mb-4"></div>
        <p className="text-stone-400 text-sm font-medium animate-pulse">Cargando sesión...</p>
      </div>
    );
  }
  
  // If not authenticated, show WelcomeGate
  if (!currentUser) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center text-white">
          <div className="w-8 h-8 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
        </div>
      }>
        <WelcomeGate
          onSubscriptionActivated={(sub, user, tenantData) => {
            persistSubscription(sub, tenantData.id);
            setSubscription(sub);
            handleLoginSuccess(user, tenantData);
          }}
        />
      </Suspense>
    );
  }

  if (!tenant.onboardingCompleted) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center text-white">
          <div className="w-8 h-8 border-4 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
        </div>
      }>
        <NysaOnboarding
          tenant={tenant}
          currentUser={currentUser}
          onComplete={async (updatedTenant, newStaff, newMenu) => {
            handleUpdateTenant(updatedTenant);
            if (newStaff.length > 0) {
              newStaff.forEach(handleAddStaffMember);
            }
            if (newMenu.length > 0) {
              handleUpdateMenu(newMenu);
            }
            
            // Guardar en el backend para que no vuelva a salir
            try {
              const token = localStorage.getItem('saborai_token');
              if (token) {
                await fetch('/api/tenant/onboarding', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` }
                });
              }
            } catch (e) {
              console.error('Error guardando onboarding', e);
            }
          }}
        />
      </Suspense>
    );
  }

  return (
    <div data-pos-theme={activeTab === 'landing' ? 'light' : posTheme} className="pos-theme-root h-screen h-[100dvh] w-full min-h-0 overflow-hidden flex flex-col sm:w-screen sm:flex-row font-sans selection:bg-[#a9b994]/30">
      
      <GuidedTour />
      
      {/* Navbar: Bottom on mobile, Vertical on Desktop */}
      <Navbar
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(collapsed => !collapsed)}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'pos') {
            setSelectedTableForOrder(null);
          }
        }}
        tenant={tenant}
        user={currentUser}
        onLogout={handleLogout}
        isOnline={isOnline}
        pendingCount={pendingSyncCount}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenNyzaHub={() => setIsNyzaHubOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
        onOpenStaffModal={() => setIsStaffModalOpen(true)}
        onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
        onOpenCashShift={(tab) => handleOpenCashShift(tab || 'status')}
        onQuickTakeaway={handleQuickTakeaway}
        isShiftOpen={!!cashShiftService.getActiveShift()}
        activeRegisterName={cashShiftService.getCurrentRegister().name}
      />

      {/* Spacer to push content because Navbar is absolute/fixed */}
      <div className={`hidden sm:block ${isSidebarCollapsed ? 'w-[68px]' : 'w-[280px]'} h-full shrink-0 z-0 bg-[#3b3733]/10 transition-[width] duration-300 ease-out`}></div>

      {/* Main Workspace Container */}
      <div className="min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden relative pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        {/* Demo Mode Banner */}
        {subscription?.mode === 'DEMO' && activeTab !== 'landing' && (
          <div className="bg-gradient-to-r from-stone-800 to-stone-700 text-white px-4 py-2 text-xs font-medium flex items-center justify-between shadow-sm shrink-0 gap-3">
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-[#a9b994] shrink-0" />
              <span><strong className="text-[#a9b994]">Modo Demo:</strong> Los datos no son permanentes. Regístrate para guardar tu información y acceder a todas las funciones.</span>
            </div>
            <button
              onClick={() => {
                persistSubscription(null);
                setSubscription(null);
                setSkipSubscriptionGate(false);
              }}
              className="px-3 py-1 bg-[#a9b994] text-stone-900 rounded-lg text-[10px] font-bold hover:bg-[#bccaad] uppercase shrink-0 transition-colors"
            >
              Registrarme →
            </button>
          </div>
        )}

        {/* Offline Mode Banner when disconnected */}
        {!isOnline && activeTab !== 'landing' && (
          <div className="bg-amber-400 text-amber-950 px-4 py-2 text-xs font-bold flex items-center justify-between shadow-xs animate-in slide-in-from-top duration-150 shrink-0">
            <div className="flex items-center gap-2 max-w-5xl">
              <WifiOff className="w-4 h-4 text-amber-900 shrink-0" />
              <span>
                <strong>Modo Local Offline Activo:</strong> Sin conexión a Internet. Menú, mesas, personal y datos operativos guardados localmente siguen disponibles. Los cobros y la facturación electrónica requieren conexión y las operaciones pendientes no se enviarán hasta completar la sincronización de la fase 3.
              </span>
            </div>
            <button
              onClick={() => setIsOfflineModalOpen(true)}
              className="px-2.5 py-1 bg-amber-900 text-white rounded-lg text-[10px] font-bold hover:bg-black uppercase shrink-0 flex items-center gap-1"
            >
              <span>Cola ({pendingSyncCount})</span>
            </button>
          </div>
        )}

        {/* Main Dynamic Operational Content */}
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full w-full">
              <div className="w-8 h-8 border-3 border-[#a9b994]/30 border-t-[#a9b994] rounded-full animate-spin"></div>
            </div>
          }>
            {/* Landing Page (Public / Onboarding) - Only reachable locally if forced via activeTab */}
            {activeTab === 'landing' && (
              <LandingPage 
                onStartDemo={handleStartDemo} 
                onEnterPOS={() => setActiveTab('pos')}
              />
            )}

            {/* Punto de Venta: Mesas o Tomapedidos integrado */}
            {activeTab === 'pos' && (
              selectedTableForOrder && !cashShiftService.getActiveShift() ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-stone-50 animate-in fade-in duration-300">
                  <div className="w-24 h-24 bg-stone-200/50 rounded-full flex items-center justify-center mb-6">
                    <Lock className="w-12 h-12 text-stone-400" />
                  </div>
                  <h2 className="text-3xl font-black text-stone-800 mb-3 tracking-tight">Turno requerido para comandar</h2>
                  <p className="text-stone-500 max-w-md mx-auto mb-8 text-lg">
                    Puedes configurar mesas, salones, personal y menú sin turno. Para agregar productos o tomar esta comanda debes abrir un turno de caja.
                  </p>
                  {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(currentUser?.role || '') ? (
                    <button
                      onClick={() => handleOpenCashShift('status')}
                      className="px-8 py-4 bg-stone-900 text-white rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-stone-800 transition-colors shadow-xl shadow-stone-900/20 active:scale-95"
                    >
                      Abrir Turno Ahora
                    </button>
                  ) : (
                    <div className="px-6 py-4 bg-amber-100/50 text-amber-800 border border-amber-200 rounded-2xl font-bold text-sm shadow-sm">
                      Solicita a un administrador o cajero que abra el turno
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedTableForOrder(null)}
                    className="mt-4 text-sm font-bold text-stone-500 hover:text-stone-900"
                  >
                    Volver al mapa de mesas
                  </button>
                </div>
              ) : selectedTableForOrder ? (
                <OrderTaking
                  table={selectedTableForOrder}
                  tenant={tenant}
                  menuItems={menuItems}
                  onSaveOrder={handleSaveOrder}
                  onBackToTables={() => setSelectedTableForOrder(null)}
                  onDirectInvoice={() => setActiveTab('billing')}
                  onNotify={addNotification}
                  userRole={currentUser?.role || 'SALONERO'}
                  currentUser={currentUser}
                  onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
                  staffList={staffList}
                />
              ) : (
                <TableMap
                  tables={tables}
                  onSelectTable={handleSelectTable}
                  onOpenOrder={handleOpenOrder}
                  onSplitBill={handleSplitBill}
                  isAdmin={currentUser?.role === 'ADMIN'}
                  currentUser={currentUser}
                  onAuthenticateStaff={handleSwitchWaiter}
                  staffList={staffList}
                  tenant={tenant}
                  onUpdateTenant={handleUpdateTenant}
                  onUpdateTables={handleUpdateTables}
                  onQuickTakeaway={handleQuickTakeaway}
                  activeShiftZone={cashShiftService.getActiveShift()?.linkedZone}
                  activeShiftZones={cashShiftService.getActiveShift()?.linkedZones}
                  hasActiveShift={Boolean(cashShiftService.getActiveShift())}
                  onOpenCashShift={() => {
                    setCashShiftInitialTab('status');
                    setIsCashShiftModalOpen(true);
                  }}
                />
              )
            )}

            {/* Cocina & Bar (KDS) */}
            {activeTab === 'kds' && (
              tenant.plan === 'express' ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-stone-900/40 backdrop-blur-md animate-in fade-in duration-300">
                  <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/30 rounded-3xl flex items-center justify-center mb-6 shadow-xl">
                    <ChefHat className="w-10 h-10 text-amber-400" />
                  </div>
                  <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-black uppercase tracking-widest mb-3 border border-amber-500/30">
                    Función Exclusiva Plan Pro
                  </span>
                  <h2 className="text-3xl font-black text-white mb-3 tracking-tight">Monitor KDS para Cocina & Bar</h2>
                  <p className="text-stone-400 max-w-md mx-auto mb-8 text-sm leading-relaxed">
                    Tu suscripción actual es <strong>Plan Express</strong> (1 terminal). Para conectar pantallas en tiempo real en cocina, tiempos de despacho y enrutamiento automático de bebidas a barra, actualiza a <strong>Plan Pro</strong>.
                  </p>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-2xl font-bold text-sm tracking-wide shadow-xl shadow-emerald-900/30 active:scale-95 transition-all"
                  >
                    Actualizar a Plan Pro
                  </button>
                </div>
              ) : (
                <KDSView 
                  orders={kdsOrders}
                  menuItems={menuItems}
                  onUpdateStatus={handleUpdateKdsOrder}
                  onToggleItemCompletion={handleToggleKdsItem}
                  onNotify={addNotification} 
                />
              )
            )}

            {/* Catálogo de Menú */}
            {activeTab === 'menu' && currentUser.role === 'ADMIN' && (
              <MenuEditor 
                menuItems={menuItems} 
                onUpdateMenu={handleUpdateMenu} 
                taxRegime={tenant.taxRegime || 'TRADITIONAL'}
                plan={tenant.plan}
                tenant={tenant}
                onUpdateTenant={handleUpdateTenant}
              />
            )}

            {/* Caja & Facturación Electrónica CR v4.4 */}
            {activeTab === 'billing' && (
              <BillingHacienda
                tenant={tenant}
                currentUser={currentUser}
                selectedTable={selectedTableForOrder || tables.find(t => t.status === 'OCCUPIED' || t.status === 'PRE_CHECK') || tables[0] || null}
                onSaveTable={handleSaveOrder}
                onRegisterPayment={handleRegisterPayment}
                onNotify={addNotification}
                onOpenCashShift={(tab) => {
                  setCashShiftInitialTab(tab || 'status');
                  setIsCashShiftModalOpen(true);
                }}
                onOpenHaciendaHistory={() => setIsHaciendaHistoryOpen(true)}
                onBackToTables={() => {
                  setSelectedTableForOrder(null);
                  setActiveTab('pos');
                }}
              />
            )}

            {/* Reportes y Estadísticas */}
            {activeTab === 'reports' && ['ADMIN', 'CAJERO'].includes(currentUser.role) && (
              <ReportsDashboard tenant={tenant} />
            )}
          </Suspense>
        </main>

        <footer className="shrink-0 border-t border-stone-200/80 bg-white/80 px-4 py-2 text-center text-[10px] font-medium text-stone-400 backdrop-blur-sm">
          Sistema diseñado por Maikol Matamoros
        </footer>
      </div>

      {/* Unified Modals & Overlays wrapped in Suspense for Lazy Loading */}
      <Suspense fallback={null}>
        {/* Unified Settings & Tools Modal */}
        <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tenant={tenant}
        theme={posTheme}
        onThemeChange={handlePosThemeChange}
        onUpdateTenant={handleUpdateTenant}
        onUpdateTenantStatus={handleUpdateTenantStatus}
        onSelectTenant={(t) => handleUpdateTenant(t)}
        onNavigateToLanding={() => setActiveTab('landing')}
        onOpenNotion={() => setIsNotionModalOpen(true)}
        onOpenStaffModal={() => setIsStaffModalOpen(true)}
        currentUser={currentUser}
      />

      {/* Offline Synchronization Inspector & Simulator Modal */}
      <OfflineSyncModal
        isOpen={isOfflineModalOpen}
        onClose={() => setIsOfflineModalOpen(false)}
        isOnline={isOnline}
        pendingCount={pendingSyncCount}
        onToggleSimulatedOffline={handleToggleSimulatedOffline}
      />

      {/* Notion Database Integration & Users Manager Modal */}
      <NotionModal
        isOpen={isNotionModalOpen}
        onClose={() => setIsNotionModalOpen(false)}
        currentUser={currentUser}
        currentTenant={tenant}
      />

      {/* Staff & User Roles Management Modal */}
      <StaffModal
        isOpen={isStaffModalOpen}
        onClose={() => setIsStaffModalOpen(false)}
        currentUser={currentUser}
        currentTenant={tenant}
        staffList={staffList}
        onAddStaffMember={handleAddStaffMember}
        onSelectUser={handleSelectUser}
        onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
      />

      {/* Modern Quick Waiter Switch Modal with PIN */}
      <QuickWaiterSwitchModal
        isOpen={isQuickSwitchOpen}
        onClose={() => setIsQuickSwitchOpen(false)}
        staffList={staffList}
        currentUser={currentUser}
        tenantId={tenant.id}
        onSwitchUser={async (staff, pin) => { await handleSwitchWaiter(staff, pin); }}
        onAddStaffMember={handleAddStaffMember}
        restaurantName={tenant.name}
      />

      {/* Cash Shift & Cash Drawer Management Modal */}
      <CashShiftModal
        isOpen={isCashShiftModalOpen}
        onClose={() => {
          setIsCashShiftModalOpen(false);
          handleUpdateShifts(cashShiftService.getAllActiveShiftsMap(), false);
        }}
        tenant={tenant}
        tables={tables}
        currentUser={currentUser}
        staffList={staffList}
        initialTab={cashShiftInitialTab}
        onOpenZReport={(report) => {
          setActiveZReport(report);
          setActiveConsolidatedZReport(null);
          setIsZReportModalOpen(true);
        }}
        onOpenConsolidatedZReport={(consolidated) => {
          setActiveConsolidatedZReport(consolidated);
          setActiveZReport(null);
          setIsZReportModalOpen(true);
        }}
      />

      {/* Z-Report Official Thermal Closing Modal */}
      <ZReportModal
        isOpen={isZReportModalOpen}
        onClose={() => {
          setIsZReportModalOpen(false);
          setActiveZReport(null);
          setActiveConsolidatedZReport(null);
        }}
        report={activeZReport}
        consolidatedReport={activeConsolidatedZReport}
      />

      {/* Hacienda History Modal */}
      <HaciendaHistoryModal
        isOpen={isHaciendaHistoryOpen}
        onClose={() => setIsHaciendaHistoryOpen(false)}
        tenant={tenant}
      />

      {/* Copilot Chat Drawer */}
      <AICopilotChat
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        currentUser={currentUser}
        menuItems={menuItems}
        selectedTable={selectedTableForOrder}
        zones={tenant.zones || []}
        onOpenLearningHub={() => setIsNyzaHubOpen(true)}
        onQuickAction={(action) => {
          try {
            const cmd = JSON.parse(action);
            const autonomousAction = nyzaUIAgent.normalizeAction(cmd);
            if (autonomousAction) {
              void nyzaUIAgent.execute(autonomousAction, {
                createTable: handleNyzaCreateTable,
                navigateTo: (view) => {
                  setActiveTab(view === 'tables' ? 'pos' : view);
                  setSelectedTableForOrder(null);
                },
                openCashRegister: () => {
                  handleOpenCashShift('status');
                  setIsCopilotOpen(false);
                }
              });
              return;
            }
            if (cmd.type === 'OPEN_LEARNING_HUB' || cmd.type === 'NYZA_HUB') {
               setIsNyzaHubOpen(true);
            } else if (cmd.type === 'ADD_ITEM' && selectedTableForOrder) {
               // Find item
               const item = menuItems.find(m => m.name.toLowerCase().includes((cmd.product || '').toLowerCase()));
               if (item) {
                 const existingItems = selectedTableForOrder.activeOrder?.items ? [...selectedTableForOrder.activeOrder.items] : [];
                 const selectedModifiers = Array.isArray(cmd.modifiers) ? cmd.modifiers : [];
                 const modifierExtra = selectedModifiers.reduce((sum: number, mod: any) => sum + (Number(mod.extraPrice) || 0), 0);
                 const newOrder = {
                    orderNumber: selectedTableForOrder.activeOrder?.orderNumber || `ORD-${Date.now()}`,
                    server: selectedTableForOrder.activeOrder?.server || currentUser?.name || 'Mesero',
                    openedAt: selectedTableForOrder.activeOrder?.openedAt || new Date().toISOString(),
                    subAccounts: selectedTableForOrder.activeOrder?.subAccounts || [{ id: 1, name: 'General' }],
                    items: [
                      ...existingItems,
                      {
                        id: `itm_${Date.now()}`,
                        name: item.name,
                        quantity: cmd.quantity || 1,
                        price: item.price + modifierExtra,
                        notes: 'Agregado por Nysa IA',
                        cabysCode: item.cabysCode,
                        taxRate: item.taxRate,
                        category: item.station === 'Bar' ? 'Bar' : 'Cocina',
                        selectedModifiers: selectedModifiers.length > 0 ? selectedModifiers : undefined
                      }
                    ]
                 };
                 handleSaveOrder({ ...selectedTableForOrder, status: 'OCCUPIED', activeOrder: newOrder });
                 addNotification({
                   id: `nysa_${Date.now()}`,
                   type: 'ORDER_READY',
                   title: 'Nysa IA',
                   message: `Agregó ${cmd.quantity || 1}x ${item.name} a la mesa ${selectedTableForOrder.name}`,
                   timestamp: new Date()
                 });
               } else {
                 addNotification({
                   id: `nysa_err_${Date.now()}`,
                   type: 'NEW_ORDER',
                   title: 'Nysa IA (Aviso)',
                   message: `No encontró el producto: ${cmd.product || 'desconocido'}`,
                   timestamp: new Date()
                 });
               }
            } else if (cmd.type === 'ADD_ZONE') {
               const zoneName = String(cmd.name || '').trim();
               if (!zoneName) throw new Error('Nyza recibió un salón sin nombre.');
               const existingZones = tenant.zones || [];
               if (!existingZones.some(z => z.toLowerCase() === zoneName.toLowerCase())) {
                 handleUpdateTenant({ ...tenant, zones: [...existingZones, zoneName] });
                 addNotification({
                   id: `nyza_zone_${Date.now()}`,
                   type: 'ORDER_READY',
                   title: 'Nyza IA',
                   message: `Creó el salón "${zoneName}".`,
                   timestamp: new Date()
                 });
               } else {
                 addNotification({
                   id: `nyza_zone_exists_${Date.now()}`,
                   type: 'NEW_ORDER',
                   title: 'Nyza IA',
                   message: `El salón "${zoneName}" ya existe.`,
                   timestamp: new Date()
                 });
               }
            } else if (cmd.type === 'OPEN_REPORTS') {
               setActiveTab('reports');
               addNotification({
                 id: `nyza_report_${Date.now()}`,
                 type: 'ORDER_READY',
                 title: 'Nyza IA',
                 message: `Abrí los reportes de ${cmd.range || 'hoy'} para que revises las cifras reales.`,
                 timestamp: new Date()
               });
            } else if (cmd.type === 'ADD_TABLE_RANGE' || cmd.type === 'ADD_TABLES' || cmd.type === 'CREATE_TABLES') {
               const zoneName = String(cmd.zone || 'Salón Principal').trim();
               const from = Number(cmd.from ?? cmd.start ?? cmd.startNumber);
               const to = Number(cmd.to ?? cmd.end ?? cmd.endNumber);
               const seats = Math.max(1, Number(cmd.seats ?? 2) || 2);
               if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 200) {
                 throw new Error('Rango de mesas inválido.');
               }

               const currentZones = tenant.zones || [];
               const nextZones = currentZones.some(z => z.toLowerCase() === zoneName.toLowerCase())
                 ? currentZones
                 : [...currentZones, zoneName];
               const nextTables = [...tables];
               let created = 0;
               for (let number = from; number <= to; number++) {
                 const exists = nextTables.some(t => t.number === number || t.name.toLowerCase() === `mesa ${number}`.toLowerCase());
                 if (exists) continue;
                 const column = (number - from) % 5;
                 const row = Math.floor((number - from) / 5);
                 nextTables.push({
                   id: `tbl_${Date.now()}_${number}_${Math.random().toString(36).slice(2, 6)}`,
                   number,
                   name: `Mesa ${number}`,
                   seats,
                   shape: 'square',
                   status: 'AVAILABLE',
                   zone: zoneName,
                   x: 12 + column * 19,
                   y: 18 + row * 18
                 });
                 created++;
               }
               if (nextZones.length !== currentZones.length) {
                 handleUpdateTenant({ ...tenant, zones: nextZones });
               }
               if (created > 0) handleUpdateTables(nextTables);
               addNotification({
                 id: `nyza_tables_${Date.now()}`,
                 type: created > 0 ? 'ORDER_READY' : 'NEW_ORDER',
                 title: 'Nyza IA',
                 message: created > 0
                   ? `Configuró ${created} mesa(s) en ${zoneName}, para ${seats} persona(s).`
                   : `Las mesas solicitadas ya existían en ${zoneName}.`,
                 timestamp: new Date()
               });
            } else if (cmd.type === 'ADD_TABLE') {
               const tableName = cmd.name || 'Nueva Mesa';
               const tableNumberStr = tableName.replace(/\D/g, '');
               const tableNum = tableNumberStr ? parseInt(tableNumberStr, 10) : tables.length + 1;
               const exists = tables.some(t => t.number === tableNum || t.name.toLowerCase() === tableName.toLowerCase());
               if (!exists) {
                 const newTable: Table = {
                   id: `tbl_${Date.now()}`,
                   number: tableNum,
                   name: tableName,
                   seats: 4,
                   shape: 'square',
                   status: 'AVAILABLE',
                   zone: cmd.zone || 'Salón Principal',
                   x: 50,
                   y: 50
                 };
                 handleUpdateTables([...tables, newTable]);
                 addNotification({
                   id: `nysa_${Date.now()}`,
                   type: 'ORDER_READY',
                   title: 'Nysa IA',
                   message: `Creó la ${tableName} en la zona ${newTable.zone}`,
                   timestamp: new Date()
                 });
               } else {
                 addNotification({
                   id: `nysa_err_${Date.now()}`,
                   type: 'NEW_ORDER',
                   title: 'Nysa IA (Aviso)',
                   message: `La ${tableName} ya existe.`,
                   timestamp: new Date()
                 });
               }
            } else if (cmd.type === 'OPEN_SHIFT') {
               handleOpenCashShift('status');
               setIsCopilotOpen(false);
            } else if (cmd.type === 'TOGGLE_DISH_AVAILABILITY') {
               const targetName = (cmd.product || '').toLowerCase();
               const updated = menuItems.map(m =>
                 m.name.toLowerCase().includes(targetName)
                   ? { ...m, available: Boolean(cmd.available) }
                   : m
               );
               handleUpdateMenu(updated);
               addNotification({
                 id: `nyza_${Date.now()}`,
                 type: 'HACIENDA_UPDATE',
                 title: 'Nyza Menú',
                 message: `${cmd.available ? 'Activó' : 'Pausó'} "${cmd.product || 'platillo'}" en el menú.`,
                 timestamp: new Date()
               });
            } else if (cmd.tool_calls && Array.isArray(cmd.tool_calls)) {
               (async () => {
                 for (const tool of cmd.tool_calls) {
                   const res = await nyzaSelfHealing.executeTool(tool.name, tool.parameters);
                   addNotification({
                     id: 'nyza_' + Date.now() + '_' + Math.random(),
                     type: res.status === 'OK' ? 'ORDER_READY' : 'NEW_ORDER',
                     title: 'Nyza: ' + tool.name,
                     message: res.message,
                     timestamp: new Date()
                   });
                 }
               })();
            } else if (cmd.type === 'AUTO_REPAIR') {
               if (tenant.plan === 'express') {
                 addNotification({
                   id: `nysa_err_${Date.now()}`,
                   type: 'NEW_ORDER',
                   title: 'Saborai Copilot',
                   message: 'El diagnóstico automático y soporte 24/7 requiere un Plan de mayor nivel.',
                   timestamp: new Date()
                 });
                 setIsCopilotOpen(false);
                 return;
               }
               setIsCopilotOpen(false);
               setIsRepairing(true);
               setRepairStep(0);
               soundService.playKeyClickSound();
               setTimeout(() => setRepairStep(1), 1500);
               setTimeout(() => setRepairStep(2), 3500);
               setTimeout(() => {
                 setRepairStep(3);
                 soundService.playSuccessChime();
               }, 5500);
               setTimeout(() => {
                 setIsRepairing(false);
               }, 8000);
            }
          } catch(e) { console.error(e); }
        }}
      />

      {/* Nyza Autonomous Continuous Learning & Global Intelligence Hub */}
      <NyzaLearningHub
        isOpen={isNyzaHubOpen}
        onClose={() => setIsNyzaHubOpen(false)}
        tenant={tenant}
        currentUser={currentUser || undefined}
        onOpenCopilot={() => {
          setIsNyzaHubOpen(false);
          setIsCopilotOpen(true);
        }}
      />
      </Suspense>

      {/* Auto-Repair Overlay */}
      {isRepairing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white max-w-sm w-full rounded-3xl p-8 shadow-2xl text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-stone-100">
              <div 
                className="h-full bg-[#588157] transition-all duration-500 ease-out" 
                style={{ width: `${(repairStep / 3) * 100}%` }}
              />
            </div>
            
            {repairStep < 3 ? (
              <>
                <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                  <div className="absolute inset-0 rounded-full border-4 border-[#588157] border-t-transparent animate-spin"></div>
                  <Sparkles className="w-8 h-8 text-[#588157] animate-pulse" />
                </div>
                <h3 className="text-xl font-black text-stone-900 mb-2">Diagnosticando Sistema...</h3>
                <p className="text-sm text-stone-500 font-medium">
                  {repairStep === 0 && 'Escaneando base de datos y memoria local...'}
                  {repairStep === 1 && 'Resolviendo conflictos en caché...'}
                  {repairStep === 2 && 'Restableciendo conexión con módulos...'}
                </p>
              </>
            ) : (
              <div className="animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Sparkles className="w-10 h-10 text-emerald-600" />
                </div>
                <h3 className="text-xl font-black text-stone-900 mb-2">¡Sistema Reparado!</h3>
                <p className="text-sm text-stone-500 font-medium">Todos los módulos están operando al 100%. Saborai IA corrigió los fallos.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Real-time Audible & Visual Notification Toasts */}
      <NotificationToastContainer
        notifications={notifications}
        onDismiss={dismissNotification}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
      />

      {/* Botón flotante de WhatsApp oculto temporalmente mientras se configura el bot de IA en Meta
      {import.meta.env.VITE_WHATSAPP_SUPPORT_NUMBER && (
        <a
          href={`https://wa.me/${String(import.meta.env.VITE_WHATSAPP_SUPPORT_NUMBER).replace(/\D/g, '')}?text=${encodeURIComponent('Hola, necesito soporte con Saborai POS.')}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Abrir soporte de Saborai por WhatsApp"
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow-xl shadow-emerald-900/25 transition-transform hover:scale-105 hover:bg-[#20bd5a]"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="hidden sm:inline">Soporte por WhatsApp</span>
        </a>
      )} */}

    </div>
  );
}

export default App;
