import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { NyzaSetupGuide } from './components/NyzaSetupGuide';
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
const ExecutiveOrderModal = lazy(() => import('./components/ExecutiveOrderModal').then(m => ({ default: m.ExecutiveOrderModal })));
const CashShiftModal = lazy(() => import('./components/CashShiftModal').then(m => ({ default: m.CashShiftModal })));
const ZReportModal = lazy(() => import('./components/ZReportModal').then(m => ({ default: m.ZReportModal })));
const HaciendaHistoryModal = lazy(() => import('./components/HaciendaHistoryModal').then(m => ({ default: m.HaciendaHistoryModal })));
const AICopilotChat = lazy(() => import('./components/AICopilotChat').then(m => ({ default: m.AICopilotChat })));
const NyzaLearningHub = lazy(() => import('./components/NyzaLearningHub').then(m => ({ default: m.NyzaLearningHub })));
const AuthScreen = lazy(() => import('./components/AuthScreen').then(m => ({ default: m.AuthScreen })));
const SuperAdminBackoffice = lazy(() => import('./components/SuperAdminBackoffice').then(m => ({ default: m.SuperAdminBackoffice })));
const MenuEditor = lazy(() => import('./components/MenuEditor').then(m => ({ default: m.MenuEditor })));
const ReportsDashboard = lazy(() => import('./components/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })));
const WelcomeGate = lazy(() => import('./components/WelcomeGate').then(m => ({ default: m.WelcomeGate })));
const ResetPasswordScreen = lazy(() => import('./components/ResetPasswordScreen').then(m => ({ default: m.ResetPasswordScreen })));
const LegalPage = lazy(() => import('./components/LegalPage').then(m => ({ default: m.LegalPage })));
import { cashShiftService } from './services/cashShiftService';
import { printerService } from './services/printerService';
import { sanitizeFiscalInvoiceData } from './utils/fiscalInvoiceItems';
import { nyzaUIAgent } from './services/nyzaUIAgent';
import { ZReportData, ConsolidatedZReportData } from './types/cashShift';
import { SaboraiSubscription } from './components/WelcomeGate';
import { initialTenant, initialTables, sampleMenuItems } from './data/mockData';
import { HaciendaConfig, Table, TenantInfo, SubscriptionPlan, SubscriptionStatus, UserProfile, MenuItem, KDSOrder } from './types';
import { localDB } from './services/db';
import { PosCloudSyncError, posCloudService, SaleCloudPayload, SaleRegistrationResult, salePaymentOperationId } from './services/posCloudService';
import { inventoryService } from './services/inventoryService';
import { createDispatchOperationId, getUndispatchedItems, toInventoryDispatchItem } from './services/inventoryDispatch';
import { employeeCreditService } from './services/employeeCreditService';
import { getQuickPaymentAttemptByOperationId, isQuickPaymentEffectApplied, markQuickPaymentEffectApplied } from './services/quickPaymentAttempt';
import { createEmployeeSession, fetchEmployeeRoster, fetchEmployeeRosterAdmin, syncEmployeeRoster, withoutEmployeePin } from './services/employeeSessionService';
import { soundService } from './services/soundEffects';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { NotificationToastContainer, PosNotification } from './components/NotificationToast';
import { nyzaSelfHealing } from './services/nyzaSelfHealingService';
import { validateNyzaAction } from './services/nyzaActionValidation';
import { runTenantBoundToolSequence } from './services/nyzaToolSequence';
import { getTenantItem, hasTenantItem, isLocalDemoTenantId, migrateLegacyDataToTenant, setActiveTenantId, setTenantItem, startCleanDemoSession } from './services/tenantStorage';
import { DEMO_TENANT_ID } from './services/demoSeed';
import { isCloudTenantUuid, projectTableLayout, readTableLayout, seedTableLayoutIfMissing, subscribeToTableLayout, tableLayoutSignature, upsertTableLayout, validateTableLayout, TableLayoutItem } from './services/tableLayoutCloudService';
import { mergeConcurrentTableLayouts } from './services/tableLayoutConcurrency';
import { restoreTablePositionsFromSnapshot } from './services/tableLayoutPersistence';
import { normalizeTenantZones, persistTenantZones, resolveTenantZones } from './services/tenantZones';
import { readTableSnapshot } from './services/tableSync';
import { getTransferableZonesForBranch, transferTableAccount } from './services/tableAccountTransfer';
import { isReservationReminderDue } from './services/tableReservationLogic';
import { loadTableReservations, subscribeToTableReservations } from './services/tableReservationService';
import { supabaseClient } from './lib/supabaseClient';
import { WifiOff, Lock, Eye, ChefHat } from 'lucide-react';

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

function withoutHaciendaSecrets(config?: HaciendaConfig | null): HaciendaConfig | undefined {
  if (!config) return undefined;
  return {
    ...config,
    atvUsername: undefined,
    atvPassword: undefined,
    pinP12: undefined,
    p12Base64: undefined
  };
}

function withPublicHaciendaConfig(tenant: TenantInfo): TenantInfo {
  return { ...tenant, haciendaConfig: withoutHaciendaSecrets(tenant.haciendaConfig) };
}

function getTenantProfileWithLegacyFallback(tenantId: string): TenantInfo | null {
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

function redactEmployeePins(staff: UserProfile[]): UserProfile[] {
  return staff.map(member => withoutEmployeePin(member) as UserProfile);
}

function getAccountUserId(fallback?: string | null): string | null {
  try {
    return localStorage.getItem('saborai_account_user_id') || fallback || null;
  } catch {
    return fallback || null;
  }
}

function syncTenantZonesWithServer(zones: string[]): Promise<string[]> {
  try {
    const token = localStorage.getItem('saborai_token');
    if (!token) return Promise.reject(new Error('No hay una sesión autenticada para guardar los salones.'));
    return persistTenantZones(zones, token);
  } catch (error) {
    return Promise.reject(error);
  }
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
  });
  const [isNyzaSetupGuideOpen, setIsNyzaSetupGuideOpen] = useState(false);
  const activeTenantIdRef = useRef(tenant.id);

  useEffect(() => {
    if (isLoadingAuth || currentUser?.role !== 'ADMIN' || tenant.onboardingCompleted) {
      setIsNyzaSetupGuideOpen(false);
      return;
    }

    let isPaused = false;
    try {
      const saved = localStorage.getItem(`saborai_setup_guide_v1:${tenant.id}`);
      isPaused = saved ? JSON.parse(saved)?.paused === true : false;
    } catch {
      isPaused = false;
    }
    setIsNyzaSetupGuideOpen(!isPaused);
  }, [isLoadingAuth, currentUser?.id, currentUser?.role, tenant.id, tenant.onboardingCompleted]);

  const [notifications, setNotifications] = useState<PosNotification[]>([]);
  const addNotification = useCallback((notif: PosNotification) => {
    setNotifications(prev => [notif, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notif.id));
    }, 7000);
  }, []);

  useEffect(() => {
    const handleRejectedSync = (event: Event) => {
      const detail = (event as CustomEvent<{
        tenantId?: string;
        code?: string;
        message?: string;
        employeeCreditIdempotencyKey?: string;
      }>).detail;
      if (detail?.tenantId !== tenant.id
        || !['DAILY_CASH_CLOSED', 'DAILY_CASH_NOT_OPEN'].includes(detail.code || '')) return;
      if (detail.employeeCreditIdempotencyKey
        && employeeCreditService.discardPendingCharge(tenant.id, detail.employeeCreditIdempotencyKey)) {
        void employeeCreditService.refreshLedger(tenant.id).catch(() => {});
      }
      addNotification({
        id: `daily_cash_closed_${Date.now()}`,
        type: 'SYNC_ERROR',
        title: detail.code === 'DAILY_CASH_NOT_OPEN' ? 'Cobro no registrado: caja sin apertura diaria' : 'Cobro no registrado: caja cerrada',
        message: detail.message || (detail.code === 'DAILY_CASH_NOT_OPEN'
          ? 'Primero debe abrirse la caja para el día local actual.'
          : 'La caja ya tiene cierre diario. Contacte al administrador si necesita corregir el cierre.'),
        timestamp: new Date()
      });
    };
    window.addEventListener('saborai_sync_rejected', handleRejectedSync);
    return () => window.removeEventListener('saborai_sync_rejected', handleRejectedSync);
  }, [addNotification, tenant.id]);

  useEffect(() => {
    const handlePaymentSynced = (event: Event) => {
      const detail = (event as CustomEvent<{
        tenantId?: string;
        operationId?: string;
        clientMetadata?: Record<string, unknown>;
      }>).detail;
      if (detail?.tenantId !== tenant.id || typeof detail.operationId !== 'string') return;
      const quickPayment = (detail.clientMetadata as any)?.quickPayment;
      if (!quickPayment || quickPayment.tenantId !== tenant.id || quickPayment.operationId !== detail.operationId) return;
      let attempt = getQuickPaymentAttemptByOperationId(detail.operationId);
      if (!attempt) return;

      if (quickPayment.employeeCredit && !isQuickPaymentEffectApplied(attempt, 'employeeCredit')) {
        try {
          employeeCreditService.recordCharge(quickPayment.employeeCredit);
          attempt = markQuickPaymentEffectApplied(attempt, 'employeeCredit');
          void employeeCreditService.refreshLedger(tenant.id).catch(() => {});
        } catch (error) {
          addNotification({
            id: `quick_payment_credit_sync_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'Crédito confirmado; falta actualizar la vista local',
            message: error instanceof Error ? error.message : 'Vuelva a abrir el registro de crédito para refrescarlo.',
            timestamp: new Date()
          });
        }
      }

      if (quickPayment.cashShift && !isQuickPaymentEffectApplied(attempt, 'cashShift')) {
        try {
          cashShiftService.recordSalePayment(quickPayment.cashShift);
          attempt = markQuickPaymentEffectApplied(attempt, 'cashShift');
        } catch (error) {
          addNotification({
            id: `quick_payment_cash_sync_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'Pago confirmado; resumen de caja pendiente',
            message: error instanceof Error ? error.message : 'Refresque el turno para actualizar el resumen.',
            timestamp: new Date()
          });
        }
      }

      const inventory = quickPayment.inventory;
      if (inventory && Array.isArray(inventory.items) && typeof inventory.operationId === 'string'
        && !isQuickPaymentEffectApplied(attempt, 'inventory')) {
        try {
          inventoryService.deductItemsStock(
            inventory.items,
            'SALE_DEDUCTION',
            typeof inventory.reason === 'string' ? inventory.reason : 'Venta QuickPayment',
            inventory.operationId,
            tenant.id
          );
          attempt = markQuickPaymentEffectApplied(attempt, 'inventory');
        } catch (error) {
          addNotification({
            id: `quick_payment_inventory_sync_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'Pago confirmado; inventario pendiente',
            message: error instanceof Error ? error.message : 'Refresque el inventario para actualizar las existencias.',
            timestamp: new Date()
          });
        }
      }
    };
    window.addEventListener('saborai_payment_synced', handlePaymentSynced);
    return () => window.removeEventListener('saborai_payment_synced', handlePaymentSynced);
  }, [addNotification, tenant.id]);

  useEffect(() => {
    if (isLoadingAuth || !currentUser?.id) return;
    let active = true;
    let reservationSnapshot: Awaited<ReturnType<typeof loadTableReservations>> = [];
    const cacheKey = `saborai_reservation_reminders_v1:${tenant.id}`;
    const notified = new Set<string>();
    try {
      const stored = window.sessionStorage.getItem(cacheKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        for (const value of parsed) if (typeof value === 'string') notified.add(value);
      }
    } catch {
      // The in-memory set still prevents duplicates while this session remains mounted.
    }

    const refresh = async () => {
      try {
        const loaded = await loadTableReservations(tenant.id);
        if (active) reservationSnapshot = loaded;
      } catch {
        // The service keeps locally cached reservations available while offline.
      }
    };
    const remindDueReservations = () => {
      if (!active || document.visibilityState !== 'visible') return;
      const now = Date.now();
      for (const reservation of reservationSnapshot) {
        if (!isReservationReminderDue(reservation, now)) continue;
        const key = `${reservation.id}:${reservation.reservedAt}`;
        if (notified.has(key)) continue;
        notified.add(key);
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify([...notified]));
        } catch {
          // The in-memory set still prevents repeated reminders in this active session.
        }
        const reservationTime = new Date(reservation.reservedAt).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
        addNotification({
          id: `reservation-reminder-${tenant.id}-${key}`,
          type: 'RESERVATION_REMINDER',
          title: 'Reserva próxima',
          message: `${reservation.customerName} llega a las ${reservationTime} · ${reservation.tableName}.`,
          timestamp: new Date(now)
        });
      }
    };
    const refreshAndRemind = async () => {
      await refresh();
      remindDueReservations();
    };
    void refreshAndRemind();
    const unsubscribe = subscribeToTableReservations(tenant.id, () => { void refreshAndRemind(); });
    const interval = window.setInterval(remindDueReservations, 15_000);
    const handleResume = () => { void refreshAndRemind(); };
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleResume);
    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleResume);
    };
  }, [addNotification, currentUser?.id, isLoadingAuth, tenant.id]);

  // Mantener tenant.haciendaConfig reactivo cuando se actualiza desde HaciendaSettings
  useEffect(() => {
    const handleCfgUpdate = (e: any) => {
      const detail = e.detail;
      const cfg = withoutHaciendaSecrets(detail?.config || detail);
      if (cfg) {
        setTenant(prev => {
          if (detail?.tenantId && String(detail.tenantId) !== String(prev.id)) return prev;
          return {
            ...prev,
            cedulaJuridica: cfg.cedulaEmisor || prev.cedulaJuridica,
            haciendaConfig: { ...(prev.haciendaConfig || {}), ...cfg }
          };
        });
      }
    };
    window.addEventListener('saborai_hacienda_config_updated', handleCfgUpdate);
    return () => window.removeEventListener('saborai_hacienda_config_updated', handleCfgUpdate);
  }, []);

  const broadcastTenantRef = useRef<((t: TenantInfo) => void) | null>(null);
  const broadcastStaffRef = useRef<((s: UserProfile[]) => void) | null>(null);
  const broadcastKdsOrdersRef = useRef<((orders: KDSOrder[]) => void) | null>(null);
  const broadcastMenuItemsRef = useRef<((items: MenuItem[]) => void) | null>(null);

  const handleUpdateTenant = (updated: TenantInfo, skipBroadcast = false) => {
    const safeUpdated = withPublicHaciendaConfig(updated);
    const shouldPersistZones = !skipBroadcast
      && JSON.stringify(normalizeTenantZones(updated.zones)) !== JSON.stringify(normalizeTenantZones(tenant.zones));
    activeTenantIdRef.current = safeUpdated.id;
    setTenant(safeUpdated);
    setActiveTenantId(safeUpdated.id);
    if (!skipBroadcast && broadcastTenantRef.current) {
      broadcastTenantRef.current(safeUpdated);
    }
    try {
      localStorage.setItem('saborai_tenant', JSON.stringify(safeUpdated));
      // Persistir también en el almacenamiento aislado por tenant. El perfil
      // contiene los salones y categorías, que deben sobrevivir al logout y
      // no depender únicamente del estado global de la sesión.
      setTenantItem('tenant_profile', safeUpdated, safeUpdated.id);
      setTenantItem('zones', safeUpdated.zones || [], safeUpdated.id);
      // Solo una edición local de la lista envía un PATCH; una hidratación remota
      // nunca reescribe una copia posiblemente obsoleta en el servidor.
      if (shouldPersistZones && !isLocalDemoTenantId(safeUpdated.id)) {
        void syncTenantZonesWithServer(safeUpdated.zones || []).catch(error => {
          console.warn('[SaborAI] No se pudieron guardar los salones:', error);
          addNotification({
            id: `zones_sync_error_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'No se confirmaron los salones',
            message: 'El servidor no confirmó el cambio. Revisa tu conexión antes de volver a intentarlo.',
            timestamp: new Date()
          });
        });
      }
    } catch {}
  };

  const finishNyzaSetupGuide = async () => {
    handleUpdateTenant({ ...tenant, onboardingCompleted: true });
    setIsNyzaSetupGuideOpen(false);
    if (isLocalDemoTenantId(tenant.id)) return;

    try {
      const token = localStorage.getItem('saborai_token');
      if (!token) return;
      const response = await fetch('/api/tenant/onboarding', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error('No se pudo confirmar la guía de inicio en el servidor:', error);
      addNotification({
        id: `setup_guide_sync_error_${Date.now()}`,
        type: 'SYNC_ERROR',
        title: 'Guía completada en este dispositivo',
        message: 'No se pudo confirmar el cierre en el servidor. Si vuelves a entrar desde otro dispositivo, la guía podría aparecer de nuevo.',
        timestamp: new Date()
      });
    }
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
      const activeTenantId = localStorage.getItem('saborai_active_tenant_id');
      if (isLocalDemoTenantId(activeTenantId)) {
        setIsLoadingAuth(false);
        return;
      }
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
          activeTenantIdRef.current = data.tenant.id;
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
          activeTenantIdRef.current = tenantObj.id;
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
    const reconciledMenu = inventoryService.reconcileMenuCatalog(updatedMenu, tenant.id);
    setMenuItems(reconciledMenu);
    if (!skipBroadcast) broadcastMenuItems(reconciledMenu);
    try {
      setTenantItem('menu', reconciledMenu, tenant.id);
    } catch {}
    window.dispatchEvent(new CustomEvent('saborai_menu_updated', { detail: { tenantId: tenant.id, menu: reconciledMenu } }));
  };

  // Keep menuItems reactively synchronized with inventory stock deductions
  useEffect(() => {
    const handleInventoryChange = (event: Event) => {
      try {
        const eventTenantId = (event as CustomEvent<{ tenantId?: string }>).detail?.tenantId;
        if (eventTenantId && eventTenantId !== tenant.id) return;
        const saved = getTenantItem<MenuItem[]>('menu', tenant.id);
        if (saved) {
          const reconciled = inventoryService.reconcileMenuCatalog(saved, tenant.id);
          setMenuItems(reconciled);
          broadcastMenuItemsRef.current?.(reconciled);
        }
      } catch {}
    };
    window.addEventListener('saborai_inventory_updated', handleInventoryChange);
    return () => window.removeEventListener('saborai_inventory_updated', handleInventoryChange);
  }, [tenant.id]);

  const [tables, setTables] = useState<Table[]>(() => {
    try {
      const scoped = getTenantItem<Table[]>('tables');
      if (Array.isArray(scoped)) return normalizeTablePositions(scoped);
    } catch {}
    return normalizeTablePositions(initialTables);
  });
  const [localDbReady, setLocalDbReady] = useState(false);
  const [hydratedSnapshotTenantId, setHydratedSnapshotTenantId] = useState<string | null>(null);
  const tablesHydrated = !isLoadingAuth && localDbReady && hydratedSnapshotTenantId === tenant.id;
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
  const offlineSnapshotBaseRef = useRef<{ tenantId: string; layout: TableLayoutItem[] } | null>(null);
  const layoutWriteTimerRef = useRef<number | null>(null);
  const layoutReadRetryTimerRef = useRef<number | null>(null);
  const pendingLayoutSignatureRef = useRef<string | null>(null);
  const layoutRetryAttemptsRef = useRef(0);
  const layoutReadRetryAttemptsRef = useRef(0);

  const handleUpdateTables = (updatedTables: Table[], skipBroadcast = false) => {
    let nextTables = updatedTables;
    if (skipBroadcast) {
      const currentById = new Map(tablesRef.current.map(table => [table.id, table]));
      const syncState = tableLayoutSyncRef.current;
      if (syncState.tenantId === tenant.id && syncState.remoteLayout) {
        // The incoming snapshot owns membership and operational fields; Supabase
        // contributes geometry only for IDs that still exist in that snapshot.
        const remoteById = new Map(syncState.remoteLayout.map(item => [item.id, item]));
        nextTables = updatedTables.map(incoming => {
          const current = currentById.get(incoming.id);
          const base = { ...(current || { status: 'AVAILABLE' as const }), ...incoming };
          const layoutItem = remoteById.get(incoming.id);
          return layoutItem ? { ...base, ...layoutItem } : base;
        });
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
      // Keep the newest geometry synchronously available for a reload while the cloud write debounces.
      setTenantItem('tables', nextTables, tenant.id);
    } catch {}
  };

  const [shiftsVersion, setShiftsVersion] = useState(0);

  // Cada sesión usa su propio espacio operativo. Al cambiar de tenant se
  // descarta el estado en memoria anterior y se carga únicamente el nuevo.
  useEffect(() => {
    activeTenantIdRef.current = tenant.id;
    localDB.setActiveTenantId(tenant.id);
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

  const handleUpdateStaff = useCallback((newStaff: UserProfile[], skipBroadcast = false) => {
    const staffForStorage = isCloudTenantUuid(tenant.id) ? redactEmployeePins(newStaff) : newStaff;
    setStaffList(staffForStorage);
    if (!skipBroadcast && broadcastStaffRef.current) {
      broadcastStaffRef.current(staffForStorage);
    }
    try {
      setTenantItem('staff', staffForStorage, tenant.id);
    } catch {}
  }, [tenant.id]);

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
    tablesHydrated,
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
      tablesHydrated,
      hasLocalData: hasTenantItem('menu', tenant.id) || hasTenantItem('tables', tenant.id) || Object.keys(cashShiftService.getAllActiveShiftsMap()).length > 0 || hasTenantItem('tenant_profile', tenant.id)
    })
  );

  useEffect(() => {
    broadcastTenantRef.current = broadcastTenant;
    broadcastStaffRef.current = broadcastStaff;
    broadcastKdsOrdersRef.current = broadcastKdsOrders;
    broadcastMenuItemsRef.current = broadcastMenuItems;
  }, [broadcastTenant, broadcastStaff, broadcastKdsOrders, broadcastMenuItems]);

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
    offlineSnapshotBaseRef.current = null;
    if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
    layoutWriteTimerRef.current = null;
    if (layoutReadRetryTimerRef.current !== null) window.clearTimeout(layoutReadRetryTimerRef.current);
    layoutReadRetryTimerRef.current = null;
    layoutReadRetryAttemptsRef.current = 0;
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
      const currentLayout = projectTableLayout(tablesRef.current);
      const currentSignature = tableLayoutSignature(currentLayout);
      const offlineBase = offlineSnapshotBaseRef.current?.tenantId === tenantId
        ? offlineSnapshotBaseRef.current.layout
        : null;
      const knownBase = syncState.remoteLayout ?? offlineBase;
      const hasLocalChanges = knownBase !== null
        && currentSignature !== tableLayoutSignature(knownBase);
      const resolvedLayout = hasLocalChanges
        ? mergeConcurrentTableLayouts(knownBase || [], currentLayout, record.layout)
        : record.layout;
      if (offlineBase) offlineSnapshotBaseRef.current = null;
      syncState.remoteUpdatedAt = record.updatedAt || syncState.remoteUpdatedAt;
      syncState.remoteLayout = record.layout;
      clearLegacyTablePositions(tenantId);
      if (layoutReadRetryTimerRef.current !== null) window.clearTimeout(layoutReadRetryTimerRef.current);
      layoutReadRetryTimerRef.current = null;
      layoutReadRetryAttemptsRef.current = 0;
      const next = mergeCloudLayoutIntoTables(tablesRef.current, resolvedLayout);
      const signature = tableLayoutSignature(projectTableLayout(next));
      // La firma remota sirve como base para que el efecto de escritura vuelva
      // a persistir únicamente las ediciones locales no conflictivas.
      syncState.signature = tableLayoutSignature(record.layout);
      syncState.ready = true;
      if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
      layoutWriteTimerRef.current = null;
      pendingLayoutSignatureRef.current = null;
      layoutRetryAttemptsRef.current = 0;
      if (hasLocalChanges || signature !== currentSignature) {
        tablesRef.current = next;
        setTables(next);
      }
      try { setTenantItem('tables', next, tenantId); } catch {}
    };

    if (!isCloudTenantUuid(tenantId)) {
      // Demo/local tenants (including tenant_demo_*) remain entirely local.
      syncState.ready = true;
      setTenantItem('tables', legacyTables, tenantId);
      clearLegacyTablePositions(tenantId);
      return () => { cancelled = true; };
    }

    const cloudClient = supabaseClient;
    if (!cloudClient) {
      syncState.ready = true;
      syncState.signature = tableLayoutSignature(projectTableLayout(tablesRef.current));
      return () => { cancelled = true; };
    }

    // Wait until both the app session and offline snapshot have hydrated. Otherwise
    // a transient auth read can make the default grid look like a confirmed layout.
    if (isLoadingAuth || hydratedSnapshotTenantId !== tenantId) {
      return () => { cancelled = true; };
    }

    const unsubscribe = subscribeToTableLayout(tenantId, applyRemoteLayout);
    let readInFlight = false;
    const scheduleInitialReadRetry = () => {
      if (cancelled || tableLayoutSyncRef.current !== syncState || syncState.ready) return;
      layoutReadRetryAttemptsRef.current += 1;
      const exponent = Math.min(layoutReadRetryAttemptsRef.current - 1, 6);
      const retryDelay = Math.min(1_000 * 2 ** exponent, 60_000);
      layoutReadRetryTimerRef.current = window.setTimeout(() => {
        layoutReadRetryTimerRef.current = null;
        void loadInitialLayout();
      }, retryDelay);
    };
    const loadInitialLayout = async () => {
      if (cancelled || readInFlight || syncState.ready) return;
      readInFlight = true;
      try {
        await cloudClient.auth.getSession();
        const initial = await readTableLayout(tenantId);
        if (cancelled || tableLayoutSyncRef.current !== syncState) return;
        if (!initial.available) {
          // A failed read is not evidence that the row is absent: keep local positions and retry.
          scheduleInitialReadRetry();
          return;
        }
        if (initial.exists && initial.record) {
          const incomingTime = initial.record.updatedAt ? Date.parse(initial.record.updatedAt) : 0;
          const listenerTime = syncState.remoteUpdatedAt ? Date.parse(syncState.remoteUpdatedAt) : 0;
          if (!syncState.remoteUpdatedAt || incomingTime >= listenerTime) applyRemoteLayout(initial.record);
          else syncState.ready = true;
          return;
        }

        // Seed only after an available read confirms no row, and only after the
        // synchronous cache and IndexedDB snapshot have had a chance to hydrate.
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
          scheduleInitialReadRetry();
        }
      } catch {
        scheduleInitialReadRetry();
      } finally {
        readInFlight = false;
      }
    };
    const handleOnline = () => {
      if (layoutReadRetryTimerRef.current !== null) window.clearTimeout(layoutReadRetryTimerRef.current);
      layoutReadRetryTimerRef.current = null;
      layoutReadRetryAttemptsRef.current = 0;
      void loadInitialLayout();
    };
    window.addEventListener('online', handleOnline);
    void loadInitialLayout();
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener('online', handleOnline);
      if (layoutWriteTimerRef.current !== null) window.clearTimeout(layoutWriteTimerRef.current);
      layoutWriteTimerRef.current = null;
      if (layoutReadRetryTimerRef.current !== null) window.clearTimeout(layoutReadRetryTimerRef.current);
      layoutReadRetryTimerRef.current = null;
      pendingLayoutSignatureRef.current = null;
    };
  }, [tenant.id, isLoadingAuth, hydratedSnapshotTenantId]);

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
        const saved = await upsertTableLayout(tenant.id, layout, latestState.remoteLayout || []);
        if (latestState !== tableLayoutSyncRef.current) return;
        if (saved) {
          const savedSignature = tableLayoutSignature(saved.layout);
          const pendingSignature = pendingLayoutSignatureRef.current;
          latestState.signature = savedSignature;
          latestState.remoteLayout = saved.layout;
          latestState.remoteUpdatedAt = saved.updatedAt || latestState.remoteUpdatedAt;
          layoutRetryAttemptsRef.current = 0;
          if (pendingSignature === signature) {
            pendingLayoutSignatureRef.current = null;
            const current = tablesRef.current;
            const reconciled = mergeCloudLayoutIntoTables(current, saved.layout);
            if (tableLayoutSignature(projectTableLayout(reconciled)) !== tableLayoutSignature(projectTableLayout(current))) {
              tablesRef.current = reconciled;
              setTables(reconciled);
              try {
                setTenantItem('tables', reconciled, tenant.id);
              } catch {}
            }
          } else if (!pendingSignature && tableLayoutSignature(projectTableLayout(tablesRef.current)) !== savedSignature) {
            // Un evento Realtime pudo haber cancelado el debounce mientras este
            // request estaba en vuelo; vuelve a evaluar el estado actual.
            tablesRef.current = [...tablesRef.current];
            setTables(tablesRef.current);
          }
          return;
        }
        if (pendingLayoutSignatureRef.current !== signature) return;
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

  const [selectedTableForOrder, setSelectedTableForOrder] = useState<Table | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isNyzaHubOpen, setIsNyzaHubOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'regime' | 'hacienda'>('regime');
  const [guideOpenZonesRequest, setGuideOpenZonesRequest] = useState(0);
  const [guideOpenTableRequest, setGuideOpenTableRequest] = useState(0);
  const [guideOpenMenuImportRequest, setGuideOpenMenuImportRequest] = useState(0);
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const [isExecutiveOrderOpen, setIsExecutiveOrderOpen] = useState(false);
  const [executiveOrderInitialView, setExecutiveOrderInitialView] = useState<'new-order' | 'ledger'>('new-order');
  const [executiveModalSession, setExecutiveModalSession] = useState(0);
  const [isCashShiftModalOpen, setIsCashShiftModalOpen] = useState(false);
  const [cashShiftInitialTab, setCashShiftInitialTab] = useState<'status' | 'movements' | 'close' | 'history' | 'registers'>('status');
  const [cashShiftInitialZone, setCashShiftInitialZone] = useState<string | undefined>();
  const [returnToFloorAfterShiftOpen, setReturnToFloorAfterShiftOpen] = useState(false);
  const [activeZReport, setActiveZReport] = useState<ZReportData | null>(null);
  const [activeConsolidatedZReport, setActiveConsolidatedZReport] = useState<ConsolidatedZReportData | null>(null);
  const [isZReportModalOpen, setIsZReportModalOpen] = useState(false);
  const [isHaciendaHistoryOpen, setIsHaciendaHistoryOpen] = useState(false);

  const handleOpenCashShift = (tab: 'status' | 'movements' | 'close' | 'history' | 'registers' = 'status', zone?: string) => {
    setCashShiftInitialTab(tab);
    setCashShiftInitialZone(zone);
    setReturnToFloorAfterShiftOpen(Boolean(zone));
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

  const handleResetStaffPin = async (userId: string, newPin: string) => {
    if (currentUser?.role !== 'ADMIN' || !/^\d{4}$/.test(newPin)) return;
    if (isCloudTenantUuid(tenant.id) && userId === currentUser.id) {
      throw new Error('La cuenta propietaria no utiliza PIN de empleado.');
    }
    const updated = staffList.map(member => member.id === userId ? { ...member, pin: newPin } : member);
    if (isCloudTenantUuid(tenant.id)) {
      await syncEmployeeRoster(tenant.id, updated);
      handleUpdateStaff(redactEmployeePins(updated));
    } else {
      handleUpdateStaff(updated);
    }
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
      .then(() => employeeRosterRole === 'ADMIN'
        ? fetchEmployeeRosterAdmin(tenant.id)
        : fetchEmployeeRoster(tenant.id))
      .then(serverStaff => {
        const serverHasEmployees = serverStaff.length > 1;
        const effectiveStaff = serverHasEmployees
          ? serverStaff
          : [serverStaff[0], ...staffList.filter(member => member.id !== serverStaff[0]?.id)];
        const visibleStaff = employeeRosterRole === 'ADMIN'
          ? effectiveStaff
          : effectiveStaff.map(member => ({ ...member, email: '', phone: '' }));
        handleUpdateStaff(redactEmployeePins(visibleStaff));
      })
      .catch(error => {
        employeeRosterSyncRef.current = '';
        console.warn('[POS] No se pudo cargar o sincronizar el padrón de colaboradores:', error);
      });
  }, [isLoadingAuth, employeeRosterUserId, employeeRosterRole, tenant.id, staffList, handleUpdateStaff]);

  // Network & Sync state
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Sound & Notifications state
  const [isMuted, setIsMuted] = useState<boolean>(() => soundService.isMuted());

  const handleToggleMute = () => {
    const nextMuted = soundService.toggleMute();
    setIsMuted(nextMuted);
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
      if (localDB.isOnline()) void localDB.syncAllPending(tenant.id);
    };
    window.addEventListener('online', syncWhenOnline);
    syncWhenOnline();
    return () => window.removeEventListener('online', syncWhenOnline);
  }, [localDbReady, tenant.id]);

  // IndexedDB es el respaldo del POS cuando localStorage fue limpiado o no está disponible.
  // La membresía de mesas del snapshot es completa, incluso cuando el arreglo está vacío.
  useEffect(() => {
    if (!localDbReady || !tenant.id) return;
    let cancelled = false;

    void localDB.getTenantSnapshot(tenant.id).then(snapshot => {
      if (cancelled) return;
      if (!snapshot) {
        setHydratedSnapshotTenantId(tenant.id);
        return;
      }

      if (!hasTenantItem('menu', tenant.id) && snapshot.menuItems.length > 0) {
        setMenuItems(snapshot.menuItems as MenuItem[]);
        setTenantItem('menu', snapshot.menuItems, tenant.id);
      }
      const snapshotTableList = readTableSnapshot(snapshot.tables);
      if (snapshotTableList) {
        const snapshotTables = restoreTablePositionsFromSnapshot(
          normalizeTablePositions(snapshotTableList as Table[]),
          getTenantItem<Table[]>('tables', tenant.id)
        );
        const syncState = tableLayoutSyncRef.current;
        const snapshotBase = validateTableLayout(snapshot.tableLayoutBase);
        let restoredTables = snapshotTables;
        if (syncState.tenantId === tenant.id && syncState.remoteLayout !== null) {
          const resolvedLayout = snapshotBase
            ? mergeConcurrentTableLayouts(snapshotBase, projectTableLayout(snapshotTables), syncState.remoteLayout)
            : syncState.remoteLayout;
          restoredTables = mergeCloudLayoutIntoTables(snapshotTables, resolvedLayout);
        } else if (snapshotBase) {
          offlineSnapshotBaseRef.current = { tenantId: tenant.id, layout: snapshotBase };
        }
        tablesRef.current = restoredTables;
        setTables(restoredTables);
        setTenantItem('tables', restoredTables, tenant.id);
      }
      if (!hasTenantItem('staff', tenant.id) && snapshot.staff.length > 0) {
        setStaffList(snapshot.staff as UserProfile[]);
        setTenantItem('staff', snapshot.staff, tenant.id);
      }
      if (snapshot.kdsOrders.length > 0) {
        setKdsOrders(current => current.length > 0 ? current : snapshot.kdsOrders as KDSOrder[]);
      }
      if (snapshot.tenant && !hasTenantItem('tenant_profile', tenant.id)) {
        const snapshotTenant = snapshot.tenant as TenantInfo;
        if (String(snapshotTenant.id) === String(tenant.id)) {
          activeTenantIdRef.current = tenant.id;
          setTenant(snapshotTenant);
          setTenantItem('tenant_profile', snapshotTenant, tenant.id);
        }
      }
      setHydratedSnapshotTenantId(tenant.id);
    });

    return () => {
      cancelled = true;
    };
  }, [localDbReady, tenant.id]);

  // Mantiene un snapshot local coherente para poder arrancar y consultar el POS offline.
  // Las credenciales sensibles se eliminan dentro de localDB antes de persistir.
  useEffect(() => {
    if (!localDbReady || !tenant.id || hydratedSnapshotTenantId !== tenant.id) return;
    let timer: number | null = null;
    let cancelled = false;
    const saveSnapshot = () => {
      if (cancelled) return;
      const syncState = tableLayoutSyncRef.current;
      if (isCloudTenantUuid(tenant.id) && (syncState.tenantId !== tenant.id || !syncState.ready)) {
        timer = window.setTimeout(saveSnapshot, 350);
        return;
      }
      void localDB.saveTenantSnapshot({
        tenantId: tenant.id,
        version: 1,
        updatedAt: new Date().toISOString(),
        tenant,
        menuItems,
        tables,
        ...(syncState.tenantId === tenant.id && syncState.remoteLayout !== null
          ? { tableLayoutBase: syncState.remoteLayout }
          : {}),
        staff: isCloudTenantUuid(tenant.id) ? redactEmployeePins(staffList) : staffList,
        kdsOrders
      });
    };
    timer = window.setTimeout(saveSnapshot, 350);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [localDbReady, hydratedSnapshotTenantId, tenant, menuItems, tables, staffList, kdsOrders]);

  const handleLoginSuccess = (user: UserProfile, loggedTenant: TenantInfo) => {
    // El endpoint de login devuelve la identidad del tenant, pero los ajustes
    // operativos (salones, categorías, régimen y Hacienda) pueden haber sido
    // guardados localmente por tenant. Restaurarlos aquí evita que el login
    // reemplace el tenant hidratado por uno sin salones.
    const savedTenant = getTenantProfileWithLegacyFallback(loggedTenant.id);
    const restoredTenant: TenantInfo = {
      ...loggedTenant,
      zones: resolveTenantZones(loggedTenant.zones, savedTenant?.zones),
      menuCategories: savedTenant?.menuCategories ?? loggedTenant.menuCategories ?? [],
      taxRegime: savedTenant?.taxRegime ?? loggedTenant.taxRegime,
      includeService10ByDefault: savedTenant?.includeService10ByDefault ?? loggedTenant.includeService10ByDefault,
      haciendaConfig: withoutHaciendaSecrets(savedTenant?.haciendaConfig ?? loggedTenant.haciendaConfig)
    };

    activeTenantIdRef.current = restoredTenant.id;
    setActiveTenantId(restoredTenant.id);
    migrateLegacyDataToTenant(restoredTenant.id);
    cashShiftService.setTenantContext(restoredTenant.id, isLocalDemoTenantId(restoredTenant.id));
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
      if (!isLocalDemoTenantId(tenant.id)) void supabaseClient?.auth.signOut().catch(() => {});
      localStorage.removeItem('saborai_user');
      localStorage.removeItem('saborai_token');
      localStorage.removeItem('saborai_tenant');
      localStorage.removeItem('saborai_account_user_id');
      localStorage.removeItem('saborai_employee_id');
    } catch {}
    setCurrentUser(null);
  };

  const handleStartDemo = async (plan: SubscriptionPlan) => {
    await localDB.clearDemoSessionData();
    const demoTenantId = DEMO_TENANT_ID;
    const demoSeed = startCleanDemoSession(demoTenantId);
    activeTenantIdRef.current = demoTenantId;
    localStorage.removeItem('saborai_account_user_id');
    localStorage.removeItem('saborai_employee_id');
    cashShiftService.setTenantContext(demoTenantId, true);
    printerService.setTenantContext(demoTenantId);
    setMenuItems(demoSeed.menuItems);
    setTables(normalizeTablePositions(demoSeed.tables));
    setStaffList([]);
    setKdsOrders([]);
    setSelectedTableForOrder(null);
    const updatedTenant: TenantInfo = {
      id: demoTenantId,
      name: 'SaborAI Demo',
      cedulaJuridica: '',
      email: '',
      phone: '',
      location: 'Costa Rica',
      plan,
      status: 'ACTIVE',
      currency: 'CRC',
      zones: demoSeed.zones,
      menuCategories: [...new Set(demoSeed.menuItems.map(item => item.category))],
      taxRegime: 'TRADITIONAL',
      includeService10ByDefault: true,
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
      id: 'demo_admin',
      name: 'Usuario Demo',
      email: 'demo@saborai.local',
      phone: '+506 0000-0000',
      restaurantName: 'SaborAI Demo',
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

  const handleExecutiveOrder = (employee: Pick<UserProfile, 'id' | 'name'>) => {
    if (!cashShiftService.getActiveShift()) {
      setCashShiftInitialTab('status');
      setIsCashShiftModalOpen(true);
      addNotification({ id: `executive_shift_${Date.now()}`, type: 'HACIENDA_UPDATE', title: 'Turno de Caja Requerido', message: 'Debes abrir un turno para registrar una Comanda Ejecutiva.', timestamp: new Date() });
      return;
    }
    const executiveTable: Table = {
      id: `executive_${Date.now()}`,
      number: Math.floor(800 + Math.random() * 99),
      name: `Comanda Ejecutiva - ${employee.name}`,
      seats: 1,
      shape: 'square',
      status: 'OCCUPIED',
      zone: 'Comanda Ejecutiva',
      x: 0,
      y: 0,
      activeOrder: {
        orderNumber: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
        server: currentUser?.name || 'Caja',
        openedAt: new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
        subAccounts: [{ id: 1, name: employee.name }],
        items: [],
        executiveEmployeeId: employee.id,
        executiveEmployeeName: employee.name
      }
    };
    setSelectedTableForOrder(executiveTable);
    setIsExecutiveOrderOpen(false);
    setActiveTab('pos');
  };

  const handleEmployeeCreditPayment = async (employee: Pick<UserProfile, 'id' | 'name'>, amount: number, idempotencyKey: string): Promise<void> => {
    if (!cashShiftService.getActiveShift()) {
      addNotification({ id: `credit_shift_${Date.now()}`, type: 'HACIENDA_UPDATE', title: 'Turno de Caja Requerido', message: 'Debes abrir un turno para registrar un abono.', timestamp: new Date() });
      throw new Error('Abre un turno de caja antes de registrar el abono.');
    }
    if (!isOnline || !localDB.isOnline()) throw new Error('Conecta el dispositivo para guardar el abono en el registro central.');
    try {
      const recordedPayment = await employeeCreditService.recordPayment({
        tenantId: tenant.id,
        employeeId: employee.id,
        amount,
        reference: `ABONO-EMPLEADO-${employee.id}`,
        idempotencyKey
      });
      if (!recordedPayment.alreadyApplied) {
        cashShiftService.recordSalePayment({ cashAmount: amount, subtotal: amount, tenantId: tenant.id, actor: currentUser || undefined, reference: `ABONO-EMPLEADO-${employee.id}` });
      }
      addNotification({ id: `credit_paid_${Date.now()}`, type: 'ORDER_READY', title: 'Abono registrado', message: `Se registró un abono de ₡${amount.toLocaleString('es-CR')} para ${employee.name}.`, timestamp: new Date() });
    } catch (error) {
      addNotification({ id: `credit_paid_error_${Date.now()}`, type: 'HACIENDA_UPDATE', title: 'No se pudo registrar el abono', message: error instanceof Error ? error.message : 'Verifica el saldo pendiente.', timestamp: new Date() });
      throw error;
    }
  };

  const handleSplitBill = (table: Table) => {
    setSelectedTableForOrder(table);
    setActiveTab('billing');
  };

  const handleRegisterPayment = async (sale: SaleCloudPayload): Promise<SaleRegistrationResult> => {
    const paymentOperationId = salePaymentOperationId(tenant.id, sale);
    const orderNumber = sale.table.activeOrder?.orderNumber;
    if (!orderNumber) return { status: 'REJECTED', message: 'No se pudo identificar la orden para registrar el pago.' };
    const operationPrefix = `sale:${tenant.id}:${sale.invoice.clave50Digitos || orderNumber}`;
    const cashRegisterId = cashShiftService.getCurrentRegisterId();
    const cashShiftId = cashShiftService.getActiveShift(cashRegisterId)?.id;
    const saleOccurredAt = new Date().toISOString();
    const saleWithCashScope: SaleCloudPayload = {
      ...sale,
      cashRegisterId,
      cashShiftId: cashShiftId || undefined,
      occurredAt: saleOccurredAt
    };
    const executiveEmployeeId = sale.table.activeOrder?.executiveEmployeeId;
    const employeeCredit = sale.paymentMethod === '04-Credito' && executiveEmployeeId
      ? {
          employeeId: executiveEmployeeId,
          employeeName: sale.table.activeOrder?.executiveEmployeeName || 'Colaborador',
          idempotencyKey: `credit:${paymentOperationId}`
        }
      : undefined;
    const invoicePayload = {
      orderNumber: sale.table.activeOrder?.orderNumber,
      clave: sale.invoice.clave50Digitos,
      consecutivo: sale.invoice.consecutivo,
      documentType: sale.invoice.tipoDocumento || 'TE',
      total: sale.invoice.totalComprobante,
      invoiceData: sanitizeFiscalInvoiceData(sale.invoice),
      xmlContent: sale.invoice.xmlContent
    };
    const paymentPayload = {
      orderNumber: sale.table.activeOrder?.orderNumber,
      cashRegisterId,
      cashShiftId,
      occurredAt: saleOccurredAt,
      payments: [{
        amount: sale.total,
        method: sale.paymentMethod === '01-Efectivo' ? 'CASH' : sale.paymentMethod === '02-Tarjeta' ? 'CARD' : sale.paymentMethod === '04-Credito' ? 'CREDIT' : 'SINPE',
        provider: 'POS_OFFLINE_FALLBACK'
      }],
      employeeCredit,
      closeOrder: sale.closeOrder
    };
    const inventoryPayload = {
      orderNumber,
      items: getUndispatchedItems(sale.items)
    };
    const preparedTable: Table = { ...(sale.tableBeforePayment || sale.table), status: 'OCCUPIED' };
    const completedTable: Table = sale.closeOrder
      ? { ...sale.table, status: 'AVAILABLE', activeOrder: undefined }
      : sale.table;
    const queueSaleOperations = async (): Promise<boolean> => {
      try {
        await localDB.enqueueOfflineAction('UPDATE_TABLE', preparedTable, 'Orden preparada antes de registrar el pago', tenant.id, `${operationPrefix}:order:prepare`);
        await localDB.enqueueOfflineAction('PAYMENT', paymentPayload, 'Pago pendiente de sincronización', tenant.id, paymentOperationId);
        if (inventoryPayload.items.length > 0) {
          await localDB.enqueueOfflineAction('DEDUCT_INVENTORY', inventoryPayload, 'Inventario pendiente de sincronización', tenant.id, `${operationPrefix}:inventory`);
        }
        await localDB.enqueueOfflineAction('UPDATE_TABLE', completedTable, 'Estado de mesa pendiente de sincronización', tenant.id, `${operationPrefix}:order:complete`);
        await localDB.enqueueOfflineAction('EMIT_INVOICE', invoicePayload, 'Factura pendiente de sincronización', tenant.id, `${operationPrefix}:invoice`);
        return true;
      } catch {
        return false;
      }
    };

    if (sale.paymentMethod === '04-Credito' && executiveEmployeeId) {
      employeeCreditService.recordCharge({
        tenantId: tenant.id,
        employeeId: executiveEmployeeId,
        employeeName: sale.table.activeOrder?.executiveEmployeeName || 'Trabajador',
        amount: sale.total,
        orderNumber: sale.table.activeOrder?.orderNumber,
        invoiceClave: sale.invoice.clave50Digitos,
        createdBy: currentUser?.id,
        idempotencyKey: employeeCredit?.idempotencyKey || `credit:${paymentOperationId}`
      });
    }

    if (localDB.isOnline()) {
      try {
        await posCloudService.syncSale(tenant.id, {
          ...saleWithCashScope,
          tableBeforePayment: preparedTable
        });
        void employeeCreditService.refreshLedger(tenant.id).catch(error => console.warn('[Employee Credit] No se pudo actualizar la vista local:', error));
        return { status: 'CONFIRMED' };
      } catch (error) {
        if (error instanceof PosCloudSyncError && ['DAILY_CASH_CLOSED', 'DAILY_CASH_NOT_OPEN'].includes(error.code || '')) {
          if (employeeCredit?.idempotencyKey
            && employeeCreditService.discardPendingCharge(tenant.id, employeeCredit.idempotencyKey)) {
            void employeeCreditService.refreshLedger(tenant.id).catch(() => {});
          }
          addNotification({
            id: `daily_cash_closed_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: error.code === 'DAILY_CASH_NOT_OPEN' ? 'Cobro no registrado: caja sin apertura diaria' : 'Cobro no registrado: caja cerrada',
            message: error.message,
            timestamp: new Date()
          });
          return { status: 'REJECTED', message: error.message };
        }
        console.warn('[POS Cloud] Venta en cola después de fallo de red:', error);
        const queued = await queueSaleOperations();
        return {
          status: 'QUEUED',
          message: queued
            ? 'El cobro quedó guardado para sincronizarse; el comprobante no se enviará a Hacienda hasta recuperar la conexión.'
            : 'El resultado del cobro no está confirmado en la nube y la cola local falló. No vuelva a cobrar; revise la sincronización antes de cerrar la orden.'
        };
      }
    }

    if (isLocalDemoTenantId(tenant.id)) return { status: 'CONFIRMED' };
    const queued = await queueSaleOperations();
    return {
      status: 'QUEUED',
      message: queued
        ? 'El cobro quedó guardado para sincronizarse; el comprobante no se enviará a Hacienda hasta recuperar la conexión.'
        : 'El cobro no pudo guardarse en la cola local. No vuelva a cobrar; revise la conexión y la sincronización antes de continuar.'
    };
  };

  const handleSaveOrder = (updatedTable: Table, queuedPayment?: { tableUpdateOperationId: string; orderNumber: string; persisted?: boolean }) => {
    if (!updatedTable) return;
    if (queuedPayment && !queuedPayment.persisted) {
      const dependentTable = { ...updatedTable, orderNumber: queuedPayment.orderNumber };
      void localDB.enqueueOfflineAction(
        'UPDATE_TABLE',
        dependentTable,
        `Comanda actualizada en ${updatedTable.name || 'Mesa'} (${queuedPayment.orderNumber})`,
        tenant.id,
        queuedPayment.tableUpdateOperationId
      ).then(() => handleSaveOrder(updatedTable, { ...queuedPayment, persisted: true })).catch(error => addNotification({
        id: `table_payment_queue_${Date.now()}`,
        type: 'SYNC_ERROR',
        title: 'Mesa sigue ocupada',
        message: error instanceof Error ? error.message : 'No se pudo guardar el cierre después del pago en cola. La mesa quedó abierta; no vuelva a cobrar y revise la cola de sincronización.',
        timestamp: new Date()
      }));
      return;
    }
    const dispatchItemIds = new Set<string>();

    // 1. Process new items for KDS
    if (updatedTable.activeOrder && Array.isArray(updatedTable.activeOrder.items)) {
      const newKitchenItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && (i.category === 'Cocina' || !i.category));
      const newBarItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && i.category === 'Bar');
      const dispatchItems = [...newKitchenItems, ...newBarItems];
      dispatchItems.forEach(item => dispatchItemIds.add(item.id));

      const timestamp = new Date();
      const serverName = updatedTable.activeOrder.server || 'Mesero';
      
      const newKdsOrders: KDSOrder[] = [];

      if (newKitchenItems.length > 0) {
        const orderId = `kds_c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        newKitchenItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; i.inventoryDeductedAtDispatch = true; });
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
            dinerName: i.dinerName,
            notes: i.notes, 
            modifiers: i.selectedModifiers?.map(m => m.choiceName),
            completed: false 
          }))
        });
      }

      if (newBarItems.length > 0) {
        const orderId = `kds_b_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        newBarItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; i.inventoryDeductedAtDispatch = true; });
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
            dinerName: i.dinerName,
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
    if (updatedTable.id.startsWith('takeaway_') || updatedTable.id.startsWith('executive_')) {
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
    const dispatchItems = updatedTable.activeOrder?.items?.filter(item => dispatchItemIds.has(item.id)) || [];
    if (dispatchItems.length > 0) {
      const orderNumber = updatedTable.activeOrder?.orderNumber || '';
      dispatchItems.forEach(item => {
        inventoryService.deductItemsStock(
          [{ menuItemId: item.menuItemId, name: item.name, quantity: item.quantity }],
          'DISPATCH_DEDUCTION',
          undefined,
          createDispatchOperationId(tenant.id, orderNumber, item.id),
          tenant.id
        );
      });
      const syncDispatch = async () => {
        let tableSynced = false;
        if (queuedPayment) {
          tableSynced = false;
        } else if (localDB.isOnline()) {
          try {
            await posCloudService.syncOperation('UPDATE_TABLE', updatedTable as unknown as Record<string, unknown>, tenant.id);
            tableSynced = true;
          } catch {
            await localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id);
          }
        } else {
          await localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id);
        }

        for (const item of dispatchItems) {
          const operationId = createDispatchOperationId(tenant.id, orderNumber, item.id);
          const payload = { orderNumber, items: [toInventoryDispatchItem(item)] };
          if (tableSynced && localDB.isOnline()) {
            try {
              await posCloudService.syncOperation('DISPATCH_INVENTORY', payload, tenant.id, operationId);
              continue;
            } catch {
              // Reuse the same idempotency key when the outbox retries.
            }
          }
          await localDB.enqueueOfflineAction('DISPATCH_INVENTORY', payload, `Descuento pendiente para ${item.name}`, tenant.id, operationId);
        }
      };
      void syncDispatch().catch(error => addNotification({
        id: `table_payment_queue_${Date.now()}`,
        type: 'SYNC_ERROR',
        title: 'Mesa pendiente de sincronización',
        message: error instanceof Error ? error.message : 'No se pudo guardar el cambio de mesa después del cobro. No vuelva a cobrar; revise la cola de sincronización.',
        timestamp: new Date()
      }));
      return;
    }

    if (queuedPayment) {
      return;
    }

    if (localDB.isOnline()) {
      void posCloudService.syncOperation('UPDATE_TABLE', updatedTable as unknown as Record<string, unknown>, tenant.id)
        .catch(() => localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id));
    } else {
      void localDB.enqueueOfflineAction('UPDATE_TABLE', updatedTable, orderDescription, tenant.id);
    }
  };

  const getActiveBranchTransferContext = () => {
    const activeShift = cashShiftService.getActiveShift();
    const registers = cashShiftService.getCashRegisters();
    const activeRegister = registers.find(register => register.id === activeShift?.cashRegisterId);
    if (!activeShift || !activeRegister?.branchCode) return { branchCode: '', zones: [] as string[] };
    return {
      branchCode: activeRegister.branchCode,
      zones: getTransferableZonesForBranch(
        registers,
        Object.values(cashShiftService.getAllActiveShiftsMap()),
        activeRegister.branchCode
      )
    };
  };

  const handleTransferTableAccount = async (sourceTable: Table, destinationTableId: string): Promise<boolean> => {
    const currentTables = tablesRef.current;
    const currentSource = currentTables.find(table => table.id === sourceTable.id);
    const destination = currentTables.find(table => table.id === destinationTableId);
    const transferContext = getActiveBranchTransferContext();
    if (!currentSource?.activeOrder || !destination || !transferContext.branchCode
      || !transferContext.zones.includes(currentSource.zone)
      || !transferContext.zones.includes(destination.zone)) return false;

    const currentKdsOrders = kdsOrders;
    const result = transferTableAccount(
      currentTables,
      currentKdsOrders,
      currentSource.id,
      destination.id,
      transferContext.zones
    );
    if (!result) return false;

    handleUpdateTables(result.tables);
    setSelectedTableForOrder(current => current?.id === currentSource.id ? result.destinationTable : current);
    handleUpdateKdsOrdersRealtime(result.kdsOrders);
    const rollbackTransfer = async () => {
      handleUpdateTables(currentTables);
      setSelectedTableForOrder(current => current?.id === destination.id ? currentSource : current);
      handleUpdateKdsOrdersRealtime(currentKdsOrders);
      await Promise.all([
        localDB.saveItem('tables', currentSource),
        localDB.saveItem('tables', destination)
      ]);
    };
    try {
      await Promise.all([
        localDB.saveItem('tables', result.sourceTable),
        localDB.saveItem('tables', result.destinationTable)
      ]);
    } catch {
      await rollbackTransfer();
      addNotification({
        id: `table_account_transfer_local_error_${Date.now()}`,
        type: 'SYNC_ERROR',
        title: 'Traslado no guardado',
        message: 'No se pudo guardar el cambio en este dispositivo; las mesas permanecen como estaban.',
        timestamp: new Date(),
        station: 'General'
      });
      return false;
    }

    const operationId = `table_account_transfer_${Date.now()}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const tableSnapshot = (table: Table) => ({
      id: table.id,
      number: table.number,
      name: table.name,
      zone: table.zone,
      seats: table.seats,
      shape: table.shape,
      x: table.x,
      y: table.y,
      rotation: table.rotation
    });
    const transferPayload = {
      branchCode: transferContext.branchCode,
      orderNumber: currentSource.activeOrder.orderNumber,
      sourceTable: tableSnapshot(currentSource),
      destinationTable: tableSnapshot(destination)
    };
    const description = `Traslado de cuenta: ${currentSource.name} → ${destination.name}`;
    let pendingSync = false;
    if (localDB.isOnline()) {
      try {
        await posCloudService.syncOperation(
          'TRANSFER_TABLE_ACCOUNT',
          transferPayload,
          tenant.id,
          operationId
        );
      } catch (error) {
        if (error instanceof PosCloudSyncError && error.code === 'TABLE_ACCOUNT_TRANSFER_REJECTED') {
          await rollbackTransfer();
          addNotification({
            id: `table_account_transfer_rejected_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'Traslado no aplicado',
            message: error.message || 'La cuenta o las mesas cambiaron; actualiza el mapa antes de volver a intentarlo.',
            timestamp: new Date(),
            station: 'General'
          });
          return false;
        }
        try {
          await localDB.enqueueOfflineAction('TRANSFER_TABLE_ACCOUNT', transferPayload, description, tenant.id, operationId);
        } catch {
          await rollbackTransfer();
          addNotification({
            id: `table_account_transfer_queue_error_${Date.now()}`,
            type: 'SYNC_ERROR',
            title: 'Traslado no guardado',
            message: 'No se pudo guardar el traslado para sincronizar; las mesas permanecen como estaban.',
            timestamp: new Date(),
            station: 'General'
          });
          return false;
        }
        pendingSync = true;
      }
    } else {
      try {
        await localDB.enqueueOfflineAction('TRANSFER_TABLE_ACCOUNT', transferPayload, description, tenant.id, operationId);
      } catch {
        await rollbackTransfer();
        addNotification({
          id: `table_account_transfer_queue_error_${Date.now()}`,
          type: 'SYNC_ERROR',
          title: 'Traslado no guardado',
          message: 'No se pudo guardar el traslado para sincronizar; las mesas permanecen como estaban.',
          timestamp: new Date(),
          station: 'General'
        });
        return false;
      }
      pendingSync = true;
    }

    addNotification({
      id: `table_account_transfer_${Date.now()}`,
      type: 'TABLE_UPDATE',
      title: pendingSync ? 'Traslado guardado localmente' : 'Cuenta trasladada',
      message: pendingSync
        ? `La cuenta de ${currentSource.name} pasó a ${destination.name} y queda pendiente de sincronización.`
        : `La cuenta completa pasó de ${currentSource.name} a ${destination.name}; conservó su número y contenido.`,
      timestamp: new Date(),
      station: 'General'
    });
    return true;
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

  return (
    <div data-pos-theme={activeTab === 'landing' ? 'light' : posTheme} className="pos-theme-root h-screen w-screen overflow-hidden flex flex-col sm:flex-row font-sans selection:bg-[#a9b994]/30">

      {currentUser.role === 'ADMIN' && (
        <NyzaSetupGuide
          key={tenant.id}
          isOpen={isNyzaSetupGuideOpen}
          tenant={tenant}
          currentUser={currentUser}
          onPause={() => setIsNyzaSetupGuideOpen(false)}
          onComplete={() => { void finishNyzaSetupGuide(); }}
          onOpenStaff={() => setIsStaffModalOpen(true)}
          onOpenZones={() => {
            setSelectedTableForOrder(null);
            setActiveTab('pos');
            setGuideOpenZonesRequest(request => request + 1);
          }}
          onOpenTableCreator={() => {
            setSelectedTableForOrder(null);
            setActiveTab('pos');
            setGuideOpenTableRequest(request => request + 1);
          }}
          onOpenMenuImporter={() => {
            setSelectedTableForOrder(null);
            setActiveTab('menu');
            setGuideOpenMenuImportRequest(request => request + 1);
          }}
          onOpenHacienda={() => {
            setSettingsInitialSection('hacienda');
            setIsSettingsOpen(true);
          }}
        />
      )}
      
      {/* Navbar: Bottom on mobile, Vertical on Desktop */}
      <Navbar
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={collapsed => setIsSidebarCollapsed(collapsed)}
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
        onOpenSettings={() => {
          setSettingsInitialSection('regime');
          setIsSettingsOpen(true);
        }}
        onOpenSetupGuide={() => setIsNyzaSetupGuideOpen(true)}
        showSetupGuide={!tenant.onboardingCompleted}
        onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
        onOpenStaffModal={() => setIsStaffModalOpen(true)}
        onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
        onOpenCashShift={(tab) => handleOpenCashShift(tab || 'status')}
        onQuickTakeaway={handleQuickTakeaway}
        onOpenExecutiveOrder={() => {
          setExecutiveModalSession(session => session + 1);
          setExecutiveOrderInitialView('new-order');
          setIsExecutiveOrderOpen(true);
        }}
        onOpenEmployeeCreditLedger={() => {
          setExecutiveModalSession(session => session + 1);
          setExecutiveOrderInitialView('ledger');
          setIsExecutiveOrderOpen(true);
        }}
        isShiftOpen={!!cashShiftService.getActiveShift()}
        activeRegisterName={cashShiftService.getCurrentRegister().name}
      />

      {/* Spacer to push content because Navbar is absolute/fixed */}
      <div className={`hidden sm:block ${isSidebarCollapsed ? 'w-[68px]' : 'w-[280px]'} h-full shrink-0 z-0 bg-[#3b3733]/10 transition-[width] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`}></div>

      {/* Main Workspace Container */}
      <div className="flex-1 h-full min-w-0 flex flex-col overflow-hidden relative pb-16 sm:pb-0">
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
        <main className="flex-1 h-full min-h-0 overflow-y-auto">
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
                  onTransferTableAccount={handleTransferTableAccount}
                  transferableZones={getActiveBranchTransferContext().zones}
                  onQuickTakeaway={handleQuickTakeaway}
                  openZoneManagerRequest={guideOpenZonesRequest}
                  onZoneManagerRequestHandled={() => setGuideOpenZonesRequest(0)}
                  openCreateTableRequest={guideOpenTableRequest}
                  onCreateTableRequestHandled={() => setGuideOpenTableRequest(0)}
                  activeShiftZone={cashShiftService.getActiveShift()?.linkedZone}
                  activeShiftZones={cashShiftService.getActiveShift()?.linkedZones}
                  hasActiveShift={Boolean(cashShiftService.getActiveShift())}
                  onOpenCashShift={(zone) => handleOpenCashShift('status', zone)}
                  onNotify={addNotification}
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
                openAiImportRequest={guideOpenMenuImportRequest}
                onAiImportRequestHandled={() => setGuideOpenMenuImportRequest(0)}
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
          Sistema diseñado por Maikol Matamoros <span className="mx-1.5" aria-hidden="true">·</span>
          <span>v{import.meta.env.VITE_APP_VERSION} · build <code className="font-mono">{import.meta.env.VITE_APP_BUILD}</code></span>
        </footer>
      </div>

      {/* Unified Modals & Overlays wrapped in Suspense for Lazy Loading */}
      <Suspense fallback={null}>
        {/* Unified Settings & Tools Modal */}
        <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialSection={settingsInitialSection}
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
        key={tenant.id}
        isOpen={isOfflineModalOpen}
        onClose={() => setIsOfflineModalOpen(false)}
        tenantId={tenant.id}
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
        isOpen={isStaffModalOpen && currentUser?.role === 'ADMIN'}
        onClose={() => setIsStaffModalOpen(false)}
        currentUser={currentUser}
        currentTenant={tenant}
        staffList={staffList}
        onAddStaffMember={handleAddStaffMember}
        onResetStaffPin={handleResetStaffPin}
        onSelectUser={handleSelectUser}
        onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
      />

      <ExecutiveOrderModal
        key={executiveModalSession}
        isOpen={isExecutiveOrderOpen}
        staffList={staffList}
        ownerUserId={getAccountUserId(currentUser?.id)}
        tenantId={tenant.id}
        currency={tenant.currency}
        isOnline={isOnline && localDB.isOnline()}
        initialView={executiveOrderInitialView}
        onClose={() => setIsExecutiveOrderOpen(false)}
        onSelectEmployee={handleExecutiveOrder}
        onRecordPayment={handleEmployeeCreditPayment}
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
          setCashShiftInitialZone(undefined);
          setReturnToFloorAfterShiftOpen(false);
          handleUpdateShifts(cashShiftService.getAllActiveShiftsMap(), false);
        }}
        tenant={tenant}
        tables={tables}
        currentUser={currentUser}
        staffList={staffList}
        initialTab={cashShiftInitialTab}
        initialZone={cashShiftInitialZone}
        returnToFloorAfterOpen={returnToFloorAfterShiftOpen}
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
        key={tenant.id}
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        tenantId={tenant.id}
        menuItems={menuItems}
        selectedTable={selectedTableForOrder}
        zones={tenant.zones || []}
        onOpenLearningHub={() => setIsNyzaHubOpen(true)}
        onQuickAction={(action) => {
          try {
            const parsedCommand = JSON.parse(action);
            const validation = validateNyzaAction(parsedCommand, {
              tenantId: tenant.id,
              currentUser,
              menuItems,
              selectedTable: selectedTableForOrder,
              tables,
              zones: tenant.zones || []
            });
            if (!validation.ok) {
              addNotification({
                id: `nyza_blocked_${Date.now()}`,
                type: 'NEW_ORDER',
                title: 'Nyza no aplicó la acción',
                message: validation.reason,
                timestamp: new Date()
              });
              return;
            }
            const cmd = validation.command as Record<string, any>;
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
              }).catch((error: unknown) => {
                addNotification({
                  id: `nyza_ui_error_${Date.now()}`,
                  type: 'NEW_ORDER',
                  title: 'Nyza no aplicó la acción',
                  message: error instanceof Error ? error.message : 'No se pudo completar la acción de interfaz.',
                  timestamp: new Date()
                });
              });
              return;
            }
            if (cmd.type === 'OPEN_LEARNING_HUB' || cmd.type === 'NYZA_HUB') {
               setIsNyzaHubOpen(true);
            } else if (cmd.type === 'ADD_ITEM' && selectedTableForOrder && cmd.tableId === selectedTableForOrder.id) {
               // Product and modifier identities/prices were checked against the current menu.
               const item = menuItems.find(m => m.name === cmd.product);
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
                        quantity: cmd.quantity,
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
                   message: `Agregó ${cmd.quantity}x ${item.name} a la mesa ${selectedTableForOrder.name}`,
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
                 message: `Abrí la sección de reportes. Confirma allí el período ${cmd.range === 'week' ? 'semanal' : cmd.range === 'month' ? 'mensual' : 'de hoy'}; Nyza no consultó cifras.`,
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
                   seats: cmd.seats,
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
               const updated = menuItems.map(m =>
                 m.name === cmd.product
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
               const approvedTenantId = tenant.id;
               void runTenantBoundToolSequence(
                 approvedTenantId,
                 cmd.tool_calls,
                 () => activeTenantIdRef.current,
                 (tool, tenantId, isTenantActive) => nyzaSelfHealing.executeTool(
                   tool.name,
                   tenantId,
                   isTenantActive,
                   tool.parameters
                 ),
                 (tool, res) => {
                   addNotification({
                     id: 'nyza_' + Date.now() + '_' + Math.random(),
                     type: res.status === 'OK' ? 'ORDER_READY' : 'NEW_ORDER',
                     title: 'Nyza: ' + tool.name,
                     message: res.message,
                     timestamp: new Date()
                   });
                 }
               ).then(status => {
                 if (status === 'CANCELLED') {
                   addNotification({
                     id: `nyza_cancelled_${Date.now()}`,
                     type: 'NEW_ORDER',
                     title: 'Nyza canceló los pasos restantes',
                     message: 'Cambió el restaurante activo durante la ejecución. No se ejecutaron más herramientas; vuelve a solicitar la acción en el negocio actual.',
                     timestamp: new Date()
                   });
                 }
               }).catch((error: unknown) => {
                 if (activeTenantIdRef.current !== approvedTenantId) return;
                 addNotification({
                   id: `nyza_tool_error_${Date.now()}`,
                   type: 'NEW_ORDER',
                   title: 'Nyza no pudo completar la herramienta',
                   message: error instanceof Error ? error.message : 'La herramienta no terminó correctamente.',
                   timestamp: new Date()
                 });
               });
            }
          } catch(e) {
            const reason = e instanceof Error ? e.message : 'La solicitud no tenía un formato válido.';
            addNotification({
              id: `nyza_invalid_${Date.now()}`,
              type: 'NEW_ORDER',
              title: 'Nyza no aplicó la acción',
              message: reason,
              timestamp: new Date()
            });
          }
        }}
      />

      {/* Nyza Autonomous Continuous Learning & Global Intelligence Hub */}
      <NyzaLearningHub
        isOpen={isNyzaHubOpen}
        onClose={() => setIsNyzaHubOpen(false)}
        tenant={tenant}
        onOpenCopilot={() => {
          setIsNyzaHubOpen(false);
          setIsCopilotOpen(true);
        }}
      />
      </Suspense>

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
