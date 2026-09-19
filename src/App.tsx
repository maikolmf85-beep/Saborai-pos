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
import { cashShiftService } from './services/cashShiftService';
import { ZReportData, ConsolidatedZReportData } from './types/cashShift';
import { AICopilotChat } from './components/AICopilotChat';
import { AuthScreen } from './components/AuthScreen';
import { initialTenant, initialTables, sampleMenuItems } from './data/mockData';
import { Table, TenantInfo, SubscriptionPlan, SubscriptionStatus, UserProfile } from './types';
import { localDB } from './services/db';
import { soundService } from './services/soundEffects';
import { NotificationToastContainer, PosNotification } from './components/NotificationToast';
import { Sparkles, WifiOff } from 'lucide-react';

export function App() {
  // Authentication & Session state
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('saborai_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

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

  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  const [tables, setTables] = useState<Table[]>(initialTables);
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

    return [
      {
        id: 'usr_admin_01',
        name: 'Carlos Administrador',
        email: 'carlos.gerencia@fuegopalmera.cr',
        phone: '+506 8888-1000',
        restaurantName: 'Restaurante Fuego & Palmera S.A.',
        role: 'ADMIN',
        active: true,
        pin: '1111'
      },
      {
        id: 'usr_salonero_01',
        name: 'Kevin Murillo (Salonero)',
        email: 'kevin.salon@fuegopalmera.cr',
        phone: '+506 8888-2000',
        restaurantName: 'Restaurante Fuego & Palmera S.A.',
        role: 'SALONERO',
        active: true,
        pin: '2222'
      },
      {
        id: 'usr_cajero_01',
        name: 'Laura Mora (Cajera)',
        email: 'laura.caja@fuegopalmera.cr',
        phone: '+506 8888-3000',
        restaurantName: 'Restaurante Fuego & Palmera S.A.',
        role: 'CAJERO',
        active: true,
        pin: '3333'
      },
      {
        id: 'usr_salonero_caja_01',
        name: 'Esteban Rojas (Salonero c/ Caja)',
        email: 'esteban.dual@fuegopalmera.cr',
        phone: '+506 8888-4000',
        restaurantName: 'Restaurante Fuego & Palmera S.A.',
        role: 'SALONERO_CAJA',
        active: true,
        pin: '4444'
      }
    ];
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
    setTables(tables.map(t => t.id === updatedTable.id ? updatedTable : t));
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

  // If not authenticated, require login or registration
  if (!currentUser) {
    return (
      <>
        <AuthScreen 
          onLoginSuccess={handleLoginSuccess} 
          onOpenNotion={() => setIsNotionModalOpen(true)} 
        />
        <NotionModal
          isOpen={isNotionModalOpen}
          onClose={() => setIsNotionModalOpen(false)}
          currentUser={currentUser}
          currentTenant={tenant}
        />
      </>
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

      {/* Main Workspace Container */}
      <div className="flex-1 h-full min-w-0 flex flex-col overflow-hidden relative">
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
        
        {/* Landing Page (Public / Onboarding) */}
        {activeTab === 'landing' && (
          <LandingPage 
            onStartDemo={handleStartDemo} 
            onEnterPOS={() => setActiveTab('pos')}
          />
        )}

        {/* Punto de Venta: Mesas o Tomapedidos integrado */}
        {activeTab === 'pos' && (
          selectedTableForOrder ? (
            <OrderTaking
              table={selectedTableForOrder}
              tenant={tenant}
              menuItems={sampleMenuItems}
              onSaveOrder={handleSaveOrder}
              onBackToTables={() => setSelectedTableForOrder(null)}
              onDirectInvoice={() => setActiveTab('billing')}
              onNotify={addNotification}
              userRole={currentUser.role}
              onOpenQuickSwitch={() => setIsQuickSwitchOpen(true)}
            />
          ) : (
            <TableMap
              tables={tables}
              onSelectTable={handleSelectTable}
              onOpenOrder={handleOpenOrder}
              onSplitBill={handleSplitBill}
              isAdmin={currentUser.role === 'ADMIN'}
              staffList={staffList}
            />
          )
        )}

        {/* Cocina & Bar (KDS) */}
        {activeTab === 'kds' && (
          <KDSView onNotify={addNotification} />
        )}

        {/* Caja & Facturación Electrónica CR v4.3 */}
        {activeTab === 'billing' && (
          <BillingHacienda
            tenant={tenant}
            selectedTable={selectedTableForOrder || tables[0]}
            onEmitInvoice={() => {}}
            onSaveTable={handleSaveOrder}
            onOpenCashShift={(tab) => handleOpenCashShift(tab || 'status')}
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
