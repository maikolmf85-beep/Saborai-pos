import React from 'react';
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
  CircleDollarSign
} from 'lucide-react';
import { TenantInfo, UserProfile } from '../types';

export type ActiveTab = 'pos' | 'kds' | 'billing' | 'landing' | 'menu' | 'reports';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
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
  className = ''
}) => {
  let styleClasses = 'text-stone-400 hover:text-white hover:bg-stone-900/90';

  if (isActive) {
    styleClasses = 'bg-[#a9b994] text-white font-black shadow-[0_0_18px_rgba(169,185,148,0.45)] ring-1 ring-white/30';
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
        className={`w-12 h-12 sm:w-full sm:h-11 rounded-full sm:rounded-2xl flex items-center justify-center sm:justify-start sm:px-2.5 transition-all duration-200 cursor-pointer ${styleClasses} ${className}`}
        title={label}
      >
        <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
          {icon}
          {badge}
        </div>
        
        <div className="hidden sm:flex ml-3 flex-col items-start overflow-hidden whitespace-nowrap opacity-0 w-0 group-hover/sidebar:opacity-100 group-hover/sidebar:w-44 transition-all duration-300 delay-75">
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
  isShiftOpen,
  activeRegisterName
}) => {
  return (
    <aside 
      className="group/sidebar fixed sm:absolute bottom-0 sm:top-0 left-0 w-full sm:w-[68px] sm:hover:w-[280px] h-16 sm:h-screen bg-stone-950/95 sm:bg-stone-950/95 text-white flex flex-row sm:flex-col justify-around sm:justify-between items-center sm:items-start py-0 sm:py-3 border-t sm:border-r border-stone-800/80 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] sm:shadow-2xl z-50 overflow-y-hidden sm:overflow-y-auto overflow-x-auto sm:overflow-x-hidden backdrop-blur-xl sm:scrollbar-none px-2 sm:px-0"
      aria-label="Navegación vertical SaborAI POS"
      onMouseEnter={() => {}}
      onMouseLeave={() => {}}
    >
      {/* Top Group: Brand Logo & Operational Modules */}
      <div className="w-full h-full sm:h-auto flex flex-row sm:flex-col items-center sm:items-start gap-1 sm:gap-0">
        
        {/* Brand Isotype / Logo (Hidden on very small screens, visible on desktop) */}
        <div className="hidden sm:flex relative items-center justify-start w-full mb-2 px-1.5 sm:px-2">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="w-full h-11 rounded-2xl flex items-center justify-start px-2.5 bg-stone-900 border border-stone-800 hover:border-[#a9b994]/80 transition-all duration-200 cursor-pointer shadow-sm overflow-hidden"
            title="SaborAI POS"
          >
            <div className="w-6 h-6 flex items-center justify-center shrink-0">
              <BrandLogo variant="isotype" size="sm" />
            </div>
            
            <div className="ml-3 flex flex-col items-start overflow-hidden whitespace-nowrap opacity-0 w-0 group-hover/sidebar:opacity-100 group-hover/sidebar:w-44 transition-all duration-300 delay-75">
              <span className="font-extrabold text-[#a9b994] text-sm">SaborAI POS</span>
              <span className="text-[10px] text-stone-400 mt-0.5 truncate w-full text-left">
                {tenant.name}
              </span>
            </div>
          </button>
        </div>

        <div className="hidden sm:block w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          <div className="w-full h-[1px] bg-stone-800/80" />
        </div>

        {/* Operational Modules Navigation */}
        <div className="w-full flex flex-row sm:flex-col justify-around sm:justify-start items-center sm:items-start gap-2 sm:gap-0.5">
          {/* Mesas y Salones: LayoutGrid representa claramente el plano/distribución de mesas */}
          <NavVerticalItem
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
              id="nav-tab-takeaway"
              onClick={onQuickTakeaway}
              icon={<ShoppingBag className="w-5 h-5 text-amber-400" />}
              label="Para Llevar"
              sublabel="Venta rápida directa de mostrador"
              variant="warning"
            />
          )}

          {/* Cocina & Bar KDS */}
          <NavVerticalItem
            id="nav-tab-kds"
            onClick={() => setActiveTab('kds')}
            icon={<ChefHat className="w-5 h-5 transition-transform group-hover:scale-105" />}
            label="Cocina & Bar (KDS)"
            sublabel={tenant.plan === 'express' ? "Requiere Plan Pro · Comandas" : "Monitor de comandas en vivo"}
            isActive={activeTab === 'kds'}
            badge={tenant.plan === 'express' ? <span className="absolute -top-1 -right-1 text-[8px] font-black bg-stone-800 text-amber-400 px-1 rounded-sm border border-amber-400/40">PRO</span> : undefined}
          />

          {/* Menú y Catálogo: UtensilsCrossed representa alimentos y platillos */}
          {user?.role === 'ADMIN' && (
            <NavVerticalItem
              id="nav-tab-menu"
              onClick={() => setActiveTab('menu')}
              icon={<UtensilsCrossed className="w-5 h-5 transition-transform group-hover:scale-105" />}
              label="Platillos & Menú"
              sublabel="Catálogo, recetas y precios"
              isActive={activeTab === 'menu'}
            />
          )}

          {/* Caja & Facturación: Receipt representa el ticket / factura digital DGT */}
          <NavVerticalItem
            id="nav-tab-billing"
            onClick={() => setActiveTab('billing')}
            icon={<Receipt className="w-5 h-5 transition-transform group-hover:scale-105" />}
            label="Caja y Facturación"
            sublabel="Cobro y Hacienda Electrónica v4.4"
            isActive={activeTab === 'billing'}
          />

          {/* Reportes: TrendingUp representa métricas de negocio y crecimiento */}
          {['ADMIN', 'CAJERO'].includes(user?.role || '') && (
            <NavVerticalItem
              id="nav-tab-reports"
              onClick={() => setActiveTab('reports')}
              icon={<TrendingUp className="w-5 h-5 transition-transform group-hover:scale-105" />}
              label="Métricas & Reportes"
              sublabel="Ventas, propinas y rendimiento"
              isActive={activeTab === 'reports'}
            />
          )}
        </div>

        <div className="hidden sm:block w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          <div className="w-full h-[1px] bg-stone-800/80" />
        </div>

        {/* Cash Drawer & Shift Management (Mobile Hidden, Desktop Sidebar) */}
        <div className="hidden sm:flex w-full flex-col items-start gap-0.5">
          {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && onOpenCashShift && (
            <NavVerticalItem
              id="nav-shift-btn"
              onClick={() => onOpenCashShift(isShiftOpen ? 'status' : 'status')}
              icon={<CircleDollarSign className="w-5 h-5" />}
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
              id="nav-quick-user-switch-btn"
              onClick={onOpenQuickSwitch || onOpenStaffModal || (() => {})}
              icon={
                <div className="w-7 h-7 rounded-xl bg-stone-900 text-[#a9b994] font-black text-xs flex items-center justify-center border border-stone-800 group-hover:border-[#a9b994] transition-colors">
                  {user.name.substring(0, 2).toUpperCase()}
                </div>
              }
              label={user.name}
              sublabel={`${user.role === 'ADMIN' ? 'Administrador' : user.role === 'CAJERO' ? 'Cajero' : 'Salonero'} • Cambiar turno PIN`}
            />
          )}

          {user?.role === 'ADMIN' && onOpenStaffModal && (
            <NavVerticalItem
              id="nav-register-user-btn"
              onClick={onOpenStaffModal}
              icon={<Users className="w-5 h-5 text-stone-400" />}
              label="Equipo y Personal"
              sublabel="Gestionar colaboradores y roles"
            />
          )}
        </div>

      </div>

      {/* Bottom Group: AI Copilot, Compact System Tray, Settings & Logout */}
      <div className="hidden sm:flex w-full flex-col items-start gap-1 mt-auto pt-2">
        
        {/* Unificado: Nyza Copilot IA + Learning Hub */}
        <div className="relative w-full px-2 flex items-center gap-1">
          <button
            id="nav-copilot-btn"
            type="button"
            onClick={onOpenCopilot}
            className="w-full h-11 rounded-2xl flex items-center justify-start px-2.5 bg-[#a9b994]/15 text-[#a9b994] border border-[#a9b994]/35 hover:bg-[#a9b994]/25 hover:text-white transition-all duration-200 cursor-pointer"
            title="Abrir Nyza Copilot IA"
          >
            <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
              <Sparkles className="w-5 h-5 text-[#a9b994]" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-stone-950" />
            </div>
            <div className="ml-3 flex flex-col items-start overflow-hidden whitespace-nowrap opacity-0 w-0 group-hover/sidebar:opacity-100 group-hover/sidebar:w-36 transition-all duration-300 delay-75">
              <span className="text-sm font-bold text-white">Nyza Copilot</span>
              <span className="text-[10px] text-[#a9b994] block truncate">Asistente & Autodiagnóstico</span>
            </div>
          </button>

          {onOpenNyzaHub && (
            <button
              id="nav-nyza-hub-btn"
              type="button"
              onClick={onOpenNyzaHub}
              className="hidden group-hover/sidebar:flex shrink-0 w-9 h-11 rounded-2xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-[#a9b994] items-center justify-center transition-all cursor-pointer"
              title="Centro de Aprendizaje Global Nyza IA"
            >
              <BrainCircuit className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Barra Compacta de Estado (Wi-Fi, Sonido y Régimen) */}
        <div className="w-full px-2">
          <div className="w-full rounded-2xl bg-stone-900/90 border border-stone-800/80 p-1.5 flex flex-col group-hover/sidebar:flex-row items-center justify-between gap-1">
            <button
              id="nav-network-btn"
              type="button"
              onClick={onOpenOfflineModal}
              className="relative w-full group-hover/sidebar:flex-1 h-8 rounded-xl hover:bg-stone-800 flex items-center justify-center gap-1.5 text-xs font-bold transition-colors cursor-pointer"
              title={isOnline ? "Conectado a la nube (Clic para ver cola)" : "Modo Local Offline"}
            >
              {isOnline ? <Wifi className="w-4 h-4 text-emerald-400 shrink-0" /> : <WifiOff className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />}
              <span className="hidden group-hover/sidebar:inline text-[11px] text-stone-300 truncate">
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
              className="hidden group-hover/sidebar:flex h-8 px-2.5 rounded-xl hover:bg-stone-800 items-center justify-center gap-1 text-xs transition-colors cursor-pointer"
              title={isMuted ? "Sonidos silenciados" : "Sonidos activos"}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-stone-500" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            {user?.role === 'ADMIN' && (
              <button
                id="nav-regime-btn"
                type="button"
                onClick={onOpenSettings}
                className="hidden group-hover/sidebar:flex h-8 px-2.5 rounded-xl hover:bg-stone-800 items-center justify-center gap-1 text-[10px] font-bold text-stone-300 transition-colors cursor-pointer"
                title={tenant.taxRegime === 'SIMPLIFIED' ? "Régimen Simplificado (0% IVA)" : "Régimen Tradicional (13% IVA)"}
              >
                <Building2 className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>{tenant.taxRegime === 'SIMPLIFIED' ? 'Simp.' : '13%'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Settings */}
        {user?.role === 'ADMIN' && (
          <NavVerticalItem
            id="nav-settings-btn"
            onClick={onOpenSettings}
            icon={<SettingsIcon className="w-5 h-5" />}
            label="Ajustes del Sistema"
            sublabel="Impresoras, cajas y Hacienda DGT"
          />
        )}

        {/* Logout Button */}
        <NavVerticalItem
          id="nav-logout-btn"
          onClick={onLogout}
          icon={<LogOut className="w-5 h-5" />}
          label="Cerrar Sesión"
          sublabel="Salir del punto de venta"
          variant="danger"
        />

      </div>
    </aside>
  );
};
