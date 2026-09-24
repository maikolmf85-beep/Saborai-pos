import React, { useState } from 'react';
import { 
  X, 
  Printer, 
  Boxes, 
  CreditCard, 
  Building2, 
  Globe,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Receipt,
  Check,
  CheckCircle2,
  Info,
  Store,
  Pencil,
  ShieldAlert
} from 'lucide-react';
import { PrinterSettings } from './PrinterSettings';
import { InventoryRecipes } from './InventoryRecipes';
import { SuperAdminBackoffice } from './SuperAdminBackoffice';
import { HaciendaSettings } from './HaciendaSettings';
import { TenantInfo, SubscriptionStatus, TaxRegime } from '../types';
import { cashShiftService } from '../services/cashShiftService';
import { CashRegister } from '../types/cashShift';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
  onUpdateTenant?: (updated: TenantInfo) => void;
  onUpdateTenantStatus: (status: SubscriptionStatus, graceEnds?: string) => void;
  onSelectTenant: (tenant: TenantInfo) => void;
  onNavigateToLanding: () => void;
  onOpenNotion?: () => void;
  onOpenStaffModal?: () => void;
  currentUser?: any;
}

type SettingsSection = 'regime' | 'hacienda' | 'registers' | 'printers' | 'inventory' | 'admin' | 'landing';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  tenant,
  onUpdateTenant,
  onUpdateTenantStatus,
  onSelectTenant,
  onNavigateToLanding,
  onOpenNotion,
  onOpenStaffModal,
  currentUser
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('regime');
  
  // Local form state for business profile & tax regime
  const [selectedRegime, setSelectedRegime] = useState<TaxRegime>(tenant.taxRegime || 'TRADITIONAL');
  const [includeService10, setIncludeService10] = useState<boolean>(tenant.includeService10ByDefault ?? true);
  const [businessName, setBusinessName] = useState(tenant.name);
  const [cedulaJuridica, setCedulaJuridica] = useState(tenant.cedulaJuridica);
  const [email, setEmail] = useState(tenant.email);
  const [phone, setPhone] = useState(tenant.phone);
  const [location, setLocation] = useState(tenant.location);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Multi-Caja state
  const [registersList, setRegistersList] = useState<CashRegister[]>(cashShiftService.getCashRegisters());
  const [currentRegister, setCurrentRegister] = useState<CashRegister>(cashShiftService.getCurrentRegister());
  const [savedRegFeedback, setSavedRegFeedback] = useState<string | null>(null);
  const [isCreatingReg, setIsCreatingReg] = useState(false);
  const [newRegName, setNewRegName] = useState('');
  const [newRegTerminalCode, setNewRegTerminalCode] = useState('');
  const [newRegBranchCode, setNewRegBranchCode] = useState('001');
  const [newRegAllowsBilling, setNewRegAllowsBilling] = useState(true);
  const [newRegAllowsOrdering, setNewRegAllowsOrdering] = useState(true);

  // Edit register state
  const [editingRegister, setEditingRegister] = useState<CashRegister | null>(null);
  const [editRegName, setEditRegName] = useState('');
  const [editRegTerminalCode, setEditRegTerminalCode] = useState('');
  const [editRegBranchCode, setEditRegBranchCode] = useState('001');
  const [editRegAllowsBilling, setEditRegAllowsBilling] = useState(true);
  const [editRegAllowsOrdering, setEditRegAllowsOrdering] = useState(true);

  const handleSelectDeviceRegister = (id: string) => {
    const updated = cashShiftService.setCurrentRegisterId(id);
    setCurrentRegister(updated);
    setRegistersList(cashShiftService.getCashRegisters());
    setSavedRegFeedback(`✓ Esta computadora ahora opera como: ${updated.name}`);
    setTimeout(() => setSavedRegFeedback(null), 3000);
  };

  const handleStartEditRegister = (reg: CashRegister) => {
    setEditingRegister(reg);
    setEditRegName(reg.name);
    setEditRegTerminalCode(reg.terminalCode);
    setEditRegBranchCode(reg.branchCode);
    setEditRegAllowsBilling(reg.allowsBilling);
    setEditRegAllowsOrdering(reg.allowsOrdering);
    setIsCreatingReg(false);
  };

  const handleSaveEditRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRegister || !editRegName.trim()) return;

    const updated = cashShiftService.updateCashRegister(editingRegister.id, {
      name: editRegName,
      terminalCode: editRegTerminalCode,
      branchCode: editRegBranchCode,
      allowsBilling: editRegAllowsBilling,
      allowsOrdering: editRegAllowsOrdering
    });

    setRegistersList(cashShiftService.getCashRegisters());
    setCurrentRegister(cashShiftService.getCurrentRegister());
    setEditingRegister(null);
    setSavedRegFeedback(`✓ Caja "${updated.name}" actualizada con éxito`);
    setTimeout(() => setSavedRegFeedback(null), 3000);
  };

  const handleCreateRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRegName.trim() || !newRegTerminalCode.trim()) return;

    cashShiftService.createCashRegister({
      name: newRegName,
      terminalCode: newRegTerminalCode,
      branchCode: newRegBranchCode,
      allowsBilling: newRegAllowsBilling,
      allowsOrdering: newRegAllowsOrdering
    });

    setRegistersList(cashShiftService.getCashRegisters());
    setIsCreatingReg(false);
    setNewRegName('');
    setNewRegTerminalCode('');
    setSavedRegFeedback('✓ Nueva caja registrada con éxito');
    setTimeout(() => setSavedRegFeedback(null), 3000);
  };

  const handleDeleteRegister = (id: string) => {
    try {
      cashShiftService.deleteCashRegister(id);
      setRegistersList(cashShiftService.getCashRegisters());
      setCurrentRegister(cashShiftService.getCurrentRegister());
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveTaxConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateTenant) return;

    const updated: TenantInfo = {
      ...tenant,
      name: businessName,
      cedulaJuridica,
      email,
      phone,
      location,
      taxRegime: selectedRegime,
      includeService10ByDefault: includeService10
    };

    onUpdateTenant(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-stone-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200/80 flex items-center justify-between bg-stone-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center font-bold">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-stone-900">Ajustes & Herramientas SaborAI</h2>
              <p className="text-xs text-stone-500">Configuración general de periféricos, inventarios y régimen fiscal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-white border border-stone-200 rounded-xl text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-[#588157]" />
              <span className="font-semibold text-stone-800">{tenant.name}</span>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
              title="Cerrar ajustes"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-stone-200 flex items-center gap-2 overflow-x-auto bg-white scrollbar-none">
          <button
            onClick={() => setActiveSection('regime')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeSection === 'regime'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Receipt className="w-4 h-4 text-[#588157]" />
            <span>Perfil & Régimen Tributario</span>
          </button>

          <button
            onClick={() => setActiveSection('hacienda')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeSection === 'hacienda'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-[#588157]" />
            <span>Facturación Hacienda (ATV & .p12)</span>
          </button>

          <button
            onClick={() => setActiveSection('registers')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeSection === 'registers'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Store className="w-4 h-4 text-[#588157]" />
            <span>Cajas & Terminales Multi-PC</span>
          </button>

          <button
            onClick={() => setActiveSection('printers')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeSection === 'printers'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Printer className="w-4 h-4 text-[#588157]" />
            <span>Impresoras Térmicas</span>
          </button>

          <button
            onClick={() => setActiveSection('inventory')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeSection === 'inventory'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Boxes className="w-4 h-4 text-[#588157]" />
            <span>Inventario & Recetas</span>
          </button>

          {currentUser?.email === 'maikolmf85@gmail.com' && (
            <>
              <button
                onClick={() => setActiveSection('admin')}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                  activeSection === 'admin'
                    ? 'border-stone-900 text-stone-900'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                <Building2 className="w-4 h-4 text-[#588157]" />
                <span>SaaS Backoffice</span>
              </button>

              <button
                onClick={() => setActiveSection('landing')}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                  activeSection === 'landing'
                    ? 'border-stone-900 text-stone-900'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                <Globe className="w-4 h-4 text-[#588157]" />
                <span>Landing Comercial</span>
              </button>
            </>
          )}

          <div className="ml-auto flex items-center gap-2 my-1 shrink-0">
            {onOpenStaffModal && (
              <button
                onClick={() => {
                  onClose();
                  onOpenStaffModal();
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-stone-700 hover:text-stone-950 bg-stone-100 hover:bg-stone-200 rounded-xl transition-all"
              >
                <Users className="w-3.5 h-3.5 text-stone-600" />
                <span>Personal & Roles</span>
              </button>
            )}

            {onOpenNotion && (
              <button
                onClick={() => {
                  onClose();
                  onOpenNotion();
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-stone-800 hover:text-stone-950 bg-stone-100 hover:bg-stone-200 rounded-xl transition-all"
              >
                <span className="w-3.5 h-3.5 rounded-md bg-stone-900 text-white font-serif font-black text-[10px] flex items-center justify-center">N</span>
                <span>Notion</span>
              </button>
            )}
          </div>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto bg-stone-50/40 p-4 sm:p-6">
          {activeSection === 'regime' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <form onSubmit={handleSaveTaxConfig} className="space-y-6">
                
                {/* Section Header */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-[#588157]/10 text-[#588157] flex items-center justify-center font-bold">
                        <Store className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-stone-900">
                          Régimen Tributario & Parámetros Fiscales
                        </h3>
                        <p className="text-xs text-stone-500">
                          Normativa del Ministerio de Hacienda de Costa Rica y Ley N° 4946 de Servicio de Mesa
                        </p>
                      </div>
                    </div>

                    <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
                      <span>Régimen actual:</span>
                      <strong className="text-[#588157]">
                        {selectedRegime === 'SIMPLIFIED' ? 'Simplificado' : 'Tradicional (Normal)'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* 1. Selector de Régimen Tributario */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                      1. Modalidad Tributaria del Establecimiento
                    </label>
                    <span className="text-[11px] text-stone-500">Selecciona el tipo de registro ante Tributación</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Card 1: Régimen Tradicional / Normal */}
                    <div
                      onClick={() => setSelectedRegime('TRADITIONAL')}
                      className={`cursor-pointer rounded-2xl p-5 border-2 transition-all relative flex flex-col justify-between ${
                        selectedRegime === 'TRADITIONAL'
                          ? 'border-stone-900 bg-white shadow-md ring-2 ring-stone-900/10'
                          : 'border-stone-200 bg-white/70 hover:border-stone-300 hover:bg-white'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              selectedRegime === 'TRADITIONAL' ? 'border-stone-900 bg-stone-900' : 'border-stone-300'
                            }`}>
                              {selectedRegime === 'TRADITIONAL' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <h4 className="font-bold text-sm text-stone-900">Régimen Tradicional (Normal)</h4>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                            Factura v4.3
                          </span>
                        </div>

                        <p className="text-xs text-stone-600 leading-relaxed">
                          Régimen general del Ministerio de Hacienda para personas físicas o jurídicas que facturan con desglose formal de impuestos.
                        </p>

                        <div className="space-y-1.5 pt-2 border-t border-stone-100 text-[11px] text-stone-600">
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>IVA 13%:</strong> Se traslada y desglosa en cada consumo.</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>Servicio 10% (Ley 4946):</strong> Calculado en servicio de salón.</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>Documento:</strong> Tiquete o Factura Electrónica v4.3 con clave 50 dígitos y QR.</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] font-semibold text-stone-500">
                        <span>Fórmula:</span>
                        <code className="text-stone-800 bg-stone-100 px-2 py-0.5 rounded">Subtotal + 13% IVA + 10% Serv</code>
                      </div>
                    </div>

                    {/* Card 2: Régimen Simplificado */}
                    <div
                      onClick={() => setSelectedRegime('SIMPLIFIED')}
                      className={`cursor-pointer rounded-2xl p-5 border-2 transition-all relative flex flex-col justify-between ${
                        selectedRegime === 'SIMPLIFIED'
                          ? 'border-[#588157] bg-emerald-50/20 shadow-md ring-2 ring-[#588157]/20'
                          : 'border-stone-200 bg-white/70 hover:border-stone-300 hover:bg-white'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              selectedRegime === 'SIMPLIFIED' ? 'border-[#588157] bg-[#588157]' : 'border-stone-300'
                            }`}>
                              {selectedRegime === 'SIMPLIFIED' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <h4 className="font-bold text-sm text-stone-900">Régimen Simplificado</h4>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            0% IVA Consumo
                          </span>
                        </div>

                        <p className="text-xs text-stone-600 leading-relaxed">
                          Diseñado para sodas, cafeterías, bares pequeños y pequeños restaurantes que tributan sobre compras según parámetros DGT.
                        </p>

                        <div className="space-y-1.5 pt-2 border-t border-stone-100 text-[11px] text-stone-600">
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>0% IVA al comensal:</strong> No se cobra el 13% en comandas ni facturas.</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>Servicio 10% (Ley 4946):</strong> Continúa obligatorio por ley en mesas.</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#588157] shrink-0" />
                            <span><strong>Documento:</strong> Comprobante de Régimen Simplificado para cliente.</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] font-semibold text-stone-500">
                        <span>Fórmula:</span>
                        <code className="text-[#588157] bg-emerald-100/60 px-2 py-0.5 rounded font-bold">Subtotal + 10% Servicio</code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Configuración de Servicio de Mesa Ley 4946 */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-3">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-[#588157]" />
                    <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                      2. Impuesto del 10% de Servicio a la Mesa (Ley N° 4946 de Costa Rica)
                    </h4>
                  </div>

                  <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>¿Qué establece la Ley N° 4946?</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed pl-5.5">
                      Establece un cargo obligatorio del 10% en concepto de propina sobre las cuentas de restaurantes, bares y sodas cuando el consumo se realice dentro del local en mesas o barras. Este 10% es distribuido por el empleador entre el personal de salón (meseros y saloneros). Aplica indistintamente en Régimen Tradicional y Régimen Simplificado.
                    </p>
                  </div>

                  <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl border border-stone-200/80 cursor-pointer hover:bg-stone-100/60 transition-colors">
                    <input
                      type="checkbox"
                      checked={includeService10}
                      onChange={(e) => setIncludeService10(e.target.checked)}
                      className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-[#588157]"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-stone-900 block">
                        Cálculo automático del 10% de Servicio en mesas por defecto
                      </span>
                      <span className="text-[11px] text-stone-500">
                        Se calculará automáticamente en comandas vivas, cobro rápido y módulo de facturación para mesas de salón.
                      </span>
                    </div>
                  </label>
                </div>

                {/* 3. Datos del Comercio / Restaurante */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#588157]" />
                    <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                      3. Datos del Restaurante para Comprobantes
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">Nombre Comercial / Razón Social</label>
                      <input
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/30"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">Cédula Jurídica / Cédula Física</label>
                      <input
                        type="text"
                        value={cedulaJuridica}
                        onChange={(e) => setCedulaJuridica(e.target.value)}
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/30"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">Correo Electrónico de Facturación</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/30"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">Teléfono del Local</label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/30"
                        required
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-stone-700 mb-1">Ubicación / Dirección Exacta</label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/30"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Save Feedback & Submit Button */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                  <div>
                    {savedSuccess && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#588157] bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 animate-in fade-in">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>¡Configuración fiscal guardada y aplicada al POS con éxito!</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="w-full sm:w-auto px-6 py-3 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md"
                  >
                    <Check className="w-4 h-4 text-[#a9b994]" />
                    <span>Guardar Configuración Tributaria</span>
                  </button>
                </div>

              </form>

              {/* Danger Zone */}
              <div className="mt-8 pt-6 border-t border-stone-200">
                <h4 className="text-sm font-bold text-red-600 flex items-center gap-2 mb-3">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Zona de Peligro</span>
                </h4>
                <div className="bg-red-50/50 border border-red-100 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h5 className="font-bold text-stone-900 text-sm">Cancelar Suscripción</h5>
                    <p className="text-xs text-stone-600 mt-1 max-w-lg">
                      Al cancelar tu plan, perderás el acceso al sistema al finalizar tu periodo actual pagado. Los cobros automáticos se detendrán y tu información dejará de sincronizarse.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('¿Estás seguro que deseas cancelar tu suscripción a Saborai POS? Esta acción detendrá los cobros y limitará tu acceso.')) {
                        onUpdateTenantStatus('CANCELLED');
                        alert('Tu suscripción ha sido cancelada. Mantendrás el acceso hasta el final del periodo de gracia.');
                      }
                    }}
                    className="shrink-0 px-5 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 hover:border-red-300 rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    Finalizar Suscripción
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* Section: Facturación Hacienda ATV & Firma .p12 */}
          {activeSection === 'hacienda' && (
            <div className="animate-in fade-in duration-200">
              <HaciendaSettings 
                tenant={tenant}
                onUpdateTenant={onUpdateTenant}
              />
            </div>
          )}

          {/* Section: Cajas & Terminales Multi-PC */}
          {activeSection === 'registers' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
              
              {/* Header explanation */}
              <div className="border-b border-stone-200 pb-4">
                <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                  <Store className="w-5 h-5 text-[#588157]" />
                  <span>Configuración de Cajas & Terminales Multi-PC</span>
                </h3>
                <p className="text-xs text-stone-500 mt-1">
                  Asigna qué caja física opera esta computadora y administra los puntos de cobro y comandas del restaurante con códigos de terminal independientes para Hacienda CR v4.3.
                </p>
              </div>

              {/* Step 1: Active Terminal on THIS device */}
              <div className="p-5 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/50 shadow-xs space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#2c472c] bg-[#a9b994]/40 px-2.5 py-0.5 rounded-full border border-[#a9b994]">
                      Terminal de este Dispositivo
                    </span>
                    <h4 className="text-base font-bold text-stone-900 mt-1.5 flex items-center gap-2">
                      <span>Esta computadora opera como:</span>
                      <span className="text-[#2c472c] font-black underline decoration-[#588157]">
                        {currentRegister.name} ({currentRegister.terminalCode})
                      </span>
                    </h4>
                    <p className="text-xs text-stone-600 mt-0.5">
                      Todas las facturas, tiquetes y cobros realizados desde esta pantalla quedarán registrados en el turno y consecutivo de esta caja.
                    </p>
                  </div>

                  {savedRegFeedback && (
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-xl animate-in fade-in">
                      {savedRegFeedback}
                    </span>
                  )}
                </div>

                {/* Switcher Radios/Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {registersList.map(reg => {
                    const isSelected = reg.id === currentRegister.id;
                    const shift = cashShiftService.getActiveShift(reg.id);
                    return (
                      <button
                        key={reg.id}
                        type="button"
                        onClick={() => handleSelectDeviceRegister(reg.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all relative ${
                          isSelected
                            ? 'bg-white border-[#588157] ring-2 ring-[#588157]/20 shadow-sm'
                            : 'bg-white/60 border-stone-200 hover:bg-white hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-stone-900">{reg.name}</span>
                          <span className={`w-2 h-2 rounded-full ${shift ? 'bg-emerald-500 animate-pulse' : 'bg-stone-300'}`} title={shift ? 'Turno abierto' : 'Turno cerrado'} />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-stone-500 font-medium">
                          <span>Terminal DGT: <strong className="text-stone-800">{reg.terminalCode}</strong></span>
                          <span>•</span>
                          <span>Suc: {reg.branchCode}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px]">
                          <span className={`px-1.5 py-0.2 rounded font-bold ${shift ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
                            {shift ? 'Turno Abierto' : 'Cerrada'}
                          </span>
                          {isSelected && (
                            <span className="font-bold text-[#588157] flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> Activa aquí
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Register Management List & Create */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-stone-900">Catálogo de Cajas del Negocio</h4>
                    <p className="text-xs text-stone-500">Agrega o edita los puntos de facturación del restaurante</p>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setIsCreatingReg(true)}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                  >
                    <span>+ Nueva Caja / Terminal</span>
                  </button>
                </div>

                {/* Form to Create New Register */}
                {isCreatingReg && (
                  <form onSubmit={handleCreateRegisterSubmit} className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-stone-900 uppercase tracking-wider">Nueva Caja o Terminal POS</h5>
                      <button type="button" onClick={() => setIsCreatingReg(false)} className="text-stone-400 hover:text-stone-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1">Nombre de la Caja *</label>
                        <input
                          type="text"
                          required
                          value={newRegName}
                          onChange={e => setNewRegName(e.target.value)}
                          placeholder="Ej. Caja 4 - Terraza VIP"
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1" title="Código de 5 dígitos para Hacienda Costa Rica">
                          Cód. Terminal DGT (5 dígitos) *
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={newRegTerminalCode}
                          onChange={e => setNewRegTerminalCode(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="00004"
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1">Sucursal (3 dígitos)</label>
                        <input
                          type="text"
                          maxLength={3}
                          value={newRegBranchCode}
                          onChange={e => setNewRegBranchCode(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="001"
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-stone-900"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRegAllowsBilling}
                          onChange={e => setNewRegAllowsBilling(e.target.checked)}
                          className="rounded text-stone-900"
                        />
                        <span className="font-semibold text-stone-700">Habilitar Facturación y Cobro</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRegAllowsOrdering}
                          onChange={e => setNewRegAllowsOrdering(e.target.checked)}
                          className="rounded text-stone-900"
                        />
                        <span className="font-semibold text-stone-700">Habilitar Envío de Comandas</span>
                      </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsCreatingReg(false)}
                        className="px-3 py-1.5 border border-stone-300 text-stone-600 rounded-xl text-xs font-semibold hover:bg-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold"
                      >
                        Guardar Caja
                      </button>
                    </div>
                  </form>
                )}

                {/* Form to Edit Existing Register */}
                {editingRegister && (
                  <form onSubmit={handleSaveEditRegisterSubmit} className="p-4 rounded-xl bg-amber-50/60 border border-amber-300 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pencil className="w-4 h-4 text-amber-800" />
                        <h5 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                          Editar Caja: <span className="text-amber-900">{editingRegister.name}</span>
                        </h5>
                      </div>
                      <button type="button" onClick={() => setEditingRegister(null)} className="text-stone-400 hover:text-stone-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1">Nombre Personalizado de la Caja *</label>
                        <input
                          type="text"
                          required
                          value={editRegName}
                          onChange={e => setEditRegName(e.target.value)}
                          placeholder="Ej. Barra Principal, Caja 1, Terraza, etc."
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1" title="Código de 5 dígitos para Hacienda Costa Rica">
                          Cód. Terminal DGT (5 dígitos) *
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={editRegTerminalCode}
                          onChange={e => setEditRegTerminalCode(e.target.value.replace(/[^0-9]/g, ''))}
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-stone-700 block mb-1">Sucursal (3 dígitos)</label>
                        <input
                          type="text"
                          maxLength={3}
                          value={editRegBranchCode}
                          onChange={e => setEditRegBranchCode(e.target.value.replace(/[^0-9]/g, ''))}
                          className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editRegAllowsBilling}
                          onChange={e => setEditRegAllowsBilling(e.target.checked)}
                          className="rounded text-stone-900"
                        />
                        <span className="font-semibold text-stone-700">Habilitar Facturación y Cobro</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editRegAllowsOrdering}
                          onChange={e => setEditRegAllowsOrdering(e.target.checked)}
                          className="rounded text-stone-900"
                        />
                        <span className="font-semibold text-stone-700">Habilitar Envío de Comandas</span>
                      </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingRegister(null)}
                        className="px-3 py-1.5 border border-stone-300 text-stone-600 rounded-xl text-xs font-semibold hover:bg-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold shadow-xs"
                      >
                        Guardar Cambios
                      </button>
                    </div>
                  </form>
                )}

                {/* Table of registers */}
                <div className="divide-y divide-stone-100 overflow-x-auto">
                  {registersList.map(reg => {
                    const shift = cashShiftService.getActiveShift(reg.id);
                    return (
                      <div key={reg.id} className="py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-stone-100 text-stone-700 flex items-center justify-center font-bold text-xs shrink-0">
                            {reg.terminalCode.slice(-2)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-stone-900">{reg.name}</span>
                              {reg.id === currentRegister.id && (
                                <span className="text-[10px] font-extrabold px-2 py-0.2 rounded-full bg-[#a9b994]/30 text-stone-900 border border-[#a9b994]">
                                  Esta PC
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-stone-500 flex items-center gap-2 mt-0.5">
                              <span>Terminal Hacienda: <strong className="font-mono text-stone-700">{reg.terminalCode}</strong></span>
                              <span>•</span>
                              <span>Sucursal: <strong className="font-mono text-stone-700">{reg.branchCode}</strong></span>
                              <span>•</span>
                              <span>{reg.allowsBilling ? 'Factura y Cobra' : 'Solo Comandero'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            shift 
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                              : 'bg-stone-100 text-stone-600 border-stone-200'
                          }`}>
                            {shift ? `Turno #${shift.shiftNumber} Abierto` : 'Caja Cerrada'}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleStartEditRegister(reg)}
                            className="px-2.5 py-1 rounded-lg text-xs text-stone-700 hover:text-stone-950 hover:bg-stone-100 transition-colors flex items-center gap-1 border border-stone-200"
                            title="Editar nombre y configuración de esta caja"
                          >
                            <Pencil className="w-3.5 h-3.5 text-stone-500" />
                            <span className="font-bold text-[11px]">Editar</span>
                          </button>

                          {registersList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRegister(reg.id)}
                              disabled={!!shift}
                              className={`p-1.5 rounded-lg text-xs transition-colors ${
                                shift
                                  ? 'text-stone-300 cursor-not-allowed'
                                  : 'text-stone-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title={shift ? 'No se puede eliminar con turno abierto' : 'Eliminar caja'}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>

            </div>
          )}

          {activeSection === 'printers' && (
            <div className="bg-white rounded-2xl border border-stone-200 p-2 sm:p-4 shadow-sm">
              <PrinterSettings />
            </div>
          )}

          {activeSection === 'inventory' && (
            <div className="bg-white rounded-2xl border border-stone-200 p-2 sm:p-4 shadow-sm">
              <InventoryRecipes />
            </div>
          )}

          {activeSection === 'admin' && (
            <div className="bg-white rounded-2xl border border-stone-200 p-2 sm:p-4 shadow-sm">
              <SuperAdminBackoffice 
                currentTenant={tenant}
                onSelectTenant={onSelectTenant}
                onOpenNotion={onOpenNotion}
              />
            </div>
          )}

          {activeSection === 'landing' && (
            <div className="max-w-xl mx-auto py-12 text-center space-y-6">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-lg">
                <Globe className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-stone-900">Página Comercial de SaborAI</h3>
                <p className="text-stone-600 text-sm mt-1">
                  Accede a la presentación comercial pública, características del sistema, planes de precios en Costa Rica y registro para nuevos restaurantes.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    onClose();
                    onNavigateToLanding();
                  }}
                  className="w-full sm:w-auto px-6 py-3 bg-stone-900 text-white rounded-xl text-sm font-semibold hover:bg-stone-800 transition-all shadow-md"
                >
                  Abrir Landing Page Completa
                </button>
                <button
                  onClick={onClose}
                  className="w-full sm:w-auto px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-xl text-sm font-semibold hover:bg-stone-50 transition-all"
                >
                  Continuar en el POS
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
