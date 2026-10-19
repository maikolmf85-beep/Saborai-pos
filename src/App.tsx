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
import { cashShiftService } from './services/cashShiftService';
import { ZReportData, ConsolidatedZReportData } from './types/cashShift';
import { SaboraiSubscription } from './components/WelcomeGate';
import { initialTenant, initialTables, sampleMenuItems } from './data/mockData';
import { Table, TenantInfo, SubscriptionPlan, SubscriptionStatus, UserProfile, MenuItem, KDSOrder } from './types';
import { localDB } from './services/db';
import { soundService } from './services/soundEffects';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { NotificationToastContainer, PosNotification } from './components/NotificationToast';
import { nyzaSelfHealing } from './services/nyzaSelfHealingService';
import { getTenantItem, hasTenantItem, migrateLegacyDataToTenant, setActiveTenantId, setTenantItem, startCleanDemoSession } from './services/tenantStorage';
import { Sparkles, WifiOff, Lock, Eye, BrainCircuit, ChefHat } from 'lucide-react';

function getTenantProfileWithLegacyFallback(tenantId: string): TenantInfo | null {
  const scopedTenant = getTenantItem<TenantInfo>('tenant_profile', tenantId);
  if (scopedTenant) return scopedTenant;

  // Compatibilidad con sesiones anteriores: antes de esta reparación el
  // tenant completo se guardaba solamente en saborai_tenant.
  try {
    const rawTenant = localStorage.getItem('saborai_tenant');
    const legacyTenant = rawTenant ? JSON.parse(rawTenant) as TenantInfo : null;
    return legacyTenant && String(legacyTenant.id) === String(tenantId) ? legacyTenant : null;
  } catch {
    return null;
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
    return {
      id: 'usr_matamoros_admin',
      name: 'Maikol Matamoros',
      email: 'matamoros.maikol85@gmail.com',
      role: 'ADMIN',
      restaurantName: 'SaborAI POS',
      active: true,
      pin: '1234'
    };
  });

  const [subscription, setSubscription] = useState<SaboraiSubscription | null>(() => {
    try {
      const saved = localStorage.getItem('saborai_subscription');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [skipSubscriptionGate, setSkipSubscriptionGate] = useState(false);

  const [tenant, setTenant] = useState<TenantInfo>(() => {
    try {
      const saved = localStorage.getItem('saborai_tenant');
      const savedHaciendaConfig = getTenantItem<any>('hacienda_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...initialTenant,
          ...parsed,
          taxRegime: parsed.taxRegime || 'TRADITIONAL',
          includeService10ByDefault: parsed.includeService10ByDefault ?? true,
          haciendaConfig: { ...(parsed.haciendaConfig || {}), ...(savedHaciendaConfig || {}) }
        };
      }
      return { ...initialTenant, haciendaConfig: savedHaciendaConfig };
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
      if (updated.haciendaConfig) {
        setTenantItem('hacienda_config', updated.haciendaConfig, updated.id);
      }
    } catch {}
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
          setActiveTenantId(data.tenant.id);
          migrateLegacyDataToTenant(data.tenant.id);
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
            zones: savedTenant?.zones || [],
            menuCategories: savedTenant?.menuCategories || []
          };
          const sub: SaboraiSubscription = { 
            mode: data.subscription?.mode === 'TRIAL' ? 'TRIAL' : 'ACTIVE', 
            email: user.email, 
            activatedAt: data.subscription?.activated_at || new Date().toISOString(),
            trialEndsAt: data.subscription?.trial_ends_at
          };
          
          // Preservar el colaborador seleccionado actualmente (por ejemplo, Rafael) si ya existe en localStorage
          const savedActiveUserRaw = localStorage.getItem('saborai_user');
          let effectiveUser = user;
          if (savedActiveUserRaw) {
            try {
              const parsedSavedUser = JSON.parse(savedActiveUserRaw);
              if (parsedSavedUser && parsedSavedUser.name) {
                effectiveUser = parsedSavedUser;
              }
            } catch {}
          }

          setCurrentUser(effectiveUser);
          setTenant(tenantObj);
          setMenuItems(getTenantItem<MenuItem[]>('menu', tenantObj.id) || []);
          setTables(getTenantItem<Table[]>('tables', tenantObj.id) || []);
          setStaffList(getTenantItem<UserProfile[]>('staff', tenantObj.id) || [effectiveUser]);
          setSubscription(sub);
          try {
            localStorage.setItem('saborai_user', JSON.stringify(effectiveUser));
            localStorage.setItem('saborai_tenant', JSON.stringify(tenantObj));
            setTenantItem('tenant_profile', tenantObj, tenantObj.id);
          } catch {}
        } else {
          // Token invalid or expired
          localStorage.removeItem('saborai_token');
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
      if (Array.isArray(scoped)) return scoped;
    } catch {}
    return initialTables;
  });

  const handleUpdateTables = (updatedTables: Table[], skipBroadcast = false) => {
    setTables(updatedTables);
    if (!skipBroadcast) broadcastTables(updatedTables);
    try {
      setTenantItem('tables', updatedTables, tenant.id);
    } catch {}
  };

  const [shiftsVersion, setShiftsVersion] = useState(0);

  const handleUpdateShifts = (shiftsMap: any, skipBroadcast = false) => {
    cashShiftService.syncShiftsMap(shiftsMap);
    setShiftsVersion(v => v + 1);
    if (!skipBroadcast) broadcastShifts(shiftsMap);
  };

  const handleUpdateStaff = (newStaff: UserProfile[], skipBroadcast = false) => {
    setStaffList(newStaff);
    if (!skipBroadcast && broadcastStaffRef.current) {
      broadcastStaffRef.current(newStaff);
    }
    try {
      setTenantItem('staff', newStaff, tenant.id);
    } catch {}
  };

  // Realtime Sync Hook
  const { broadcastTables, broadcastKdsOrders, broadcastMenuItems, broadcastShifts, broadcastTenant, broadcastStaff } = useRealtimeSync(
    tenant.id,
    handleUpdateTables,
    setKdsOrders,
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
  }, [broadcastTenant, broadcastStaff]);
  const [selectedTableForOrder, setSelectedTableForOrder] = useState<Table | null>(null);
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

  const handleAddStaffMember = (newMember: UserProfile) => {
    const updated = [newMember, ...staffList];
    handleUpdateStaff(updated);
  };

  const handleSelectUser = (user: UserProfile) => {
    setCurrentUser(user);
    try {
      localStorage.setItem('saborai_user', JSON.stringify(user));
    } catch {}
  };

  const handleSwitchWaiter = (staff: UserProfile) => {
    handleSelectUser(staff);

    // If currently editing/taking order on a table, update server
    if (selectedTableForOrder && selectedTableForOrder.activeOrder) {
      const updatedTable: Table = {
        ...selectedTableForOrder,
        activeOrder: {
          ...selectedTableForOrder.activeOrder,
          server: staff.name
        }
      };
      handleSaveOrder(updatedTable);
    }

    addNotification({
      id: `switch_${Date.now()}`,
      type: 'ORDER_READY',
      title: 'Cambio de Turno Realizado',
      message: `El sistema ahora opera bajo el turno de ${staff.name}`,
      server: staff.name,
      timestamp: new Date()
    });
  };

  // Network & Sync state
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

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
    localDB.init();
    const unsubscribe = localDB.subscribe((online, pending) => {
      setIsOnline(online);
      setPendingSyncCount(pending);
    });
    return unsubscribe;
  }, []);

  const handleLoginSuccess = (user: UserProfile, loggedTenant: TenantInfo) => {
    // El endpoint de login devuelve la identidad del tenant, pero los ajustes
    // operativos (salones, categorías, régimen y Hacienda) pueden haber sido
    // guardados localmente por tenant. Restaurarlos aquí evita que el login
    // reemplace el tenant hidratado por uno sin salones.
    const savedTenant = getTenantProfileWithLegacyFallback(loggedTenant.id);
    const restoredTenant: TenantInfo = {
      ...loggedTenant,
      zones: savedTenant?.zones ?? loggedTenant.zones ?? [],
      menuCategories: savedTenant?.menuCategories ?? loggedTenant.menuCategories ?? [],
      taxRegime: savedTenant?.taxRegime ?? loggedTenant.taxRegime,
      includeService10ByDefault: savedTenant?.includeService10ByDefault ?? loggedTenant.includeService10ByDefault,
      haciendaConfig: savedTenant?.haciendaConfig ?? loggedTenant.haciendaConfig
    };

    setActiveTenantId(restoredTenant.id);
    migrateLegacyDataToTenant(restoredTenant.id);
    setCurrentUser(user);
    setTenant(restoredTenant);
    setMenuItems(getTenantItem<MenuItem[]>('menu', restoredTenant.id) || []);
    setTables(getTenantItem<Table[]>('tables', restoredTenant.id) || []);
    setStaffList(getTenantItem<UserProfile[]>('staff', restoredTenant.id) || [user]);
    try {
      localStorage.setItem('saborai_user', JSON.stringify(user));
      localStorage.setItem('saborai_tenant', JSON.stringify(restoredTenant));
      setTenantItem('tenant_profile', restoredTenant, restoredTenant.id);
    } catch {}
    // If logging in with existing account and no subscription record, treat as active
    if (!subscription) {
      const activeSub: SaboraiSubscription = { mode: 'ACTIVE', activatedAt: new Date().toISOString() };
      try { localStorage.setItem('saborai_subscription', JSON.stringify(activeSub)); } catch {}
      setSubscription(activeSub);
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
      localStorage.removeItem('saborai_user');
    } catch {}
    setCurrentUser(null);
  };

  const handleStartDemo = (plan: SubscriptionPlan) => {
    const demoTenantId = `tenant_demo_${Date.now()}`;
    startCleanDemoSession(demoTenantId);
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
    try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
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

  const handleSelectTable = (table: Table) => {
    setSelectedTableForOrder(table);
  };

  const handleOpenOrder = (table: Table) => {
    setSelectedTableForOrder(table);
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
        const orderId = `kds_c_${Date.now()}`;
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
        const orderId = `kds_b_${Date.now()}`;
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
      } else {
        setSelectedTableForOrder(updatedTable);
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

    // If offline, enqueue for cloud sync
    if (!isOnline && updatedTable) {
      localDB.enqueueOfflineAction(
        'UPDATE_TABLE',
        updatedTable,
        `Comanda actualizada en ${updatedTable.name || 'Mesa'} (${updatedTable.activeOrder?.orderNumber || 'pedido'})`
      );
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

  const handleSyncComplete = (_syncedCount: number) => {
    // Re-broadcast all state to ensure other devices get the offline changes
    broadcastTables(tables);
    broadcastKdsOrders(kdsOrders);
    broadcastShifts(cashShiftService.getAllActiveShiftsMap());
    
    addNotification({
      id: `sync_p2p_${Date.now()}`,
      type: 'HACIENDA_UPDATE',
      title: 'Sincronización P2P Completada',
      message: 'Las comandas creadas offline han sido enviadas a Cocina y Bar.',
      timestamp: new Date()
    });
  };

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
            try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
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
            try { localStorage.removeItem('saborai_subscription'); } catch {}
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
            try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
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
    <div className="h-screen w-screen overflow-hidden bg-[#fafaf9] text-stone-900 flex flex-col sm:flex-row font-sans selection:bg-[#a9b994]/30">
      
      <GuidedTour />
      
      {/* Navbar: Bottom on mobile, Vertical on Desktop */}
      <Navbar
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
      <div className="hidden sm:block w-[68px] h-full shrink-0 z-0 bg-stone-950/20"></div>

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
                try { localStorage.removeItem('saborai_subscription'); } catch {}
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
                <strong>Modo Local Offline Activo:</strong> Sin conexión a Internet. El restaurante sigue operando con normalidad. Todas las comandas, cobros e impresión térmica están activos localmente y se sincronizarán al reconectar.
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
              !cashShiftService.getActiveShift() ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-stone-50 animate-in fade-in duration-300">
                  <div className="w-24 h-24 bg-stone-200/50 rounded-full flex items-center justify-center mb-6">
                    <Lock className="w-12 h-12 text-stone-400" />
                  </div>
                  <h2 className="text-3xl font-black text-stone-800 mb-3 tracking-tight">Turno de Caja Cerrado</h2>
                  <p className="text-stone-500 max-w-md mx-auto mb-8 text-lg">
                    Es obligatorio abrir un turno de caja para poder comandar productos o tomar órdenes en las mesas.
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
                  staffList={staffList}
                  tenant={tenant}
                  onUpdateTenant={handleUpdateTenant}
                  onUpdateTables={handleUpdateTables}
                  onQuickTakeaway={handleQuickTakeaway}
                  activeShiftZone={cashShiftService.getActiveShift()?.linkedZone}
                  activeShiftZones={cashShiftService.getActiveShift()?.linkedZones}
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
                selectedTable={selectedTableForOrder || tables.find(t => t.status === 'OCCUPIED' || t.status === 'PRE_CHECK') || tables[0] || null}
                onSaveTable={handleSaveOrder}
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
      </div>

      {/* Unified Modals & Overlays wrapped in Suspense for Lazy Loading */}
      <Suspense fallback={null}>
        {/* Unified Settings & Tools Modal */}
        <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tenant={tenant}
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
        onSyncComplete={handleSyncComplete}
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
        onSwitchUser={handleSwitchWaiter}
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
        onOpenLearningHub={() => setIsNyzaHubOpen(true)}
        onQuickAction={(action) => {
          try {
            const cmd = JSON.parse(action);
            if (cmd.type === 'OPEN_LEARNING_HUB' || cmd.type === 'NYZA_HUB') {
               setIsNyzaHubOpen(true);
            } else if (cmd.type === 'ADD_ITEM' && selectedTableForOrder) {
               // Find item
               const item = menuItems.find(m => m.name.toLowerCase().includes((cmd.product || '').toLowerCase()));
               if (item) {
                 const existingItems = selectedTableForOrder.activeOrder?.items ? [...selectedTableForOrder.activeOrder.items] : [];
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
                        price: item.price,
                        notes: 'Agregado por Nysa IA',
                        cabysCode: item.cabysCode,
                        taxRate: item.taxRate,
                        category: item.station === 'Bar' ? 'Bar' : 'Cocina'
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

    </div>
  );
}

export default App;
