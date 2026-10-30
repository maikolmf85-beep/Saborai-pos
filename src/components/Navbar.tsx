import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  LayoutGrid, 
  ChefHat, 
  Receipt,
  UtensilsCrossed, 
  Settings as SettingsIcon, 
  Sparkles, 
  Wifi, 
  WifiOff, 
  LogOut, 
  Volume2, 
  VolumeX, 
  Users,
  Building2,
  TrendingUp,
  BrainCircuit,
  ShoppingBag,
  BriefcaseBusiness,
  History,
  Calculator,
  Menu,
  X,
} from 'lucide-react';
import { TenantInfo, UserProfile } from '../types';

export type ActiveTab = 'pos' | 'kds' | 'billing' | 'landing' | 'menu' | 'reports';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isSidebarCollapsed: boolean;
  onToggleSidebar: (collapsed: boolean) => void;
  tenant: TenantInfo;
  user: UserProfile | null;
  onLogout: () => void;
  isOnline: boolean;
  pendingCount: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onOpenCopilot: () => void;
  onOpenNyzaHub?: () => void;
  onOpenSettings: () => void;
  onOpenOfflineModal: () => void;
  onOpenStaffModal?: () => void;
  onOpenQuickSwitch?: () => void;
  onOpenCashShift?: (initialTab?: 'status' | 'close') => void;
  onQuickTakeaway?: () => void;
  onOpenExecutiveOrder?: () => void;
  onOpenEmployeeCreditLedger?: () => void;
  isShiftOpen?: boolean;
  activeRegisterName?: string;
}

interface NavItemProps {
  id?: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  badge?: React.ReactNode;
  isActive?: boolean;
  variant?: 'default' | 'accent' | 'warning' | 'danger' | 'success';
  className?: string;
  collapsed?: boolean;
}

