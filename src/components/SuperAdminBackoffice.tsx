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
    currentTenant,
    {
      id: 'tenant_saborai_cr_002',
      name: 'Café & Bistro Escalante',
      cedulaJuridica: '3-101-554433',
      email: 'gerencia@bistroescalante.cr',
      phone: '+506 2224-8899',
      location: 'Barrio Escalante, San José',
      plan: 'express',
      status: 'ACTIVE',
      currency: 'CRC',
      monthlyFee: 22000,
    },
    {
      id: 'tenant_saborai_cr_003',
      name: 'Parrillada Don Fernando Guachipelín',
      cedulaJuridica: '3-101-998877',
      email: 'admin@donfernando.cr',
      phone: '+506 2215-6677',
      location: 'Guachipelín, Escazú',
      plan: 'pro',
      status: 'ACTIVE',
      currency: 'CRC',
      monthlyFee: 45000,
    },
    {
      id: 'tenant_saborai_cr_004',
      name: 'Grupo Gastronómico Tamarindo Sunset',
      cedulaJuridica: '3-101-112233',
      email: 'finanzas@tamarindosunset.cr',
      phone: '+506 2653-1200',
      location: 'Playa Tamarindo, Guanacaste (3 Sucursales)',
      plan: 'multibranch',
      status: 'ACTIVE',
      currency: 'CRC',
      monthlyFee: 255000, // 85k * 3
    },
    {
      id: 'tenant_saborai_cr_005',
      name: 'Marisquería El Timón Herediano',
      cedulaJuridica: '3-101-774411',
      email: 'eltimon@heredia.cr',
      phone: '+506 2260-3322',
      location: 'San Joaquín de Flores, Heredia',
      plan: 'express',
      status: 'PAST_DUE',
      gracePeriodEndsAt: '25/09/2026',
      currency: 'CRC',
      monthlyFee: 22000,
    }
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
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-stone-900">Control de Suscriptores SaaS SaborAI</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase bg-stone-900 text-white">
              SuperAdmin
            </span>
          </div>
          <p className="text-xs text-stone-500">
            Monitoreo de ingresos recurrentes (MRR), estados de gracia, planes y sincronización con Notion.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenNotion && (
            <button
              onClick={onOpenNotion}
              className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Base Notion</span>
            </button>
          )}

          <button
            onClick={handleSyncNotion}
            className="px-4 py-2 bg-[#588157] hover:bg-[#476c46] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sincronizar con Notion</span>
          </button>
        </div>
      </div>

      {syncFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{syncFeedback}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* MRR Card */}
        <div className="p-5 rounded-3xl bg-white border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 font-bold uppercase mb-2">
              <span>Ingresos Recurrentes (MRR)</span>
              <CreditCard className="w-4 h-4 text-[#588157]" />
            </div>
            <div className="text-3xl font-black text-stone-900 tracking-tight">
              ₡{totalMRR.toLocaleString()}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-[11px]">
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>+₡{(totalMRR * 0.15).toFixed(0)} este mes</span>
            </span>
            <span className="text-stone-400 font-mono">Tilopay CR</span>
          </div>
        </div>

        {/* Active Restaurants */}
        <div className="p-5 rounded-3xl bg-white border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 font-bold uppercase mb-2">
              <span>Restaurantes Activos</span>
              <Building2 className="w-4 h-4 text-[#588157]" />
            </div>
            <div className="text-3xl font-black text-stone-900 tracking-tight">
              {activeTenantsCount} / {tenantsList.length}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] text-stone-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Operando en tiempo real</span>
          </div>
        </div>

        {/* Grace Period Warning */}
        <div className="p-5 rounded-3xl bg-white border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 font-bold uppercase mb-2">
              <span>En Período de Gracia</span>
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-amber-600 tracking-tight">
              {gracePeriodCount}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 text-[11px] text-amber-800 font-medium">
            <span>POS 100% activo (5 días para pago)</span>
          </div>
        </div>

        {/* Suspended Restaurants */}
        <div className="p-5 rounded-3xl bg-white border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500 font-bold uppercase mb-2">
              <span>Suspendidos / Vencidos</span>
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-3xl font-black text-rose-600 tracking-tight">
              {suspendedCount}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 text-[11px] text-stone-500">
            <span>Modo solo lectura activado</span>
          </div>
        </div>

      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3 shadow-xs flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por restaurante, cédula jurídica o ubicación..."
            className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700 focus:outline-none"
          >
            <option value="ALL">Todos los Planes</option>
            <option value="express">Plan Express (₡22k)</option>
            <option value="pro">Plan Pro (₡45k)</option>
            <option value="multibranch">Multisucursal (₡85k+)</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700 focus:outline-none"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="ACTIVE">Activo</option>
            <option value="PAST_DUE">En Gracia</option>
            <option value="CANCELLED">Suspendido</option>
          </select>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-stone-900">
            Directorio de Suscriptores ({filteredTenants.length})
          </h3>
          <span className="text-xs text-stone-400">
            Control de cobro y asignación de planes
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                <th className="pb-3 font-bold">Restaurante / Razón Social</th>
                <th className="pb-3 font-bold">Ubicación</th>
                <th className="pb-3 font-bold">Plan SaborAI</th>
                <th className="pb-3 font-bold">Cuota Mensual</th>
                <th className="pb-3 font-bold">Estado Suscripción</th>
                <th className="pb-3 font-bold text-right">Acciones de SuperAdmin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredTenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-stone-50/80 transition-colors">
                  <td className="py-3.5">
                    <div className="font-bold text-stone-900 flex items-center gap-1.5">
                      <span>{tenant.name}</span>
                      {tenant.id === currentTenant.id && (
                        <span className="px-1.5 py-0.2 bg-stone-900 text-white rounded text-[9px] font-bold">
                          Actual
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-stone-500 font-mono">
                      Cédula: {tenant.cedulaJuridica} • Tel: {tenant.phone}
                    </div>
                  </td>

                  <td className="py-3.5 text-stone-600">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#588157]" />
                      <span>{tenant.location}</span>
                    </div>
                  </td>

                  <td className="py-3.5">
                    <span className={`px-2.5 py-1 rounded-lg font-black text-[10px] uppercase border ${
                      tenant.plan === 'pro'
                        ? 'bg-purple-50 text-purple-900 border-purple-200'
                        : tenant.plan === 'multibranch'
                        ? 'bg-amber-50 text-amber-900 border-amber-200'
                        : 'bg-stone-100 text-stone-800 border-stone-200'
                    }`}>
                      {tenant.plan === 'express' ? 'Express (1 Term)' : tenant.plan === 'pro' ? 'Pro (Mesas & KDS)' : 'Multisucursal'}
                    </span>
                  </td>

                  <td className="py-3.5 font-black text-stone-900">
                    ₡{tenant.monthlyFee.toLocaleString()}
                  </td>

                  <td className="py-3.5">
                    <div className="space-y-0.5">
                      <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase inline-block ${
                        tenant.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : tenant.status === 'PAST_DUE'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-rose-100 text-rose-900 border border-rose-300'
                      }`}>
                        {tenant.status === 'ACTIVE' ? 'Activo' : tenant.status === 'PAST_DUE' ? 'En Gracia' : 'Suspendido'}
                      </span>
                      {tenant.status === 'PAST_DUE' && tenant.gracePeriodEndsAt && (
                        <div className="text-[10px] text-amber-800 font-bold">
                          Hasta: {tenant.gracePeriodEndsAt}
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 text-right space-x-1.5">
                    <button
                      onClick={() => setSelectedTenantForEdit(tenant)}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-[11px] font-bold transition-colors inline-flex items-center gap-1"
                      title="Editar Plan y Gracia"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Gestionar</span>
                    </button>

                    {tenant.status !== 'ACTIVE' && (
                      <button
                        onClick={() => handleUpdateTenantStatus(tenant.id, 'ACTIVE')}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold"
                        title="Reactivar Suscripción"
                      >
                        Reactivar
                      </button>
                    )}

                    {tenant.status === 'ACTIVE' && (
                      <button
                        onClick={() => handleUpdateTenantStatus(tenant.id, 'PAST_DUE', '28/09/2026')}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold"
                        title="Poner en Periodo de Gracia (5 días)"
                      >
                        Gracia
                      </button>
                    )}

                    {tenant.status !== 'CANCELLED' && (
                      <button
                        onClick={() => handleUpdateTenantStatus(tenant.id, 'CANCELLED')}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold"
                        title="Suspender Acceso"
                      >
                        Suspender
                      </button>
                    )}

                    <button
                      onClick={() => onSelectTenant(tenant)}
                      className="px-2.5 py-1 bg-stone-900 text-white rounded-lg text-[10px] font-bold hover:bg-stone-800"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-stone-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  Gestionar Suscripción: {selectedTenantForEdit.name}
                </h3>
                <p className="text-xs text-stone-500">
                  Cédula {selectedTenantForEdit.cedulaJuridica} • {selectedTenantForEdit.location}
                </p>
              </div>
              <button
                onClick={() => setSelectedTenantForEdit(null)}
                className="p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Plan Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-700 uppercase">
                Plan Asignado SaborAI:
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                {[
                  { id: 'express', label: 'Express', price: '₡22,000' },
                  { id: 'pro', label: 'Pro', price: '₡45,000' },
                  { id: 'multibranch', label: 'Multisucursal', price: '₡85,000+' }
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleChangePlan(selectedTenantForEdit.id, p.id as SubscriptionPlan)}
                    className={`p-3 rounded-2xl border text-center transition-all ${
                      selectedTenantForEdit.plan === p.id
                        ? 'bg-stone-900 text-white border-stone-900 shadow-xs ring-2 ring-stone-900/10'
                        : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    <div>{p.label}</div>
                    <div className="text-[11px] font-black mt-0.5">{p.price}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Status Selector & Grace Period */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-700 uppercase">
                Estado de la Cuenta:
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'ACTIVE')}
                  className={`py-2.5 rounded-xl border transition-colors ${
                    selectedTenantForEdit.status === 'ACTIVE'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  ✓ Activo
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'PAST_DUE', '30/09/2026')}
                  className={`py-2.5 rounded-xl border transition-colors ${
                    selectedTenantForEdit.status === 'PAST_DUE'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  ⏳ Gracia (5 días)
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateTenantStatus(selectedTenantForEdit.id, 'CANCELLED')}
                  className={`py-2.5 rounded-xl border transition-colors ${
                    selectedTenantForEdit.status === 'CANCELLED'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                >
                  ✕ Suspendido
                </button>
              </div>
            </div>

            {/* Quick Actions for SuperAdmin */}
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 space-y-2">
              <span className="text-xs font-bold text-stone-700 uppercase block">Acciones Rápidas:</span>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    alert(`Enlace de cobro Tilopay generado para ${selectedTenantForEdit.name}: https://checkout.tilopay.me/pay/saborai_${selectedTenantForEdit.id}`);
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-stone-200 border border-stone-200 rounded-xl font-bold text-stone-800 flex items-center gap-1 shadow-2xs"
                >
                  <CreditCard className="w-3.5 h-3.5 text-[#588157]" />
                  <span>Generar Link Tilopay</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleUpdateTenantStatus(selectedTenantForEdit.id, 'ACTIVE');
                    alert(`Pago SINPE Móvil registrado. La cuenta de ${selectedTenantForEdit.name} está activa.`);
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-stone-200 border border-stone-200 rounded-xl font-bold text-stone-800 flex items-center gap-1 shadow-2xs"
                >
                  <Smartphone className="w-3.5 h-3.5 text-purple-600" />
                  <span>Registrar Pago SINPE</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTenantForEdit(null)}
                className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 shadow-xs"
              >
                Listo / Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
