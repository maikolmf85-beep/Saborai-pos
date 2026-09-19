import React, { useState } from 'react';
import { 
  ShieldAlert, 
  TrendingUp, 
  Users, 
  CreditCard, 
  Building2, 
  CheckCircle2, 
  PauseCircle, 
  Ban, 
  ArrowUpRight,
  Sparkles,
  MapPin,
  Search,
  Filter,
  Calendar,
  ExternalLink,
  Edit3,
  RefreshCw,
  Clock,
  Send,
  Zap,
  Check,
  X,
  Smartphone
} from 'lucide-react';
import { TenantInfo, SubscriptionPlan, SubscriptionStatus } from '../types';
import { notionService } from '../services/notionService';

interface SuperAdminBackofficeProps {
  currentTenant: TenantInfo;
  onSelectTenant: (tenant: TenantInfo) => void;
  onOpenNotion?: () => void;
}

export const SuperAdminBackoffice: React.FC<SuperAdminBackofficeProps> = ({
  currentTenant,
  onSelectTenant,
  onOpenNotion
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlan, setFilterPlan] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedTenantForEdit, setSelectedTenantForEdit] = useState<TenantInfo | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const [tenantsList, setTenantsList] = useState<TenantInfo[]>([
    currentTenant
  ]);

  // Derived metrics
  const totalMRR = tenantsList.reduce((sum, t) => sum + (t.status === 'ACTIVE' ? t.monthlyFee : 0), 0);
  const activeTenantsCount = tenantsList.filter(t => t.status === 'ACTIVE').length;
  const gracePeriodCount = tenantsList.filter(t => t.status === 'PAST_DUE').length;
  const suspendedCount = tenantsList.filter(t => t.status === 'CANCELLED').length;

  const handleUpdateTenantStatus = (tenantId: string, newStatus: SubscriptionStatus, graceDate?: string) => {
    const updated = tenantsList.map(t => {
      if (t.id === tenantId) {
        return { 
          ...t, 
          status: newStatus,
          gracePeriodEndsAt: graceDate || t.gracePeriodEndsAt
        };
      }
      return t;
    });
    setTenantsList(updated);

    if (currentTenant.id === tenantId) {
      onSelectTenant({ 
        ...currentTenant, 
        status: newStatus,
        gracePeriodEndsAt: graceDate || currentTenant.gracePeriodEndsAt 
      });
    }

    if (selectedTenantForEdit && selectedTenantForEdit.id === tenantId) {
      setSelectedTenantForEdit(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

  const handleChangePlan = (tenantId: string, newPlan: SubscriptionPlan) => {
    const fee = newPlan === 'express' ? 22000 : newPlan === 'pro' ? 45000 : 85000;
    const updated = tenantsList.map(t => {
      if (t.id === tenantId) {
        return { ...t, plan: newPlan, monthlyFee: fee };
      }
      return t;
    });
    setTenantsList(updated);

    if (currentTenant.id === tenantId) {
      onSelectTenant({ ...currentTenant, plan: newPlan, monthlyFee: fee });
    }

    if (selectedTenantForEdit && selectedTenantForEdit.id === tenantId) {
      setSelectedTenantForEdit(prev => prev ? { ...prev, plan: newPlan, monthlyFee: fee } : null);
    }
  };

  const handleSyncNotion = async () => {
    setSyncFeedback('Sincronizando suscriptores con Notion...');
    try {
      // Record all tenants into notion service
      for (const t of tenantsList) {
        await notionService.recordUserRegistration(
          {
            id: `usr_owner_${t.id}`,
            name: `Admin ${t.name}`,
            email: t.email,
            phone: t.phone,
            restaurantName: t.name,
            role: 'ADMIN'
          },
          t
        );
      }
      setSyncFeedback('¡Sincronización con Notion exitosa!');
      setTimeout(() => setSyncFeedback(null), 3500);
    } catch {
      setSyncFeedback('Se actualizó la cola local de Notion.');
      setTimeout(() => setSyncFeedback(null), 3500);
    }
  };

  // Filtered tenants
  const filteredTenants = tenantsList.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.cedulaJuridica.includes(searchTerm) ||
                          t.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlan = filterPlan === 'ALL' || t.plan === filterPlan;
    const matchesStatus = filterStatus === 'ALL' || t.status === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans selection:bg-[#a9b994]/30 overflow-y-auto">
      
      {/* Premium Dark Header with Gradient Background */}
      <div className="bg-gradient-to-br from-stone-900 to-stone-950 border-b border-stone-800/60 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-[1700px] mx-auto p-4 sm:p-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-900/40">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">SaborAI SuperAdmin</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <p className="text-[11px] font-medium text-stone-400 uppercase tracking-widest">
                    Centro de Control Global
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onOpenNotion && (
              <button
                onClick={onOpenNotion}
                className="px-4 py-2 bg-stone-800/50 hover:bg-stone-800 border border-stone-700/50 text-stone-300 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 backdrop-blur-sm"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Base Notion</span>
              </button>
            )}

            <button
              onClick={handleSyncNotion}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:-translate-y-0.5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Sincronizar Cloud</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1700px] mx-auto p-4 sm:p-6 lg:px-8 space-y-8 mt-2">
        
        {syncFeedback && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
            <Check className="w-4 h-4" />
            <span>{syncFeedback}</span>
          </div>
        )}

        {/* KPI Cards Grid - Premium Glassmorphism */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          
          {/* MRR Card */}
          <div className="group relative overflow-hidden p-6 rounded-3xl bg-stone-900 border border-stone-800 hover:border-emerald-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-900/20 flex flex-col justify-between">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between text-[11px] text-stone-400 font-bold uppercase tracking-wider mb-3">
                <span>Ingresos Recurrentes (MRR)</span>
                <div className="p-2 bg-stone-800 rounded-xl group-hover:bg-emerald-500/10 transition-colors">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                </div>
              </div>
              <div className="text-4xl font-black text-white tracking-tight">
                ₡{totalMRR.toLocaleString()}
              </div>
            </div>
            <div className="relative z-10 mt-6 pt-4 border-t border-stone-800 flex items-center justify-between text-xs">
              <span className="text-emerald-400 font-bold flex items-center gap-1 bg-emerald-400/10 px-2 py-1 rounded-lg">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>+₡{(totalMRR * 0.15).toFixed(0)}</span>
              </span>
              <span className="text-stone-500 font-medium">Crecimiento Mensual</span>
            </div>
          </div>

          {/* Active Restaurants */}
          <div className="group relative overflow-hidden p-6 rounded-3xl bg-stone-900 border border-stone-800 hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-900/20 flex flex-col justify-between">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between text-[11px] text-stone-400 font-bold uppercase tracking-wider mb-3">
                <span>Clientes Activos</span>
                <div className="p-2 bg-stone-800 rounded-xl group-hover:bg-blue-500/10 transition-colors">
                  <Building2 className="w-4 h-4 text-blue-400" />
                </div>
              </div>
              <div className="text-4xl font-black text-white tracking-tight">
                {activeTenantsCount} <span className="text-xl text-stone-600">/ {tenantsList.length}</span>
              </div>
            </div>
            <div className="relative z-10 mt-6 pt-4 border-t border-stone-800 flex items-center gap-2 text-xs text-stone-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" />
              <span>Plataformas Operando</span>
            </div>
          </div>

          {/* Grace Period Warning */}
          <div className="group relative overflow-hidden p-6 rounded-3xl bg-stone-900 border border-stone-800 hover:border-amber-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-amber-900/20 flex flex-col justify-between">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between text-[11px] text-stone-400 font-bold uppercase tracking-wider mb-3">
                <span>En Período de Gracia</span>
                <div className="p-2 bg-stone-800 rounded-xl group-hover:bg-amber-500/10 transition-colors">
                  <Clock className="w-4 h-4 text-amber-400" />
                </div>
              </div>
              <div className="text-4xl font-black text-amber-400 tracking-tight">
                {gracePeriodCount}
              </div>
            </div>
            <div className="relative z-10 mt-6 pt-4 border-t border-stone-800 text-xs text-amber-500/80 font-medium">
              <span>Riesgo de Suspensión (5 días)</span>
            </div>
          </div>

          {/* Suspended Restaurants */}
          <div className="group relative overflow-hidden p-6 rounded-3xl bg-stone-900 border border-stone-800 hover:border-rose-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-rose-900/20 flex flex-col justify-between">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between text-[11px] text-stone-400 font-bold uppercase tracking-wider mb-3">
                <span>Cuentas Suspendidas</span>
                <div className="p-2 bg-stone-800 rounded-xl group-hover:bg-rose-500/10 transition-colors">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                </div>
              </div>
              <div className="text-4xl font-black text-rose-500 tracking-tight">
                {suspendedCount}
              </div>
            </div>
            <div className="relative z-10 mt-6 pt-4 border-t border-stone-800 text-xs text-rose-500/80 font-medium flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" />
              <span>Modo lectura activado</span>
            </div>
          </div>

        </div>

      {/* Filter and Search Bar */}
      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 shadow-xl shadow-stone-950/50 flex flex-col md:flex-row items-center gap-4 relative z-0">
        <div className="relative flex-1 w-full">
          <Search className="w-5 h-5 text-stone-500 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por restaurante, cédula jurídica o ubicación..."
            className="w-full pl-12 pr-4 py-3 bg-stone-950 border border-stone-800 rounded-xl text-sm text-stone-100 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder:text-stone-600 shadow-inner"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="px-4 py-3 bg-stone-950 border border-stone-800 rounded-xl text-sm font-bold text-stone-300 focus:outline-none focus:border-emerald-500/50 transition-all appearance-none pr-8 cursor-pointer shadow-inner"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2378716c'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em' }}
          >
            <option value="ALL">Todos los Planes</option>
            <option value="express">Plan Express (₡22k)</option>
            <option value="pro">Plan Pro (₡45k)</option>
            <option value="multibranch">Multisucursal (₡85k+)</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-3 bg-stone-950 border border-stone-800 rounded-xl text-sm font-bold text-stone-300 focus:outline-none focus:border-emerald-500/50 transition-all appearance-none pr-8 cursor-pointer shadow-inner"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2378716c'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em' }}
          >
            <option value="ALL">Todos los Estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="PAST_DUE">En Gracia</option>
            <option value="CANCELLED">Suspendidos</option>
          </select>
        </div>
      </div>

      {/* Tenants Table Premium */}
      <div className="bg-stone-900 border border-stone-800 rounded-3xl p-6 shadow-xl shadow-stone-950/50 space-y-6 relative z-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-black text-lg text-white flex items-center gap-2">
              Directorio de Suscriptores 
              <span className="px-2.5 py-1 bg-stone-800 text-stone-300 rounded-lg text-xs">{filteredTenants.length}</span>
            </h3>
            <p className="text-xs text-stone-500 font-medium mt-1">
              Control de acceso, facturación recurrente y asignación de planes.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-stone-800 text-stone-400 uppercase text-[10px] tracking-wider">
                <th className="pb-4 font-black">Restaurante / Razón Social</th>
                <th className="pb-4 font-black">Ubicación</th>
                <th className="pb-4 font-black">Plan SaborAI</th>
                <th className="pb-4 font-black">Cuota Mensual</th>
                <th className="pb-4 font-black">Estado Suscripción</th>
                <th className="pb-4 font-black text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/50">
              {filteredTenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-stone-800/30 transition-colors group">
                  <td className="py-4">
                    <div className="font-black text-white flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700 flex items-center justify-center text-xs text-stone-400 font-black group-hover:border-emerald-500/30 group-hover:text-emerald-400 transition-colors">
                        {tenant.name.charAt(0)}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{tenant.name}</span>
                          {tenant.id === currentTenant.id && (
                            <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[9px] font-black uppercase tracking-wider border border-emerald-500/30">
                              Actual
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-stone-500 font-mono mt-0.5">
                          {tenant.cedulaJuridica} • {tenant.phone}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-4 text-stone-400">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <MapPin className="w-3.5 h-3.5 text-stone-600 group-hover:text-emerald-500 transition-colors" />
                      <span>{tenant.location}</span>
                    </div>
                  </td>

                  <td className="py-4">
                    <span className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider border ${
                      tenant.plan === 'pro'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : tenant.plan === 'multibranch'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-stone-800/50 text-stone-300 border-stone-700'
                    }`}>
                      {tenant.plan === 'express' ? 'Express (1 Term)' : tenant.plan === 'pro' ? 'Pro (Mesas & KDS)' : 'Multisucursal'}
                    </span>
                  </td>

                  <td className="py-4 font-black text-stone-200">
                    ₡{tenant.monthlyFee.toLocaleString()}
                  </td>

                  <td className="py-4">
                    <div className="flex flex-col gap-1 items-start">
                      <span className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider inline-flex items-center gap-1.5 border ${
                        tenant.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                          : tenant.status === 'PAST_DUE'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${tenant.status === 'ACTIVE' ? 'bg-emerald-400' : tenant.status === 'PAST_DUE' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`}></span>
                        {tenant.status === 'ACTIVE' ? 'Activo' : tenant.status === 'PAST_DUE' ? 'En Gracia' : 'Suspendido'}
                      </span>
                      {tenant.status === 'PAST_DUE' && tenant.gracePeriodEndsAt && (
                        <div className="text-[10px] text-amber-500/80 font-bold ml-1">
                          Vence: {tenant.gracePeriodEndsAt}
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="py-4 text-right space-x-2">
                    <button
                      onClick={() => setSelectedTenantForEdit(tenant)}
                      className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 hover:border-stone-600 text-stone-200 hover:text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5"
                      title="Editar Plan y Gracia"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Gestionar</span>
                    </button>

                    <button
                      onClick={() => onSelectTenant(tenant)}
                      className="px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 hover:border-emerald-500 text-emerald-500 hover:text-white rounded-xl text-xs font-bold transition-all"
                    >
                      Impersonar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ======================================================== */}
      {/* DRAWER / MODAL: EDITAR PLAN Y GRACIA DE UN SUSCRIPTOR     */}
      {/* ======================================================== */}
      {selectedTenantForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-stone-900 rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl shadow-emerald-900/20 border border-stone-800 space-y-6 relative overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-stone-800 relative z-10">
              <div>
                <h3 className="text-xl font-black text-white tracking-tight">
                  Gestión de Suscripción
                </h3>
                <p className="text-sm text-stone-400 mt-1 font-medium">
                  {selectedTenantForEdit.name}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs text-stone-500 font-mono">
                  <span>Cédula {selectedTenantForEdit.cedulaJuridica}</span>
                  <span>•</span>
                  <span>{selectedTenantForEdit.location}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedTenantForEdit(null)}
                className="p-2 text-stone-500 hover:text-white hover:bg-stone-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Plan Selector */}
            <div className="space-y-3 relative z-10">
              <label className="block text-xs font-black text-stone-400 uppercase tracking-widest">
                Nivel de Plan SaborAI
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: 'express', label: 'Express', price: '₡22,000' },
                  { id: 'pro', label: 'Pro', price: '₡45,000' },
                  { id: 'multibranch', label: 'Multi', price: '₡85,000+' }
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleChangePlan(selectedTenantForEdit.id, p.id as SubscriptionPlan)}
                    className={`p-4 rounded-2xl border text-center transition-all ${
                      selectedTenantForEdit.plan === p.id
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/50'
                        : 'bg-stone-950 text-stone-400 border-stone-800 hover:border-stone-700 hover:bg-stone-800/50'
                    }`}
                  >
                    <div className="font-bold text-sm">{p.label}</div>
                    <div className={`text-xs font-black mt-1 ${selectedTenantForEdit.plan === p.id ? 'text-white' : 'text-stone-500'}`}>{p.price}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Status Selector & Grace Period */}
            <div className="space-y-3 relative z-10">
              <label className="block text-xs font-black text-stone-400 uppercase tracking-widest">
                Estado Operativo
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm font-bold">
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'ACTIVE')}
                  className={`py-3 rounded-xl border transition-all flex justify-center items-center gap-2 ${
                    selectedTenantForEdit.status === 'ACTIVE'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                      : 'bg-stone-950 text-stone-500 border-stone-800 hover:border-stone-700 hover:bg-stone-800/50'
                  }`}
                >
                  {selectedTenantForEdit.status === 'ACTIVE' && <CheckCircle2 className="w-4 h-4" />}
                  Activo
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'PAST_DUE', '30/09/2026')}
                  className={`py-3 rounded-xl border transition-all flex justify-center items-center gap-2 ${
                    selectedTenantForEdit.status === 'PAST_DUE'
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                      : 'bg-stone-950 text-stone-500 border-stone-800 hover:border-stone-700 hover:bg-stone-800/50'
                  }`}
                >
                  {selectedTenantForEdit.status === 'PAST_DUE' && <Clock className="w-4 h-4" />}
                  Gracia (5d)
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'CANCELLED')}
                  className={`py-3 rounded-xl border transition-all flex justify-center items-center gap-2 ${
                    selectedTenantForEdit.status === 'CANCELLED'
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                      : 'bg-stone-950 text-stone-500 border-stone-800 hover:border-stone-700 hover:bg-stone-800/50'
                  }`}
                >
                  {selectedTenantForEdit.status === 'CANCELLED' && <Ban className="w-4 h-4" />}
                  Suspendido
                </button>
              </div>
            </div>

            {/* Quick Actions for SuperAdmin */}
            <div className="p-5 bg-stone-950 rounded-2xl border border-stone-800/80 space-y-3 relative z-10">
              <span className="text-xs font-black text-stone-500 uppercase tracking-widest block">Acciones Rápidas</span>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    alert(`Enlace de cobro Tilopay generado para ${selectedTenantForEdit.name}: https://checkout.tilopay.me/pay/saborai_${selectedTenantForEdit.id}`);
                  }}
                  className="flex-1 py-2.5 bg-stone-900 hover:bg-stone-800 border border-stone-800 hover:border-emerald-500/30 rounded-xl font-bold text-stone-300 hover:text-emerald-400 transition-all flex justify-center items-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Cobro Tilopay</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleUpdateTenantStatus(selectedTenantForEdit.id, 'ACTIVE');
                    alert(`Pago SINPE Móvil registrado. La cuenta de ${selectedTenantForEdit.name} está activa.`);
                  }}
                  className="flex-1 py-2.5 bg-stone-900 hover:bg-stone-800 border border-stone-800 hover:border-purple-500/30 rounded-xl font-bold text-stone-300 hover:text-purple-400 transition-all flex justify-center items-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Registrar SINPE</span>
                </button>
              </div>
            </div>

            <div className="pt-4 flex justify-end relative z-10 border-t border-stone-800/50">
              <button
                type="button"
                onClick={() => setSelectedTenantForEdit(null)}
                className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-teal-500 hover:to-emerald-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/30 transition-all hover:-translate-y-0.5"
              >
                Guardar y Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      </div>
    </div>
  );
};
