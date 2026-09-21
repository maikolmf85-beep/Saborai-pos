import { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { TableMap } from './components/TableMap';
import { OrderTaking } from './components/OrderTaking';
import { KDSView } from './components/KDSView';
import { BillingHacienda } from './components/BillingHacienda';
import { SettingsModal } from './components/SettingsModal';
import { OfflineSyncModal } from './components/OfflineSyncModal';
import { NotionModal } from './components/NotionModal';
import { StaffModal } from './components/StaffModal';
import { QuickWaiterSwitchModal } from './components/QuickWaiterSwitchModal';
import { CashShiftModal } from './components/CashShiftModal';
import { ZReportModal } from './components/ZReportModal';
import { HaciendaHistoryModal } from './components/HaciendaHistoryModal';
import { cashShiftService } from './services/cashShiftService';
import { ZReportData, ConsolidatedZReportData } from './types/cashShift';
import { AICopilotChat } from './components/AICopilotChat';
import { AuthScreen } from './components/AuthScreen';
import { NysaOnboarding } from './components/NysaOnboarding';
import { SuperAdminBackoffice } from './components/SuperAdminBackoffice';
import { MenuEditor } from './components/MenuEditor';
import { WelcomeGate, SaboraiSubscription } from './components/WelcomeGate';
import { initialTenant, initialTables, sampleMenuItems } from './data/mockData';
import { Table, TenantInfo, SubscriptionPlan, SubscriptionStatus, UserProfile, MenuItem, KDSOrder } from './types';
import { localDB } from './services/db';
import { soundService } from './services/soundEffects';
import { NotificationToastContainer, PosNotification } from './components/NotificationToast';
import { Sparkles, WifiOff, Lock, Eye } from 'lucide-react';

export function App() {
  // Authentication & Session state
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      // Legacy fallback + initial state
      const saved = localStorage.getItem('saborai_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
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
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...initialTenant,
          ...parsed,
          taxRegime: parsed.taxRegime || 'TRADITIONAL',
          includeService10ByDefault: parsed.includeService10ByDefault ?? true
        };
      }
      return initialTenant;
    } catch {
      return initialTenant;
    }
  });

  const handleUpdateTenant = (updated: TenantInfo) => {
    setTenant(updated);
    try {
      localStorage.setItem('saborai_tenant', JSON.stringify(updated));
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

  const handleUpdateKdsOrder = (orderId: string, status: KDSOrder['status']) => {
    setKdsOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
  };

  const handleToggleKdsItem = (orderId: string, itemId: string) => {
    setKdsOrders(prev => prev.map(order => {
      if (order.id !== orderId) return order;
      const updatedItems = order.items.map(it => it.id === itemId ? { ...it, completed: !it.completed } : it);
      const allCompleted = updatedItems.length > 0 && updatedItems.every(it => it.completed);
      let nextStatus = order.status;
      if (allCompleted && order.status !== 'READY' && order.status !== 'SERVED') {
        nextStatus = 'READY';
      }
      return { ...order, items: updatedItems, status: nextStatus };
    }));
  };

  // JWT Token validation on load
  useEffect(() => {
    const validateSession = async () => {
      const token = localStorage.getItem('saborai_token');
      if (!token) {
        setIsLoadingAuth(false);
        // If there's legacy user data, clear it since we moved to backend
        if (localStorage.getItem('saborai_user')) {
           setCurrentUser(null);
           setSubscription(null);
           localStorage.removeItem('saborai_user');
        }
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
          const user: UserProfile = {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            phone: data.user.phone,
            restaurantName: data.user.restaurant_name,
            role: data.user.role,
            active: data.user.active
          };
          const tenantObj: TenantInfo = {
            id: data.tenant.id,
            name: data.tenant.name,
            cedulaJuridica: data.tenant.cedula_juridica || '3-101-998877',
            email: data.tenant.email,
            phone: data.tenant.phone,
            location: data.tenant.location || 'Costa Rica',
            plan: data.tenant.plan,
            status: data.tenant.status,
            currency: data.tenant.currency,
            monthlyFee: data.tenant.monthly_fee || 45000
          };
          const sub: SaboraiSubscription = { 
            mode: data.subscription?.mode === 'TRIAL' ? 'TRIAL' : 'ACTIVE', 
            email: user.email, 
            activatedAt: data.subscription?.activated_at || new Date().toISOString(),
            trialEndsAt: data.subscription?.trial_ends_at
          };
          
          setCurrentUser(user);
          setTenant(tenantObj);
          setSubscription(sub);
        } else {
          // Token invalid or expired
          localStorage.removeItem('saborai_token');
          setCurrentUser(null);
          setSubscription(null);
        }
      } catch (err) {
        console.error('Failed to validate session', err);
      } finally {
        setIsLoadingAuth(false);
      }
    };

    if (appDomain === 'POS') {
      validateSession();
    } else {
      setIsLoadingAuth(false);
    }
  }, [appDomain]);

  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  
  // Menu Catalog State
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => {
    try {
      const saved = localStorage.getItem('saborai_menu');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return sampleMenuItems;
  });

  const handleUpdateMenu = (updatedMenu: MenuItem[]) => {
    setMenuItems(updatedMenu);
    try {
      localStorage.setItem('saborai_menu', JSON.stringify(updatedMenu));
    } catch {}
  };

  const [tables, setTables] = useState<Table[]>(() => {
    try {
      const saved = localStorage.getItem('saborai_tables');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return initialTables;
  });

  const handleUpdateTables = (updatedTables: Table[]) => {
    setTables(updatedTables);
    try {
      localStorage.setItem('saborai_tables', JSON.stringify(updatedTables));
    } catch {}
  };
  const [selectedTableForOrder, setSelectedTableForOrder] = useState<Table | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const [isCashShiftModalOpen, setIsCashShiftModalOpen] = useState(false);
  const [cashShiftInitialTab, setCashShiftInitialTab] = useState<'status' | 'movements' | 'close' | 'history' | 'registers'>('status');
  const [activeZReport, setActiveZReport] = useState<ZReportData | null>(null);
  const [activeConsolidatedZReport, setActiveConsolidatedZReport] = useState<ConsolidatedZReportData | null>(null);
  const [isZReportModalOpen, setIsZReportModalOpen] = useState(false);
  const [isHaciendaHistoryOpen, setIsHaciendaHistoryOpen] = useState(false);

  const handleOpenCashShift = (tab: 'status' | 'movements' | 'close' | 'history' | 'registers' = 'status') => {
    setCashShiftInitialTab(tab);
    setIsCashShiftModalOpen(true);
  };

  // Staff & Collaborators state (4 Roles: Admin, Salonero, Cajero, Salonero c/ Caja)
  const [staffList, setStaffList] = useState<UserProfile[]>(() => {
    try {
      const saved = localStorage.getItem('saborai_staff');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}

    return [];
  });

  const handleAddStaffMember = (newMember: UserProfile) => {
    const updated = [newMember, ...staffList];
    setStaffList(updated);
    try {
      localStorage.setItem('saborai_staff', JSON.stringify(updated));
    } catch {}
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
    setCurrentUser(user);
    setTenant(loggedTenant);
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
        try { localStorage.setItem('saborai_staff', JSON.stringify(next)); } catch {}
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
    const updatedTenant: TenantInfo = {
      ...tenant,
      plan: plan,
      status: 'ACTIVE',
      monthlyFee: plan === 'express' ? 22000 : plan === 'pro' ? 45000 : 85000
    };
    setTenant(updatedTenant);
    try {
      localStorage.setItem('saborai_tenant', JSON.stringify(updatedTenant));
    } catch {}
    // Save subscription from landing page checkout
    if (!subscription) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      const sub: SaboraiSubscription = {
        mode: 'TRIAL',
        plan,
        trialEndsAt: trialEnd.toISOString(),
        activatedAt: new Date().toISOString(),
      };
      try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
      setSubscription(sub);
    }
    setActiveTab('pos');
  };

  const handleSelectTable = (table: Table) => {
    setSelectedTableForOrder(table);
  };

  const handleOpenOrder = (table: Table) => {
    setSelectedTableForOrder(table);
  };

  const handleSplitBill = (table: Table) => {
    setSelectedTableForOrder(table);
    setActiveTab('billing');
  };

  const handleSaveOrder = (updatedTable: Table) => {
    // 1. Process new items for KDS
    if (updatedTable.activeOrder) {
      const newKitchenItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && (i.category === 'Cocina' || !i.category));
      const newBarItems = updatedTable.activeOrder.items.filter(i => !i.kdsStatus && i.category === 'Bar');

      const timestamp = new Date();
      const serverName = updatedTable.activeOrder.server || 'Mesero';
      
      const newKdsOrders: KDSOrder[] = [];

      if (newKitchenItems.length > 0) {
        const orderId = `kds_c_${Date.now()}`;
        newKitchenItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; });
        newKdsOrders.push({
          id: orderId,
          tableNumber: updatedTable.number,
          tableName: updatedTable.name,
          server: serverName,
          timestamp,
          status: 'PENDING',
          station: 'Cocina',
          items: newKitchenItems.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, notes: i.notes, completed: false }))
        });
      }

      if (newBarItems.length > 0) {
        const orderId = `kds_b_${Date.now()}`;
        newBarItems.forEach(i => { i.kdsStatus = 'PENDING'; i.kdsOrderId = orderId; });
        newKdsOrders.push({
          id: orderId,
          tableNumber: updatedTable.number,
          tableName: updatedTable.name,
          server: serverName,
          timestamp,
          status: 'PENDING',
          station: 'Bar',
          items: newBarItems.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, notes: i.notes, completed: false }))
        });
      }

      if (newKdsOrders.length > 0) {
        setKdsOrders(prev => [...prev, ...newKdsOrders]);
      }
    }

    // 2. Save table state
    handleUpdateTables(tables.map(t => t.id === updatedTable.id ? updatedTable : t));
    setSelectedTableForOrder(updatedTable);

    // Save locally in IndexedDB
    localDB.saveItem('tables', updatedTable);

    // If offline, enqueue for cloud sync
    if (!isOnline) {
      localDB.enqueueOfflineAction(
        'UPDATE_TABLE',
        updatedTable,
        `Comanda actualizada en ${updatedTable.name} (${updatedTable.activeOrder?.orderNumber || 'pedido'})`
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
    // sync handled by localDB
  };

  // If LANDING domain, completely bypass auth and POS UI
  if (appDomain === 'LANDING') {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-[#fafaf9]">
        <LandingPage 
          onStartDemo={handleStartDemo} 
          onEnterPOS={() => {
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
              setAppDomain('POS'); // Local dev override
            } else {
              window.location.href = 'https://pos.saborai.site';
            }
          }}
        />
      </div>
    );
  }

  // If ADMIN domain, completely bypass auth and POS UI (can add its own auth later)
  if (appDomain === 'ADMIN') {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <SuperAdminBackoffice 
          currentTenant={tenant}
          onSelectTenant={(t) => handleUpdateTenant(t)}
          onOpenNotion={() => setIsNotionModalOpen(true)}
        />
      </div>
    );
  }

  // Subscription gate — only for POS domain
  const isTrialExpired = subscription?.mode === 'TRIAL' && subscription.trialEndsAt
    ? new Date(subscription.trialEndsAt) < new Date()
    : false;

  if (!subscription && !skipSubscriptionGate) {
    return (
      <WelcomeGate
        onSubscriptionActivated={(sub, user, tenant) => {
          try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
          setSubscription(sub);
          handleLoginSuccess(user, tenant);
        }}
      />
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
      <WelcomeGate
        onSubscriptionActivated={(sub, user, tenantData) => {
          try { localStorage.setItem('saborai_subscription', JSON.stringify(sub)); } catch {}
          setSubscription(sub);
          handleLoginSuccess(user, tenantData);
        }}
      />
    );
  }

  if (!tenant.onboardingCompleted) {
    return (
      <NysaOnboarding
        tenant={tenant}
        currentUser={currentUser}
        onComplete={(updatedTenant, newStaff, newMenu) => {
          handleUpdateTenant(updatedTenant);
          if (newStaff.length > 0) {
            newStaff.forEach(handleAddStaffMember);
          }
          if (newMenu.length > 0) {
            handleUpdateMenu(newMenu);
          }
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#fafaf9] text-stone-900 flex flex-row font-sans selection:bg-[#a9b994]/30">
      
      {/* Minimalist Vertical Sidebar Navbar */}
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
        onOpenStaffModal={() => setIsStaffModalOpen(true)}
        onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
        onOpenCashShift={(tab) => handleOpenCashShift(tab || 'status')}
        isShiftOpen={!!cashShiftService.getActiveShift()}
        activeRegisterName={cashShiftService.getCurrentRegister().name}
      />

      {/* Spacer to push content because Navbar is absolute and overlays on hover */}
      <div className="w-16 sm:w-[68px] h-full shrink-0 z-0 bg-stone-950/20 block"></div>

      {/* Main Workspace Container */}
      <div className="flex-1 h-full min-w-0 flex flex-col overflow-hidden relative">
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
            />
          )
        )}

        {/* Cocina & Bar (KDS) */}
        {activeTab === 'kds' && (
          <KDSView 
            orders={kdsOrders}
            onUpdateStatus={handleUpdateKdsOrder}
            onToggleItemCompletion={handleToggleKdsItem}
            onNotify={addNotification} 
          />
        )}

        {/* Catálogo de Menú */}
        {activeTab === 'menu' && currentUser.role === 'ADMIN' && (
          <MenuEditor 
            menuItems={menuItems} 
            onUpdateMenu={handleUpdateMenu} 
            taxRegime={tenant.taxRegime || 'TRADITIONAL'}
          />
        )}

        {/* Caja & Facturación Electrónica CR v4.3 */}
        {activeTab === 'billing' && (
          <BillingHacienda
            tenant={tenant}
            selectedTable={selectedTableForOrder || tables[0]}
            onSaveTable={handleSaveOrder}
            onNotify={addNotification}
            onOpenCashShift={(tab) => {
              setCashShiftInitialTab(tab || 'status');
              setIsCashShiftModalOpen(true);
            }}
            onOpenHaciendaHistory={() => setIsHaciendaHistoryOpen(true)}
          />
        )}
      </main>
    </div>

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
        onClose={() => setIsCashShiftModalOpen(false)}
        tenant={tenant}
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

      {/* Floating Saborai Copilot IA Button */}
      <div className="fixed bottom-6 right-6 z-40">
        {!isCopilotOpen && (
          <button
            onClick={() => setIsCopilotOpen(true)}
            className="group flex items-center gap-2 px-4 py-3 bg-stone-900 text-white rounded-full shadow-xl hover:bg-stone-800 hover:scale-105 active:scale-95 transition-all duration-200 border border-stone-800"
            title="Abrir Asistente Copilot IA"
          >
            <Sparkles className="w-4 h-4 text-[#a9b994]" />
            <span className="text-xs font-bold">Copilot IA</span>
          </button>
        )}
      </div>

      {/* Copilot Chat Drawer */}
      <AICopilotChat
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        currentUser={currentUser}
      />

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