const NavVerticalItem: React.FC<NavItemProps> = ({
  id,
  onClick,
  icon,
  label,
  sublabel,
  badge,
  isActive = false,
  variant = 'default',
  className = '',
  collapsed = false
}) => {
  let styleClasses = 'text-[#fcfeff]/65 hover:text-[#fcfeff] hover:bg-white/[0.06]';

  if (isActive) {
    styleClasses = 'bg-white/[0.10] text-[#fcfeff] font-bold border border-white/[0.08] shadow-sm';
  } else if (variant === 'warning') {
    styleClasses = 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 hover:text-amber-300';
  } else if (variant === 'danger') {
    styleClasses = 'text-rose-400 hover:text-white hover:bg-rose-600/90 hover:border-rose-500';
  } else if (variant === 'success') {
    styleClasses = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 hover:text-emerald-300';
  } else if (variant === 'accent') {
    styleClasses = 'bg-[#a9b994]/20 text-[#a9b994] border border-[#a9b994]/40 hover:bg-[#a9b994]/30 hover:text-white';
  }

  return (
    <div className="relative flex items-center justify-center sm:justify-start w-auto sm:w-full my-0 sm:my-0.5 px-0 sm:px-2">
      <button
        id={id}
        type="button"
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={`w-12 h-12 sm:min-h-11 sm:w-full sm:min-w-0 rounded-full sm:rounded-2xl flex items-center justify-center ${collapsed ? 'sm:px-0 sm:justify-center' : 'sm:px-2.5 sm:justify-start'} transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a9b994] focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none cursor-pointer ${styleClasses} ${className}`}
        title={label}
      >
        <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
          {icon}
          {badge}
        </div>
        
        <div className={`hidden sm:flex min-w-0 flex-col items-start overflow-hidden whitespace-nowrap transition-[width,margin,opacity] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] delay-75 motion-reduce:transition-none ${collapsed ? 'ml-0 opacity-0 w-0' : 'ml-3 opacity-100 w-44'}`}>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold">{label}</span>
            {isActive && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white text-[#a9b994] font-black uppercase shadow-sm">
                Activo
              </span>
            )}
          </div>
          {sublabel && (
            <span className="text-[10px] text-stone-400 mt-0.5 block truncate w-full text-left">
              {sublabel}
            </span>
          )}
        </div>
      </button>
    </div>
  );
};

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isSidebarCollapsed,
  onToggleSidebar,
  tenant,
  user,
  onLogout,
  isOnline,
  pendingCount,
  isMuted,
  onToggleMute,
  onOpenCopilot,
  onOpenNyzaHub,
  onOpenSettings,
  onOpenOfflineModal,
  onOpenStaffModal,
  onOpenQuickSwitch,
  onOpenCashShift,
  onQuickTakeaway,
  onOpenExecutiveOrder,
  onOpenEmployeeCreditLedger,
  isShiftOpen,
  activeRegisterName
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleMobileNavClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* ======================================================== */}
      {/* 1. MÓVIL: BARRA INFERIOR COMPACTA + MENÚ DESPLEGABLE     */}
      {/* ======================================================== */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
        
        {/* Backdrop desenfocado cuando el menú desplegable está abierto */}
        {mobileMenuOpen && (
          <div 
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-stone-950/80 backdrop-blur-md z-40 animate-in fade-in duration-200"
          />
        )}

        {/* Panel Desplegable Flotante hacia arriba (Bottom Sheet) */}
        {mobileMenuOpen && (
          <div id="mobile-navigation-sheet" className="relative z-50 mx-3 mb-2 bg-black border border-zinc-800 rounded-3xl p-5 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-5 duration-300 max-h-[75vh] overflow-y-auto motion-reduce:animate-none">
            
            {/* Header del Menú Desplegable */}
            <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-stone-800">
              <div className="flex items-center gap-2.5">
                <BrandLogo variant="isotype" size="sm" className="brightness-0 invert" />
                <div>
                  <h3 className="font-black text-sm text-white">SaborAI POS</h3>
                  <p className="text-[11px] text-[#a9b994] font-medium truncate max-w-[170px]">{tenant.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="w-11 h-11 shrink-0 rounded-full bg-zinc-900 text-stone-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a9b994] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Módulos Operativos Adicionales */}
            <div className="space-y-1 mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-stone-500 px-2 block mb-1">
                Operaciones
              </span>

              {/* Para Llevar */}
              {onQuickTakeaway && (
                <button
                  type="button"
                  onClick={() => {
                    onQuickTakeaway();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full p-3 rounded-2xl bg-stone-950/60 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 flex items-center gap-3 text-left transition-all"
                >
                  <ShoppingBag className="w-5 h-5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-xs">Venta Rápida / Para Llevar</div>
                    <div className="text-[10px] text-stone-400">Comanda directa sin mesa</div>
                  </div>
                </button>
              )}

              {onOpenExecutiveOrder && ['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && (
                <button
                  type="button"
                  onClick={() => { onOpenExecutiveOrder(); setMobileMenuOpen(false); }}
                  className="w-full p-3 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/40 text-[#d9e5cf] hover:bg-[#a9b994]/25 flex items-center gap-3 text-left transition-all"
                >
                  <BriefcaseBusiness className="w-5 h-5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-xs">Comanda Ejecutiva</div>
                    <div className="text-[10px] text-stone-400">Crédito interno a trabajador</div>
                  </div>
                </button>
              )}

              {onOpenEmployeeCreditLedger && ['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && (
                <button
                  type="button"
                  onClick={() => { onOpenEmployeeCreditLedger(); setMobileMenuOpen(false); }}
                  className="w-full p-3 rounded-2xl bg-stone-950/60 border border-stone-800 text-stone-200 hover:border-emerald-500/40 hover:bg-stone-900 flex items-center gap-3 text-left transition-all"
                >
                  <History className="w-5 h-5 shrink-0 text-emerald-400" />
                  <div className="flex-1">
                    <div className="font-bold text-xs">Registro de consumo</div>
                    <div className="text-[10px] text-stone-400">Saldos por colaborador</div>
                  </div>
                </button>
              )}

              {/* Menú y Catálogo */}
              {user?.role === 'ADMIN' && (
                <button
                  type="button"
                  onClick={() => handleMobileNavClick('menu')}
                  className={`w-full p-3 rounded-2xl flex items-center gap-3 text-left transition-all ${
                    activeTab === 'menu'
                      ? 'bg-[#a9b994] text-stone-950 font-black'
                      : 'bg-stone-950/50 text-stone-300 hover:bg-stone-800/80 border border-stone-800'
                  }`}
                >
                  <UtensilsCrossed className="w-5 h-5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-xs">Platillos & Catálogo de Menú</div>
                    <div className={`text-[10px] ${activeTab === 'menu' ? 'text-stone-900' : 'text-stone-400'}`}>
                      Precios, recetas y disponibilidad
                    </div>
                  </div>
                </button>
              )}

              {/* Reportes y Estadísticas */}
              {['ADMIN', 'CAJERO'].includes(user?.role || '') && (
                <button
                  type="button"
                  onClick={() => handleMobileNavClick('reports')}
                  className={`w-full p-3 rounded-2xl flex items-center gap-3 text-left transition-all ${
                    activeTab === 'reports'
                      ? 'bg-[#a9b994] text-stone-950 font-black'
                      : 'bg-stone-950/50 text-stone-300 hover:bg-stone-800/80 border border-stone-800'
                  }`}
                >
                  <TrendingUp className="w-5 h-5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-xs">Métricas & Reportes</div>
                    <div className={`text-[10px] ${activeTab === 'reports' ? 'text-stone-900' : 'text-stone-400'}`}>
                      Ventas, cierres de caja y rendimiento
                    </div>
                  </div>
                </button>
              )}
            </div>

            {/* Turno de Caja y Usuario */}
            <div className="space-y-1 mb-4 pt-2 border-t border-stone-800/80">
              <span className="text-[10px] font-black uppercase tracking-widest text-stone-500 px-2 block mb-1">
                Caja y Personal
              </span>

              {/* Turno de Caja */}
              {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && onOpenCashShift && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenCashShift('status');
                    setMobileMenuOpen(false);
                  }}
                  className="relative w-full p-3 rounded-2xl bg-stone-950/60 border border-stone-800 hover:border-emerald-500/40 text-stone-200 flex items-center justify-between transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-stone-900 flex items-center justify-center text-emerald-400">
                      <Calculator className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <span>{isShiftOpen ? "Turno Abierto" : "Turno Cerrado"}</span>
                      </div>
                      <div className="text-[10px] text-stone-400">{activeRegisterName || 'Caja Principal'}</div>
                    </div>
                  </div>
                  <span
                    aria-label={isShiftOpen ? 'Turno activo' : 'Turno cerrado'}
                    title={isShiftOpen ? 'Turno activo' : 'Turno cerrado'}
                    className={`absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full ${isShiftOpen ? 'bg-emerald-400 animate-pulse shadow-[0_0_7px_rgba(52,211,153,0.8)]' : 'bg-amber-400'}`}
                  />
                  <span className="text-[10px] font-bold text-emerald-400 uppercase">Gestionar</span>
                </button>
              )}

              {/* Usuario / Cambio Rápido */}
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenQuickSwitch) onOpenQuickSwitch();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full p-2.5 rounded-2xl bg-stone-950/60 border border-stone-800 flex items-center justify-between text-left transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-stone-800 text-[#a9b994] font-black text-xs flex items-center justify-center border border-stone-700">
                      {user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-xs text-white">{user.name}</div>
                      <div className="text-[10px] text-stone-400">
                        {user.role === 'ADMIN' ? 'Administrador' : user.role === 'CAJERO' ? 'Cajero' : 'Salonero'} • PIN
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-stone-400">Cambiar</span>
                </button>
              )}

              {/* Equipo y Permisos */}
              {user?.role === 'ADMIN' && onOpenStaffModal && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenStaffModal();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full p-2.5 rounded-2xl hover:bg-stone-800/60 text-stone-300 flex items-center gap-2.5 text-xs font-bold transition-all"
                >
                  <Users className="w-4 h-4 text-stone-400" />
                  <span>Equipo de Trabajo & Permisos</span>
                </button>
              )}
            </div>

            {/* Accesos de Sistema, Ajustes y Copilot */}
            <div className="pt-2 border-t border-stone-800/80 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenCopilot();
                    setMobileMenuOpen(false);
                  }}
                  className="p-2.5 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/30 text-[#a9b994] font-bold text-xs flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Nyza IA</span>
                </button>

                {user?.role === 'ADMIN' && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSettings();
                      setMobileMenuOpen(false);
                    }}
                    className="p-2.5 rounded-2xl bg-stone-950 border border-stone-800 text-stone-300 font-bold text-xs flex items-center justify-center gap-2 hover:bg-stone-800"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span>Ajustes</span>
                  </button>
                )}
              </div>

              {/* Botón de Salir */}
              <button
                type="button"
                onClick={onLogout}
                className="w-full py-2.5 text-rose-400 hover:text-white hover:bg-rose-600/20 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar Sesión</span>
              </button>
            </div>

          </div>
        )}

        {/* Barra Inferior Fija Limpia (4 Botones con espacio ergonómico) */}
        <nav 
          aria-label="Barra de navegación móvil"
          className="min-h-16 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-black border-t border-zinc-800/90 px-2 sm:px-4 flex items-center justify-between shadow-[0_-8px_30px_rgba(0,0,0,0.6)]"
        >
          {/* 1. Mesas */}
          <button
            type="button"
            onClick={() => handleMobileNavClick('pos')}
            aria-current={activeTab === 'pos' ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-colors cursor-pointer ${
              activeTab === 'pos' ? 'text-[#a9b994]' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className={`p-1 rounded-xl transition-all ${activeTab === 'pos' ? 'bg-[#a9b994]/20 shadow-xs scale-105' : ''}`}>
              <LayoutGrid className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight mt-0.5">Mesas</span>
          </button>

          {/* 2. KDS Cocina */}
          <button
            type="button"
            onClick={() => handleMobileNavClick('kds')}
            aria-current={activeTab === 'kds' ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 relative transition-colors cursor-pointer ${
              activeTab === 'kds' ? 'text-[#a9b994]' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className={`p-1 rounded-xl transition-all ${activeTab === 'kds' ? 'bg-[#a9b994]/20 shadow-xs scale-105' : ''}`}>
              <ChefHat className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight mt-0.5">Cocina</span>
            {tenant.plan === 'express' && (
              <span className="absolute top-1 right-2 text-[8px] font-black bg-stone-800 text-amber-400 px-1 rounded-xs border border-amber-400/40">
                PRO
              </span>
            )}
          </button>

          {/* 3. Caja & Facturación */}
          <button
            type="button"
            onClick={() => handleMobileNavClick('billing')}
            aria-current={activeTab === 'billing' ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-colors cursor-pointer ${
              activeTab === 'billing' ? 'text-[#a9b994]' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className={`p-1 rounded-xl transition-all ${activeTab === 'billing' ? 'bg-[#a9b994]/20 shadow-xs scale-105' : ''}`}>
              <Receipt className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight mt-0.5">Caja</span>
          </button>

          {/* 4. Menú Desplegable (Más módulos) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-sheet"
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-colors cursor-pointer ${
              mobileMenuOpen ? 'text-[#a9b994]' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className={`p-1 rounded-xl transition-all ${mobileMenuOpen ? 'bg-[#a9b994]/20 scale-105' : ''}`}>
              {mobileMenuOpen ? <X className="w-5 h-5 text-[#a9b994]" /> : <Menu className="w-5 h-5" />}
            </div>
            <span className="text-[10px] font-bold tracking-tight mt-0.5">
              {mobileMenuOpen ? 'Cerrar' : 'Más'}
            </span>
          </button>
        </nav>
      </div>

      {/* ======================================================== */}
      {/* 2. ESCRITORIO / TABLET: SIDEBAR VERTICAL ORIGINAL        */}
      {/* ======================================================== */}
      <aside
        onMouseEnter={() => {
          if (isSidebarCollapsed) onToggleSidebar(false);
        }}
        onMouseLeave={() => {
          if (!isSidebarCollapsed) onToggleSidebar(true);
        }}
        className={`group/sidebar hidden sm:flex fixed sm:absolute top-0 left-0 ${isSidebarCollapsed ? 'w-[68px]' : 'w-[280px]'} h-screen bg-black text-[#fcfeff] flex-col justify-between items-start py-2 border-r border-white/10 shadow-[8px_0_32px_rgba(0,0,0,0.32)] z-50 overflow-y-auto overflow-x-hidden transition-[width,box-shadow,border-color] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none scrollbar-none`}
        aria-label="Navegación vertical SaborAI POS"
        data-sidebar-state={isSidebarCollapsed ? 'collapsed' : 'expanded'}
      >
        {/* Top Group: Brand Logo & Operational Modules */}
        <div className="w-full h-auto flex flex-col items-start gap-0">
          {/* Brand Isotype / Logo */}
          <div className="flex w-full items-center px-2 mb-2">
            <button
              type="button"
              onClick={() => setActiveTab('pos')}
              aria-label="Ir a Mesas y Salones"
              className={`h-12 min-w-0 w-full rounded-2xl flex items-center overflow-hidden ${isSidebarCollapsed ? 'justify-center px-0' : 'justify-start px-3'} bg-white/[0.03] border border-white/[0.08] hover:border-[#a9b994]/60 transition-[background-color,border-color,box-shadow] duration-200 cursor-pointer shadow-sm`}
              title="SaborAI POS"
            >
              <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                <BrandLogo variant="isotype" size="sm" className="brightness-0 invert" />
              </div>

              <div className={`min-w-0 flex flex-col items-start overflow-hidden whitespace-nowrap transition-[width,margin,opacity] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] delay-75 motion-reduce:transition-none ${isSidebarCollapsed ? 'ml-0 opacity-0 w-0' : 'ml-3 opacity-100 w-40'}`}>
                <span className="font-extrabold text-white text-sm">SaborAI POS</span>
                <span className="text-[10px] text-[#fcfeff]/60 mt-0.5 truncate w-full text-left">
                  {tenant.name}
                </span>
              </div>
            </button>
          </div>

          <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
            <div className="w-full h-[1px] bg-stone-800/80" />
          </div>

          {/* Operational Modules Navigation */}
          <div id="desktop-primary-navigation" className="w-full flex flex-col justify-start items-start gap-0.5">
            {/* Mesas y Salones */}
            <NavVerticalItem
              collapsed={isSidebarCollapsed}
              id="nav-tab-pos"
              onClick={() => setActiveTab('pos')}
              icon={<LayoutGrid className="w-5 h-5 transition-transform group-hover:scale-105" />}
              label="Mesas y Salones"
              sublabel="Mapa y distribución interactiva"
              isActive={activeTab === 'pos'}
            />

            {/* Venta Rápida / Para Llevar (Mostrador) */}
            {onQuickTakeaway && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-tab-takeaway"
                onClick={onQuickTakeaway}
                icon={<ShoppingBag className="w-5 h-5 text-amber-400" />}
                label="Para Llevar"
                sublabel="Venta rápida directa de mostrador"
                variant="warning"
              />
            )}

            {onOpenExecutiveOrder && ['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-executive-order"
                onClick={onOpenExecutiveOrder}
                icon={<BriefcaseBusiness className="w-5 h-5 text-[#a9b994]" />}
                label="Comanda Ejecutiva"
                sublabel="Crédito interno a colaborador"
                variant="accent"
              />
            )}

            {onOpenEmployeeCreditLedger && ['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-employee-credit-ledger"
                onClick={onOpenEmployeeCreditLedger}
                icon={<History className="w-5 h-5 text-emerald-400" />}
                label="Registro de consumo"
                sublabel="Saldos de colaboradores"
              />
            )}

            {/* Cocina & Bar KDS */}
            <NavVerticalItem
              collapsed={isSidebarCollapsed}
              id="nav-tab-kds"
              onClick={() => setActiveTab('kds')}
              icon={<ChefHat className="w-5 h-5 transition-transform group-hover:scale-105" />}
              label="Cocina & Bar (KDS)"
              sublabel={tenant.plan === 'express' ? "Requiere Plan Pro · Comandas" : "Monitor de comandas en vivo"}
              isActive={activeTab === 'kds'}
              badge={tenant.plan === 'express' ? <span className="absolute -top-1 -right-1 text-[8px] font-black bg-stone-800 text-amber-400 px-1 rounded-sm border border-amber-400/40">PRO</span> : undefined}
            />

            {/* Menú y Catálogo */}
            {user?.role === 'ADMIN' && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-tab-menu"
                onClick={() => setActiveTab('menu')}
                icon={<UtensilsCrossed className="w-5 h-5 transition-transform group-hover:scale-105" />}
                label="Platillos & Menú"
                sublabel="Catálogo, recetas y precios"
                isActive={activeTab === 'menu'}
              />
            )}

            {/* Caja & Facturación */}
            <NavVerticalItem
              collapsed={isSidebarCollapsed}
              id="nav-tab-billing"
              onClick={() => setActiveTab('billing')}
              icon={<Receipt className="w-5 h-5 transition-transform group-hover:scale-105" />}
              label="Caja y Facturación"
              sublabel="Cobro y Hacienda Electrónica v4.4"
              isActive={activeTab === 'billing'}
            />

            {/* Reportes */}
            {['ADMIN', 'CAJERO'].includes(user?.role || '') && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-tab-reports"
                onClick={() => setActiveTab('reports')}
                icon={<TrendingUp className="w-5 h-5 transition-transform group-hover:scale-105" />}
                label="Métricas & Reportes"
                sublabel="Ventas, propinas y rendimiento"
                isActive={activeTab === 'reports'}
              />
            )}
          </div>

          <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
            <div className="w-full h-[1px] bg-stone-800/80" />
          </div>

          {/* Cash Drawer & Shift Management */}
          <div className="flex w-full flex-col items-start gap-0.5">
            {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && onOpenCashShift && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-shift-btn"
                onClick={() => onOpenCashShift(isShiftOpen ? 'status' : 'status')}
                icon={<Calculator className="w-5 h-5" />}
                label={isShiftOpen ? "Turno de Caja Abierto" : "Turno Cerrado"}
                sublabel={isShiftOpen ? `${activeRegisterName || 'Caja'} • Cierre Z y arqueo` : `${activeRegisterName || 'Caja'} • Clic para iniciar turno`}
                variant={isShiftOpen ? 'default' : 'warning'}
                badge={
                  <span 
                    className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                      isShiftOpen 
                        ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' 
                        : 'bg-amber-400'
                    }`} 
                  />
                }
              />
            )}
          </div>

          <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
            <div className="w-full h-[1px] bg-stone-800/80" />
          </div>

          {/* User Management & Quick Switch */}
          <div className="w-full flex flex-col items-start gap-0.5">
            {user && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-quick-user-switch-btn"
                onClick={onOpenQuickSwitch || onOpenStaffModal || (() => {})}
                icon={
                  <div className="w-7 h-7 rounded-xl bg-stone-900 text-[#a9b994] font-black text-xs flex items-center justify-center border border-stone-800 group-hover:border-[#a9b994] transition-colors">
                    {user.name.substring(0, 2).toUpperCase()}
                  </div>
                }
                label={user.name}
                sublabel={`${user.role === 'ADMIN' ? 'Administrador' : user.role === 'CAJERO' ? 'Cajero' : 'Salonero'} • Cambiar usuario PIN`}
              />
            )}

            {user?.role === 'ADMIN' && onOpenStaffModal && (
              <NavVerticalItem
                collapsed={isSidebarCollapsed}
                id="nav-register-user-btn"
                onClick={onOpenStaffModal}
                icon={<Users className="w-5 h-5 text-stone-400" />}
                label="Equipo y Personal"
                sublabel="Gestionar colaboradores y roles"
              />
            )}
          </div>

        </div>

        {/* Bottom Group: AI Copilot, System Tray, Settings & Logout */}
        <div className="w-full flex flex-col items-start gap-1 mt-auto pt-2">
          
          {/* Nyza Copilot IA + Learning Hub */}
          <div className="relative w-full px-2 flex items-center gap-1">
            <button
              id="nav-copilot-btn"
              type="button"
              onClick={onOpenCopilot}
              aria-label="Abrir Nyza Copilot IA"
              className={`min-w-0 rounded-2xl flex items-center bg-[#a9b994]/15 text-[#a9b994] border border-[#a9b994]/35 hover:bg-[#a9b994]/25 hover:text-white transition-all duration-200 cursor-pointer ${isSidebarCollapsed ? 'w-full h-14 flex-col justify-center gap-0 px-0' : 'flex-1 h-11 justify-start px-2.5'}`}
              title="Abrir Nyza Copilot IA"
            >
              <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
                <Sparkles className="w-5 h-5 text-[#a9b994]" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-stone-950" />
              </div>
              <div className={`flex flex-col items-start overflow-hidden whitespace-nowrap transition-all duration-300 delay-75 ${isSidebarCollapsed ? 'mt-0.5 w-full items-center text-[9px] font-bold leading-none text-white opacity-100' : 'ml-3 min-w-0 w-36 opacity-100'}`}>
                {isSidebarCollapsed ? (
                  <span>Nyza</span>
                ) : (
                  <>
                    <span className="text-sm font-bold text-white">Nyza Copilot</span>
                    <span className="text-[10px] text-[#a9b994] block truncate">Asistente & Autodiagnóstico</span>
                  </>
                )}
              </div>
            </button>

            {onOpenNyzaHub && (
              <button
                id="nav-nyza-hub-btn"
                type="button"
                onClick={onOpenNyzaHub}
                aria-label="Abrir centro de aprendizaje de Nyza"
                className={`shrink-0 w-9 h-11 rounded-2xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-[#a9b994] items-center justify-center transition-all cursor-pointer ${isSidebarCollapsed ? 'hidden' : 'flex'}`}
                title="Centro de Aprendizaje Global Nyza IA"
              >
                <BrainCircuit className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Barra Compacta de Estado (Wi-Fi, Sonido y Régimen) */}
          <div className="w-full px-2">
            <div className={`w-full rounded-2xl bg-stone-900/90 border border-stone-800/80 p-1.5 flex items-center justify-between gap-1 ${isSidebarCollapsed ? 'flex-col' : 'flex-row'}`}>
              <button
                id="nav-network-btn"
                type="button"
                onClick={onOpenOfflineModal}
                aria-label={isOnline ? 'Conectado; ver cola de sincronización' : 'Sin conexión; ver cola de sincronización'}
                className={`relative min-w-0 h-8 rounded-xl hover:bg-stone-800 flex items-center justify-center gap-1.5 text-xs font-bold transition-colors cursor-pointer ${isSidebarCollapsed ? 'w-full' : 'flex-1'}`}
                title={isOnline ? "Conectado a la nube (Clic para ver cola)" : "Modo Local Offline"}
              >
                {isOnline ? <Wifi className="w-4 h-4 text-emerald-400 shrink-0" /> : <WifiOff className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />}
                <span className={`${isSidebarCollapsed ? 'hidden' : 'inline'} text-[11px] text-stone-300 truncate`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
                {pendingCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-400 text-stone-950 text-[9px] font-black rounded-full">
                    {pendingCount}
                  </span>
                )}
              </button>

              <button
                id="nav-sound-btn"
                type="button"
                onClick={onToggleMute}
                aria-label={isMuted ? 'Activar sonidos de la aplicación' : 'Silenciar sonidos de la aplicación'}
                aria-pressed={!isMuted}
                className={`h-9 rounded-xl hover:bg-stone-800 flex items-center justify-center gap-1 text-xs transition-colors cursor-pointer ${isSidebarCollapsed ? 'w-full flex-col gap-0' : 'flex-1 px-2.5'}`}
                title={isMuted ? "Activar sonidos de la aplicación" : "Silenciar sonidos de la aplicación"}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-stone-500" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                <span className={isSidebarCollapsed ? 'text-[9px] leading-none text-stone-300' : 'text-[10px] text-stone-300'}>Sonido</span>
              </button>

              {user?.role === 'ADMIN' && (
                <button
                  id="nav-regime-btn"
                  type="button"
                  onClick={onOpenSettings}
                  aria-label={tenant.taxRegime === 'SIMPLIFIED' ? 'Régimen fiscal simplificado, IVA 0%' : 'Régimen fiscal tradicional, IVA 13%'}
                  className={`h-9 rounded-xl hover:bg-stone-800 flex items-center justify-center gap-1 text-[10px] font-bold text-stone-300 transition-colors cursor-pointer ${isSidebarCollapsed ? 'w-full flex-col gap-0 px-0 text-[9px] leading-none' : 'flex-1 px-2.5'}`}
                  title={tenant.taxRegime === 'SIMPLIFIED' ? "Régimen Simplificado (0% IVA)" : "Régimen Tradicional (13% IVA)"}
                >
                  <Building2 className="w-3.5 h-3.5 text-[#a9b994]" />
                  <span>{isSidebarCollapsed ? (tenant.taxRegime === 'SIMPLIFIED' ? '0%' : '13%') : (tenant.taxRegime === 'SIMPLIFIED' ? 'IVA 0%' : 'IVA 13%')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Settings */}
          {user?.role === 'ADMIN' && (
            <NavVerticalItem
              collapsed={isSidebarCollapsed}
              id="nav-settings-btn"
              onClick={onOpenSettings}
              icon={<SettingsIcon className="w-5 h-5" />}
              label="Ajustes del Sistema"
              sublabel="Impresoras, cajas y Hacienda DGT"
            />
          )}

          {/* Logout Button */}
          <NavVerticalItem
            collapsed={isSidebarCollapsed}
            id="nav-logout-btn"
            onClick={onLogout}
            icon={<LogOut className="w-5 h-5" />}
            label="Cerrar Sesión"
            sublabel="Salir del punto de venta"
            variant="danger"
          />

        </div>
      </aside>
    </>
  );
};
