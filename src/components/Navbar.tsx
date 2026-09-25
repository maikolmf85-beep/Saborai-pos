import React from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  UtensilsCrossed, 
  ChefHat, 
  CreditCard,
  BookOpen, 
  Settings as SettingsIcon, 
  Sparkles, 
  Wifi, 
  WifiOff, 
  LogOut, 
  Volume2, 
  VolumeX, 
  UserPlus,
  Banknote,
  Vault,
  Landmark
} from 'lucide-react';
import { TenantInfo, UserProfile } from '../types';

export type ActiveTab = 'pos' | 'kds' | 'billing' | 'landing' | 'menu';

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
  onOpenSettings: () => void;
  onOpenOfflineModal: () => void;
  onOpenStaffModal?: () => void;
  onOpenQuickSwitch?: () => void;
  onOpenCashShift?: (initialTab?: 'status' | 'close') => void;
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
    <div className="relative flex items-center justify-start w-full my-0.5 px-1.5 sm:px-2">
      <button
        id={id}
        type="button"
        onClick={onClick}
        className={`w-full h-11 rounded-2xl flex items-center justify-start px-2.5 transition-all duration-200 cursor-pointer ${styleClasses} ${className}`}
        title={label}
      >
        <div className="relative flex items-center justify-center shrink-0 w-6 h-6">
          {icon}
          {badge}
        </div>
        
        <div className="ml-3 flex flex-col items-start overflow-hidden whitespace-nowrap opacity-0 w-0 group-hover/sidebar:opacity-100 group-hover/sidebar:w-44 transition-all duration-300 delay-75">
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
  onOpenSettings,
  onOpenOfflineModal,
  onOpenStaffModal,
  onOpenQuickSwitch,
  onOpenCashShift,
  isShiftOpen,
  activeRegisterName
}) => {
  return (
    <aside 
      className="group/sidebar absolute top-0 left-0 w-16 sm:w-[68px] hover:w-[280px] transition-all duration-300 h-screen bg-stone-950/95 text-white flex flex-col justify-between items-start py-3 border-r border-stone-800/80 shadow-2xl z-50 overflow-y-auto overflow-x-hidden backdrop-blur-xl scrollbar-none"
      aria-label="Navegación vertical SaborAI POS"
      onMouseEnter={() => {}}
      onMouseLeave={() => {}}
    >
      {/* Top Group: Brand Logo & Operational Modules */}
      <div className="w-full flex flex-col items-start">
        
        {/* Brand Isotype / Logo */}
        <div className="relative flex items-center justify-start w-full mb-2 px-1.5 sm:px-2">
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

        <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          <div className="w-full h-[1px] bg-stone-800/80" />
        </div>

        {/* Operational Modules Navigation */}
        <div className="w-full flex flex-col items-start gap-0.5">
          {/* Mesas y Salones */}
          <NavVerticalItem
            id="nav-tab-pos"
            onClick={() => setActiveTab('pos')}
            icon={<UtensilsCrossed className="w-5 h-5" />}
            label="Mesa y Salones"
            sublabel="Plano interactivo en pantalla completa"
            isActive={activeTab === 'pos'}
          />

          {/* Cocina & Bar KDS */}
          <NavVerticalItem
            id="nav-tab-kds"
            onClick={() => setActiveTab('kds')}
            icon={<ChefHat className="w-5 h-5" />}
            label="Cocina & Bar KDS"
            sublabel="Monitor de órdenes y comandas"
            isActive={activeTab === 'kds'}
          />

          {/* Menú y Catálogo */}
          {user?.role === 'ADMIN' && (
            <NavVerticalItem
              id="nav-tab-menu"
              onClick={() => setActiveTab('menu')}
              icon={<BookOpen className="w-5 h-5" />}
              label="Menú y Catálogo"
              sublabel="Administra platillos y precios"
              isActive={activeTab === 'menu'}
            />
          )}

          {/* Caja & Facturación */}
          <NavVerticalItem
            id="nav-tab-billing"
            onClick={() => setActiveTab('billing')}
            icon={<CreditCard className="w-5 h-5" />}
            label="Caja y Facturación"
            sublabel="Cobro rápido y Hacienda DGT v4.3"
            isActive={activeTab === 'billing'}
          />
        </div>

        <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          <div className="w-full h-[1px] bg-stone-800/80" />
        </div>

        {/* Cash Drawer & Shift Management */}
        <div className="w-full flex flex-col items-start gap-0.5">
          {/* Turno & Caja Status */}
          {/* Turno & Caja Status */}
          {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && onOpenCashShift && (
            <NavVerticalItem
              id="nav-shift-btn"
              onClick={() => onOpenCashShift('status')}
              icon={<Banknote className="w-5 h-5" />}
              label={isShiftOpen ? "Turno de Caja Activo" : "Caja Cerrada"}
              sublabel={isShiftOpen ? `${activeRegisterName || 'Caja'} • Ver balance y movimientos` : `${activeRegisterName || 'Caja'} • Clic para abrir turno`}
              badge={
                <span 
                  className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                    isShiftOpen 
                      ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' 
                      : 'bg-amber-400'
                  }`} 
                />
              }
            />
          )}

          {/* Cerrar Turno Direct Button (Visible when shift is open) */}
          {/* Cerrar Turno Direct Button (Visible when shift is open) */}
          {['ADMIN', 'CAJERO', 'SALONERO_CAJA'].includes(user?.role || '') && isShiftOpen && onOpenCashShift && (
            <NavVerticalItem
              id="nav-close-shift-btn"
              onClick={() => onOpenCashShift('close')}
              icon={<Vault className="w-5 h-5 text-amber-300" />}
              label="Cerrar Turno & Caja"
              sublabel="Realizar arqueo ciego y reporte Z"
              variant="warning"
            />
          )}

          {/* Régimen Tributario */}
          {/* Régimen Tributario */}
          {user?.role === 'ADMIN' && (
            <NavVerticalItem
              id="nav-regime-btn"
              onClick={onOpenSettings}
              icon={<Landmark className="w-5 h-5" />}
              label={tenant.taxRegime === 'SIMPLIFIED' ? "Régimen Simplificado" : "Régimen Tradicional"}
              sublabel={tenant.taxRegime === 'SIMPLIFIED' ? "0% IVA al consumidor • 10% Servicio Ley 4946" : "13% IVA • 10% Servicio Ley 4946"}
              badge={
                <span 
                  className={`absolute bottom-2 right-2 w-2 h-2 rounded-full ${
                    tenant.taxRegime === 'SIMPLIFIED' ? 'bg-emerald-400' : 'bg-stone-500'
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
          {/* Registrar Colaborador / Usuario */}
          {/* Registrar Colaborador / Usuario */}
          {user?.role === 'ADMIN' && onOpenStaffModal && (
            <NavVerticalItem
              id="nav-register-user-btn"
              onClick={onOpenStaffModal}
              icon={<UserPlus className="w-5 h-5 text-[#a9b994]" />}
              label="Registrar Usuario"
              sublabel="Dar de alta nuevo colaborador o cambiar permisos"
              variant="accent"
            />
          )}

          {/* Active User Switcher Pill */}
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
              sublabel={`Rol: ${user.role === 'ADMIN' ? 'Administrador' : user.role === 'CAJERO' ? 'Cajero' : 'Salonero'} • Clic para cambiar rápido`}
            />
          )}
        </div>

      </div>

      {/* Bottom Group: Tools, AI, Status & Logout */}
      <div className="w-full flex flex-col items-start gap-0.5 mt-auto">
        
        {/* Copilot IA */}
        <NavVerticalItem
          id="nav-copilot-btn"
          onClick={onOpenCopilot}
          icon={<Sparkles className="w-5 h-5 text-[#a9b994]" />}
          label="Copilot IA"
          sublabel="Asistente gastronómico inteligente"
          variant="accent"
        />

        {/* Network Status & Offline queue */}
        <NavVerticalItem
          id="nav-network-btn"
          onClick={onOpenOfflineModal}
          icon={isOnline ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-amber-400 animate-pulse" />}
          label={isOnline ? "Conexión a Internet Activa" : "Modo Local Offline"}
          sublabel={pendingCount > 0 ? `${pendingCount} transacciones en cola local` : (isOnline ? "Todo sincronizado con la nube" : "Guardando en almacenamiento local seguro")}
          badge={
            pendingCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-emerald-500 text-stone-950 text-[9px] font-black rounded-full flex items-center justify-center shadow-xs">
                {pendingCount}
              </span>
            ) : null
          }
        />

        {/* Sound Mute / Unmute */}
        <NavVerticalItem
          id="nav-sound-btn"
          onClick={onToggleMute}
          icon={isMuted ? <VolumeX className="w-5 h-5 text-stone-500" /> : <Volume2 className="w-5 h-5 text-emerald-400" />}
          label={isMuted ? "Sonidos Silenciados" : "Sonidos Activos"}
          sublabel={isMuted ? "Clic para activar timbres y campana" : "Clic para silenciar avisos sonoros"}
        />

        {/* Settings */}
        {/* Settings */}
        {user?.role === 'ADMIN' && (
          <NavVerticalItem
            id="nav-settings-btn"
            onClick={onOpenSettings}
            icon={<SettingsIcon className="w-5 h-5" />}
            label="Ajustes del Sistema"
            sublabel="Impresoras térmicas, cajas, plano y DGT"
          />
        )}

        <div className="w-full px-4 my-1.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
          <div className="w-full h-[1px] bg-stone-800/80" />
        </div>

        {/* Logout Button */}
        <NavVerticalItem
          id="nav-logout-btn"
          onClick={onLogout}
          icon={<LogOut className="w-5 h-5" />}
          label="Cerrar Sesión"
          sublabel="Salir del sistema de restaurante"
          variant="danger"
        />

      </div>
    </aside>
  );
};
