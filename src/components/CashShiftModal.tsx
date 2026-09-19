import React, { useState, useEffect } from 'react';
import { 
  X, 
  Receipt, 
  DollarSign, 
  ArrowDownRight, 
  ArrowUpRight, 
  Clock, 
  User, 
  ShieldCheck, 
  Calculator, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  Sparkles, 
  Printer, 
  FileText,
  CreditCard,
  Smartphone,
  Coins,
  Banknote,
  KeyRound,
  AlertCircle,
  Monitor,
  Building2,
  Layers,
  Store,
  Pencil,
  Plus,
  Check,
  Trash2,
  Lock
} from 'lucide-react';
import { 
  CashShift, 
  CashMovement, 
  CashMovementType, 
  CashDenominationBreakdown, 
  ZReportData,
  CashRegister,
  ConsolidatedZReportData,
  DataphoneClosingEntry
} from '../types/cashShift';
import { UserProfile, TenantInfo } from '../types';
import { cashShiftService } from '../services/cashShiftService';
import { soundService } from '../services/soundEffects';

interface CashShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
  currentUser: UserProfile | null;
  staffList: UserProfile[];
  onOpenZReport: (report: ZReportData) => void;
  onOpenConsolidatedZReport?: (report: ConsolidatedZReportData) => void;
  initialTab?: 'status' | 'movements' | 'close' | 'history' | 'registers';
}

export const CashShiftModal: React.FC<CashShiftModalProps> = ({
  isOpen,
  onClose,
  tenant,
  currentUser,
  staffList,
  onOpenZReport,
  onOpenConsolidatedZReport,
  initialTab
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'movements' | 'close' | 'history' | 'registers'>('status');
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [shiftsHistory, setShiftsHistory] = useState<CashShift[]>([]);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState<string>('');
  const [historyFilterRegisterId, setHistoryFilterRegisterId] = useState<string>('ALL');

  // Opening form state
  const [initialFloatInput, setInitialFloatInput] = useState<number>(50000);
  const [openingNotes, setOpeningNotes] = useState<string>('');
  const [openingCashier, setOpeningCashier] = useState<UserProfile | null>(currentUser);
  const [openingPin, setOpeningPin] = useState<string>('');
  const [openingError, setOpeningError] = useState<string | null>(null);

  // Movement (Egreso/Ingreso) form state
  const [showMovementForm, setShowMovementForm] = useState<boolean>(false);
  const [movementType, setMovementType] = useState<CashMovementType>('OUTFLOW');
  const [movementAmount, setMovementAmount] = useState<number>(10000);
  const [movementReason, setMovementReason] = useState<string>('');
  const [movementAuthorizedBy, setMovementAuthorizedBy] = useState<string>(currentUser?.name || 'Administrador');

  // Arqueo Ciego Form state
  const [denominations, setDenominations] = useState<CashDenominationBreakdown>({
    bills20000: 0,
    bills10000: 0,
    bills5000: 0,
    bills2000: 0,
    bills1000: 0,
    coins500: 0,
    coins100: 0,
    coins50: 0,
    coins25: 0,
    coins10: 0,
    coins5: 0,
    usdCashTotal: 0,
    usdExchangeRate: 515
  });
  
  // 4 Espacios para Ventas en Tarjeta (Multi-Datáfono para Negocios con Múltiples Terminales POS)
  const [dataphones, setDataphones] = useState<DataphoneClosingEntry[]>(() => {
    try {
      const saved = localStorage.getItem('saborai_dataphones_labels');
      if (saved) {
        const labels: string[] = JSON.parse(saved);
        if (Array.isArray(labels) && labels.length === 4) {
          return [
            { id: 'df_1', name: labels[0] || 'Datáfono 1 - BAC Credomatic', amount: 0 },
            { id: 'df_2', name: labels[1] || 'Datáfono 2 - Banco Nacional (BN)', amount: 0 },
            { id: 'df_3', name: labels[2] || 'Datáfono 3 - BCR / Promerica', amount: 0 },
            { id: 'df_4', name: labels[3] || 'Datáfono 4 - Datáfono Móvil / Otro', amount: 0 }
          ];
        }
      }
    } catch {}
    return [
      { id: 'df_1', name: 'Datáfono 1 - BAC Credomatic', amount: 0 },
      { id: 'df_2', name: 'Datáfono 2 - Banco Nacional (BN)', amount: 0 },
      { id: 'df_3', name: 'Datáfono 3 - BCR / Promerica', amount: 0 },
      { id: 'df_4', name: 'Datáfono 4 - Datáfono Móvil / Otro', amount: 0 }
    ];
  });

  const totalDataphonesCounted = dataphones.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  const handleUpdateDataphoneAmount = (index: number, amount: number) => {
    setDataphones(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], amount: Math.max(0, amount) };
      return updated;
    });
  };

  const handleUpdateDataphoneName = (index: number, newName: string) => {
    setDataphones(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name: newName };
      try {
        const labels = updated.map(u => u.name);
        localStorage.setItem('saborai_dataphones_labels', JSON.stringify(labels));
      } catch {}
      return updated;
    });
  };

  const [countedCardsInput, setCountedCardsInput] = useState<number>(0);
  const [countedSinpeInput, setCountedSinpeInput] = useState<number>(0);
  const [differenceJustification, setDifferenceJustification] = useState<string>('');
  const [closeError, setCloseError] = useState<string | null>(null);

  // Multi-Caja Editing and Quick Creation state (must be before any early return)
  const [editingRegisterId, setEditingRegisterId] = useState<string | null>(null);
  const [editRegisterName, setEditRegisterName] = useState<string>('');
  const [editRegisterTerminalCode, setEditRegisterTerminalCode] = useState<string>('');
  const [showAddRegister, setShowAddRegister] = useState<boolean>(false);
  const [newRegisterName, setNewRegisterName] = useState<string>('');
  const [newRegisterTerminalCode, setNewRegisterTerminalCode] = useState<string>('');
  const [newRegisterError, setNewRegisterError] = useState<string | null>(null);

  // Sync active shift on open
  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      const regList = cashShiftService.getCashRegisters();
      setRegisters(regList);
      const curRegId = cashShiftService.getCurrentRegisterId();
      setSelectedRegisterId(curRegId);
      refreshData(curRegId);
      if (currentUser) {
        setOpeningCashier(currentUser);
      }
    }
  }, [isOpen, currentUser, initialTab]);

  const refreshData = (regId?: string) => {
    const targetRegId = regId || selectedRegisterId || cashShiftService.getCurrentRegisterId();
    const shift = cashShiftService.getActiveShift(targetRegId);
    setActiveShift(shift);
    setShiftsHistory(cashShiftService.getShiftsHistory());
    setRegisters(cashShiftService.getCashRegisters());
    if (shift) {
      setCountedCardsInput(shift.systemSummary.cardSales);
      setCountedSinpeInput(shift.systemSummary.sinpeSales);
      // Auto-assign to Datáfono 1 if all dataphones are currently 0
      setDataphones(prev => {
        const allZero = prev.every(d => Number(d.amount || 0) === 0);
        if (allZero && shift.systemSummary.cardSales > 0) {
          return prev.map((d, idx) => idx === 0 ? { ...d, amount: shift.systemSummary.cardSales } : d);
        }
        return prev;
      });
    } else {
      setCountedCardsInput(0);
      setCountedSinpeInput(0);
      setDataphones(prev => prev.map(d => ({ ...d, amount: 0 })));
    }
  };

  const handleSelectRegister = (regId: string) => {
    cashShiftService.setCurrentRegisterId(regId);
    setSelectedRegisterId(regId);
    refreshData(regId);
  };

  if (!isOpen) return null;

  // Handlers
  const handleOpenShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOpeningError(null);

    if (!openingCashier) {
      setOpeningError('Selecciona el colaborador responsable de la caja.');
      return;
    }

    // Validate PIN if configured
    const expectedPin = openingCashier.pin || '1234';
    if (openingPin && openingPin !== expectedPin) {
      setOpeningError('PIN de autorización incorrecto.');
      soundService.playErrorBuzz();
      return;
    }

    try {
      const newShift = cashShiftService.openShift(
        tenant,
        openingCashier,
        Number(initialFloatInput),
        openingNotes,
        selectedRegisterId
      );
      soundService.playSuccessChime();
      setActiveShift(newShift);
      setActiveTab('status');
      refreshData(selectedRegisterId);
    } catch (err: any) {
      setOpeningError(err.message || 'Error al abrir caja.');
    }
  };

  const handleAddMovementSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementAmount || movementAmount <= 0) return;
    if (!movementReason.trim()) return;

    try {
      cashShiftService.recordCashMovement(
        movementType,
        Number(movementAmount),
        movementReason.trim(),
        movementAuthorizedBy,
        currentUser?.name || 'Cajero en turno',
        selectedRegisterId
      );
      soundService.playSuccessChime();
      setShowMovementForm(false);
      setMovementReason('');
      setMovementAmount(10000);
      refreshData(selectedRegisterId);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const countedCashTotal = cashShiftService.calculateDenominationsTotal(denominations);

  const handleFinalizeShiftClosing = () => {
    setCloseError(null);

    const closingUser: UserProfile = currentUser || {
      id: activeShift?.openedBy?.userId || 'usr_cajero',
      name: activeShift?.openedBy?.userName || 'Cajero en Turno',
      email: '',
      phone: '',
      restaurantName: tenant.name,
      role: (activeShift?.openedBy?.userRole as any) || 'CAJERO'
    };

    try {
      const { closedShift, zReport } = cashShiftService.closeShift(
        countedCashTotal,
        totalDataphonesCounted,
        Number(countedSinpeInput || 0),
        closingUser,
        denominations,
        differenceJustification,
        selectedRegisterId,
        dataphones
      );

      soundService.playSuccessChime();
      setActiveShift(null);
      refreshData(selectedRegisterId);
      onClose();

      if (zReport && onOpenZReport) {
        onOpenZReport(zReport);
      }
    } catch (err: any) {
      setCloseError(err.message || 'Error al cerrar caja.');
      soundService.playErrorBuzz();
    }
  };

  const handleGenerateConsolidatedReport = () => {
    if (!onOpenConsolidatedZReport) return;
    const report = cashShiftService.generateConsolidatedZReport(tenant);
    onOpenConsolidatedZReport(report);
  };

  // Multi-Caja Editing and Quick Creation handlers
  const handleStartEditRegister = (reg: CashRegister) => {
    setEditingRegisterId(reg.id);
    setEditRegisterName(reg.name);
    setEditRegisterTerminalCode(reg.terminalCode);
  };

  const handleCancelEditRegister = () => {
    setEditingRegisterId(null);
    setEditRegisterName('');
    setEditRegisterTerminalCode('');
  };

  const handleSaveEditRegister = (regId: string) => {
    const trimmed = editRegisterName.trim();
    if (!trimmed) return;
    const cleanCode = editRegisterTerminalCode.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5);
    cashShiftService.updateCashRegister(regId, {
      name: trimmed,
      terminalCode: cleanCode || undefined
    });
    soundService.playSuccessChime();
    setEditingRegisterId(null);
    refreshData(selectedRegisterId);
  };

  const handleCreateQuickRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setNewRegisterError(null);
    const trimmed = newRegisterName.trim();
    if (!trimmed) {
      setNewRegisterError('Indica el nombre deseado para la terminal.');
      return;
    }
    const nextNum = registers.length + 1;
    const cleanCode = newRegisterTerminalCode.replace(/[^0-9]/g, '') || String(nextNum);
    const paddedCode = cleanCode.padStart(5, '0').slice(-5);

    try {
      cashShiftService.createCashRegister({
        name: trimmed,
        terminalCode: paddedCode,
        branchCode: '001',
        allowsBilling: true,
        allowsOrdering: true
      });
      soundService.playSuccessChime();
      setNewRegisterName('');
      setNewRegisterTerminalCode('');
      setShowAddRegister(false);
      refreshData(selectedRegisterId);
    } catch (err: any) {
      setNewRegisterError(err.message || 'Error al crear la terminal');
    }
  };

  const handleDeleteRegister = (regId: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar la terminal "${name}"?`)) return;
    try {
      cashShiftService.deleteCashRegister(regId);
      soundService.playSuccessChime();
      refreshData();
    } catch (err: any) {
      alert(err.message || 'No se pudo eliminar la caja.');
    }
  };

  const currentRegisterObj = registers.find(r => r.id === selectedRegisterId) || registers[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Top Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center font-bold shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">Control de Caja & Turno Multi-Terminal POS</h2>
                {activeShift ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    <span>Turno #{activeShift.shiftNumber} Abierto</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-700 border border-stone-300">
                    Caja Cerrada
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500">
                Apertura con fondo de caja, registro de egresos / ingresos y arqueo ciego con Reporte Z
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Subheader: Active Terminal Selector & Consolidated Z-Report Button */}
        <div className="px-6 py-2.5 bg-stone-100/90 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-stone-600 flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-stone-500" />
              <span>Caja Asignada a esta PC:</span>
            </span>
            <div className="flex items-center gap-1.5">
              <select
                value={selectedRegisterId}
                onChange={(e) => handleSelectRegister(e.target.value)}
                className="px-2.5 py-1 bg-white border border-stone-300 rounded-xl font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#588157]/40 shadow-2xs text-xs"
              >
                {registers.map(r => {
                  const regShift = cashShiftService.getActiveShift(r.id);
                  return (
                    <option key={r.id} value={r.id}>
                      {r.name} (DGT: {r.terminalCode}) — {regShift ? `🟢 Turno #${regShift.shiftNumber}` : '⚪ Cerrada'}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('registers');
                  const target = registers.find(r => r.id === selectedRegisterId);
                  if (target) handleStartEditRegister(target);
                }}
                className="p-1 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors"
                title="Editar nombre de esta terminal"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {onOpenConsolidatedZReport && (
            <button
              type="button"
              onClick={handleGenerateConsolidatedReport}
              className="px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold text-[11px] flex items-center gap-1.5 shadow-xs transition-colors"
              title="Generar reporte Z consolidado sumando todas las cajas del día"
            >
              <FileText className="w-3.5 h-3.5 text-[#a9b994]" />
              <span>Reporte Z Consolidado Multi-Cajas</span>
            </button>
          )}
        </div>

        {/* Modal Navigation Tabs */}
        <div className="px-6 border-b border-stone-200 bg-white flex items-center gap-2 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('status')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'status'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Clock className="w-4 h-4 text-[#588157]" />
            <span>{activeShift ? 'Resumen del Turno' : 'Apertura de Caja'}</span>
          </button>

          <button
            onClick={() => {
              if (activeShift) setActiveTab('movements');
            }}
            disabled={!activeShift}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'movements'
                ? 'border-stone-900 text-stone-900'
                : activeShift
                ? 'border-transparent text-stone-500 hover:text-stone-800'
                : 'border-transparent text-stone-300 cursor-not-allowed'
            }`}
          >
            <ArrowDownRight className="w-4 h-4 text-[#588157]" />
            <span>Egresos e Ingresos {activeShift ? `(${activeShift.movements.length})` : ''}</span>
          </button>

          <button
            onClick={() => {
              if (activeShift) setActiveTab('close');
            }}
            disabled={!activeShift}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 my-1 rounded-xl text-xs font-black transition-all shrink-0 ${
              activeTab === 'close'
                ? 'bg-amber-500 text-stone-950 shadow-xs ring-2 ring-amber-400'
                : activeShift
                ? 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-300 shadow-2xs'
                : 'text-stone-300 border border-transparent cursor-not-allowed opacity-50'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Cerrar Turno & Caja</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ${
              activeTab === 'history'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <History className="w-4 h-4 text-stone-500" />
            <span>Historial de Turnos</span>
          </button>

          <button
            onClick={() => setActiveTab('registers')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all shrink-0 ml-auto ${
              activeTab === 'registers'
                ? 'border-stone-900 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Layers className="w-4 h-4 text-emerald-600" />
            <span className="font-bold">Panel Multi-Cajas</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1">
          
          {/* ======================================================== */}
          {/* STATE A: TAB STATUS WITH NO SHIFT OPEN -> APERTURA FORM  */}
          {/* ======================================================== */}
          {activeTab === 'status' && !activeShift && (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-3xl bg-[#588157]/15 text-[#588157] flex items-center justify-center mx-auto mb-2">
                  <DollarSign className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-stone-900">
                  Apertura de Turno: {currentRegisterObj?.name || 'Caja'}
                </h3>
                <div className="flex items-center justify-center gap-2 text-xs text-stone-500">
                  <span className="font-mono bg-stone-200 px-2 py-0.5 rounded text-stone-800 font-bold">
                    Terminal DGT: {currentRegisterObj?.terminalCode || '00001'}
                  </span>
                  <span>•</span>
                  <span>Sucursal: {currentRegisterObj?.branchCode || '001'}</span>
                </div>
                <p className="text-xs text-stone-500 pt-1">
                  Ingresa el fondo inicial en efectivo (base para dar vuelto) para iniciar la operación en esta caja.
                </p>
              </div>

              <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
                
                {/* 1. Responsable */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1.5">
                    1. Colaborador Responsable de la Caja:
                  </label>
                  <select
                    value={openingCashier?.id || ''}
                    onChange={(e) => {
                      const found = staffList.find(s => s.id === e.target.value);
                      setOpeningCashier(found || null);
                    }}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  >
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} — ({staff.role})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. PIN de Autorización */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1.5 flex items-center gap-1">
                    <KeyRound className="w-3.5 h-3.5 text-stone-400" />
                    <span>2. PIN de Seguridad (4 dígitos):</span>
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    value={openingPin}
                    onChange={(e) => setOpeningPin(e.target.value)}
                    placeholder={`PIN de ${openingCashier?.name.split(' ')[0] || 'usuario'}`}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-sm font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </div>

                {/* 3. Fondo Inicial de Caja */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1.5">
                    3. Fondo de Caja Inicial (Base de Efectivo en Colones):
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-stone-400">₡</span>
                    <input
                      type="number"
                      step={1000}
                      value={initialFloatInput}
                      onChange={(e) => setInitialFloatInput(Number(e.target.value))}
                      className="w-full pl-9 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-lg font-black text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                    />
                  </div>

                  {/* Preset Float Chips */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-stone-400 font-bold uppercase">Preajustes:</span>
                    {[30000, 50000, 75000, 100000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setInitialFloatInput(amount)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors ${
                          initialFloatInput === amount
                            ? 'bg-stone-900 text-white border-stone-900'
                            : 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200'
                        }`}
                      >
                        ₡{(amount / 1000).toFixed(0)}k
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Notas Opcionales */}
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase mb-1.5">
                    4. Observaciones de Apertura (Opcional):
                  </label>
                  <input
                    type="text"
                    value={openingNotes}
                    onChange={(e) => setOpeningNotes(e.target.value)}
                    placeholder="Ej. Turno de Almuerzo, gaveta 1 limpia con ₡50k en billetes..."
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </div>

                {openingError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{openingError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3.5 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                  <span>Confirmar y Abrir Turno de Caja</span>
                </button>

              </form>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE B1: TAB "STATUS" - RESUMEN EN TIEMPO REAL          */}
          {/* ======================================================== */}
          {activeShift && activeTab === 'status' && (
            <div className="space-y-6">
              
              {/* Top Shift Card */}
              <div className="bg-stone-900 text-white p-5 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold text-[#a9b994] tracking-wider">
                      Turno Activo #{activeShift.shiftNumber}
                    </span>
                    <span className="text-xs text-stone-400">•</span>
                    <span className="text-xs text-stone-300 font-mono">{activeShift.terminalId}</span>
                  </div>
                  <h3 className="text-xl font-black">Cajero: {activeShift.openedBy.userName}</h3>
                  <p className="text-xs text-stone-400">
                    Abierto hoy a las {new Date(activeShift.openedAt).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowMovementForm(true)}
                    className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-white text-xs font-bold rounded-xl transition-all border border-stone-700 flex items-center gap-1.5 shadow-xs"
                  >
                    <ArrowDownRight className="w-3.5 h-3.5 text-amber-400" />
                    <span>Registrar Egreso / Ingreso</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('close')}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-black rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer ring-2 ring-amber-300/80"
                  >
                    <Lock className="w-3.5 h-3.5 text-stone-950" />
                    <span>Cerrar Turno y Caja</span>
                  </button>
                </div>
              </div>

              {/* Financial Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-stone-400 uppercase">Fondo Inicial</span>
                  <div className="text-lg font-black text-stone-900">
                    ₡{activeShift.initialCashFloat.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-stone-500">Base para dar cambio</span>
                </div>

                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                    <span>Ventas Efectivo</span>
                  </span>
                  <div className="text-lg font-black text-emerald-950">
                    ₡{activeShift.systemSummary.cashSales.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-emerald-700">Entrado a gaveta</span>
                </div>

                <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-blue-800 uppercase">Tarjetas & Datáfono</span>
                  <div className="text-lg font-black text-blue-950">
                    ₡{activeShift.systemSummary.cardSales.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-blue-700">Lote de datáfono</span>
                </div>

                <div className="p-4 bg-purple-50/60 border border-purple-200 rounded-2xl space-y-1">
                  <span className="text-[11px] font-bold text-purple-800 uppercase">SINPE Móvil</span>
                  <div className="text-lg font-black text-purple-950">
                    ₡{activeShift.systemSummary.sinpeSales.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-purple-700">Transferencias recibidas</span>
                </div>
              </div>

              {/* Cash Drawer Expected Balance Banner */}
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center font-bold">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-amber-900 uppercase">
                      Efectivo Teórico Esperado en Gaveta:
                    </span>
                    <div className="text-xl font-black text-stone-900">
                      ₡{activeShift.systemSummary.expectedCashInDrawer.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="text-right text-xs text-amber-800 space-y-0.5">
                  <div>(+) Fondo: ₡{activeShift.initialCashFloat.toLocaleString()}</div>
                  <div>(+) Ventas: ₡{activeShift.systemSummary.cashSales.toLocaleString()}</div>
                  {activeShift.systemSummary.totalOutflows > 0 && (
                    <div className="text-rose-700 font-bold">
                      (-) Egresos: -₡{activeShift.systemSummary.totalOutflows.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Movements List in Status */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                    Últimos Egresos e Ingresos del Turno:
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowMovementForm(true)}
                    className="text-xs text-[#588157] font-bold hover:underline"
                  >
                    + Nuevo Movimiento
                  </button>
                </div>

                {activeShift.movements.length === 0 ? (
                  <div className="p-4 text-center text-xs text-stone-400 bg-stone-50 rounded-2xl border border-stone-200">
                    No se han registrado egresos ni ingresos de efectivo en este turno.
                  </div>
                ) : (
                  <div className="border border-stone-200 rounded-2xl divide-y divide-stone-100 overflow-hidden text-xs">
                    {activeShift.movements.slice(-3).reverse().map((m) => (
                      <div key={m.id} className="p-3 flex items-center justify-between hover:bg-stone-50">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            m.type === 'OUTFLOW' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {m.type === 'OUTFLOW' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-bold text-stone-900">{m.reason}</div>
                            <div className="text-[10px] text-stone-400">
                              Autorizado por: {m.authorizedBy} • {new Date(m.timestamp).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        <div className={`font-black ${m.type === 'OUTFLOW' ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {m.type === 'OUTFLOW' ? '-' : '+'}₡{m.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prominent Shift Finalization Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-850 to-stone-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg border border-stone-700/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white flex items-center gap-2">
                      <span>Cierre de Turno y Caja</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-stone-950 font-black uppercase tracking-wider">
                        {currentRegisterObj.name}
                      </span>
                    </h4>
                    <p className="text-xs text-stone-300 mt-0.5">
                      Ingresa el efectivo contado en gaveta (Arqueo Ciego), concilia datáfonos y emite el Reporte Z oficial.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const tempZ = cashShiftService.generateZReport(activeShift, tenant);
                      onOpenZReport(tempZ);
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 bg-stone-850 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer border border-stone-700 shadow-xs"
                    title="Imprimir comprobante preliminar de arqueo en la impresora térmica"
                  >
                    <Printer className="w-4 h-4 text-[#a9b994]" />
                    <span>Imprimir Corte</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('close')}
                    className="w-full sm:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-black rounded-xl transition-all shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer ring-2 ring-amber-300/60"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Realizar Cierre de Caja</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* STATE B2: TAB "MOVEMENTS" - EGRESOS E INGRESOS COMPLETOS */}
          {/* ======================================================== */}
          {activeShift && activeTab === 'movements' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Registro de Egresos e Ingresos</h3>
                  <p className="text-xs text-stone-500">
                    Egresos para caja fuerte, compras de emergencia de cocina o ingresos para inyecciones de cambio.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowMovementForm(true)}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <ArrowDownRight className="w-3.5 h-3.5 text-amber-400" />
                  <span>Registrar Movimiento</span>
                </button>
              </div>

              {activeShift.movements.length === 0 ? (
                <div className="p-8 text-center text-xs text-stone-400 bg-stone-50 rounded-2xl border border-stone-200">
                  Aún no se registran movimientos de egresos ni ingresos en este turno.
                </div>
              ) : (
                <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-100 text-stone-600 font-bold border-b border-stone-200">
                      <tr>
                        <th className="px-4 py-2.5">Hora</th>
                        <th className="px-4 py-2.5">Tipo</th>
                        <th className="px-4 py-2.5">Motivo / Justificación</th>
                        <th className="px-4 py-2.5">Autorizado Por</th>
                        <th className="px-4 py-2.5 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 bg-white">
                      {activeShift.movements.map((mov) => (
                        <tr key={mov.id} className="hover:bg-stone-50">
                          <td className="px-4 py-2.5 text-stone-500">
                            {new Date(mov.timestamp).toLocaleTimeString('es-CR')}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              mov.type === 'OUTFLOW' 
                                ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {mov.type === 'OUTFLOW' ? 'Egreso (Salida)' : 'Ingreso (Entrada)'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-bold text-stone-900">{mov.reason}</td>
                          <td className="px-4 py-2.5 text-stone-600">{mov.authorizedBy}</td>
                          <td className={`px-4 py-2.5 text-right font-black ${
                            mov.type === 'OUTFLOW' ? 'text-rose-700' : 'text-emerald-700'
                          }`}>
                            {mov.type === 'OUTFLOW' ? '-' : '+'}₡{mov.amount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* STATE B2b: TAB "MOVEMENTS" WITHOUT ACTIVE SHIFT */}
          {activeTab === 'movements' && !activeShift && (
            <div className="py-12 px-4 max-w-md mx-auto text-center space-y-4 animate-in fade-in">
              <div className="w-16 h-16 bg-stone-100 text-stone-600 rounded-3xl flex items-center justify-center mx-auto shadow-xs">
                <ArrowDownRight className="w-8 h-8 text-stone-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">Sin Turno Activo para Movimientos</h3>
                <p className="text-xs text-stone-500">
                  Para registrar entradas o salidas de efectivo en {currentRegisterObj?.name || 'esta caja'}, primero debes abrir el turno.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('status')}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Abrir Turno Ahora</span>
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE B3: TAB "CLOSE" - ARQUEO CIEGO & CIERRE DE CAJA    */}
          {/* ======================================================== */}
          {activeShift && activeTab === 'close' && (
            <div className="space-y-5 max-w-2xl mx-auto">
              
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Protocolo de Arqueo Ciego:</strong>
                  Cuenta y digita los billetes y monedas físicos en la gaveta. Al confirmar, el sistema comparará automáticamente contra las ventas registradas y emitirá el <strong>Reporte Z</strong>.
                </div>
              </div>

              {/* Billetes de Costa Rica */}
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3">
                <h4 className="text-xs font-bold text-stone-800 uppercase flex items-center gap-1.5">
                  <Banknote className="w-4 h-4 text-[#588157]" />
                  <span>Billetes en Colones (CRC):</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[
                    { key: 'bills20000', label: '₡20,000', val: 20000 },
                    { key: 'bills10000', label: '₡10,000', val: 10000 },
                    { key: 'bills5000',  label: '₡5,000',  val: 5000 },
                    { key: 'bills2000',  label: '₡2,000',  val: 2000 },
                    { key: 'bills1000',  label: '₡1,000',  val: 1000 }
                  ].map((bill) => (
                    <div key={bill.key} className="bg-white p-2 rounded-xl border border-stone-200 flex items-center justify-between">
                      <span className="font-bold text-stone-700">{bill.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={(denominations as any)[bill.key] || ''}
                        onChange={(e) => {
                          const count = Math.max(0, parseInt(e.target.value) || 0);
                          setDenominations(prev => ({ ...prev, [bill.key]: count }));
                        }}
                        placeholder="0"
                        className="w-14 px-2 py-1 text-right font-bold bg-stone-50 border border-stone-200 rounded-lg text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Monedas de Costa Rica */}
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3">
                <h4 className="text-xs font-bold text-stone-800 uppercase flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-600" />
                  <span>Monedas en Colones (CRC):</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[
                    { key: 'coins500', label: '₡500', val: 500 },
                    { key: 'coins100', label: '₡100', val: 100 },
                    { key: 'coins50',  label: '₡50',  val: 50 },
                    { key: 'coins25',  label: '₡25',  val: 25 },
                    { key: 'coins10',  label: '₡10',  val: 10 },
                    { key: 'coins5',   label: '₡5',   val: 5 }
                  ].map((coin) => (
                    <div key={coin.key} className="bg-white p-2 rounded-xl border border-stone-200 flex items-center justify-between">
                      <span className="font-bold text-stone-700">{coin.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={(denominations as any)[coin.key] || ''}
                        onChange={(e) => {
                          const count = Math.max(0, parseInt(e.target.value) || 0);
                          setDenominations(prev => ({ ...prev, [coin.key]: count }));
                        }}
                        placeholder="0"
                        className="w-14 px-2 py-1 text-right font-bold bg-stone-50 border border-stone-200 rounded-lg text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ======================================================== */}
              {/* ARQUEO DE TARJETAS: 4 ESPACIOS PARA MÚLTIPLES DATÁFONOS  */}
              {/* ======================================================== */}
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3.5 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-2.5">
                  <div>
                    <h4 className="text-xs font-bold text-stone-900 uppercase flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <span>Cierre de Lotes Multi-Datáfono (4 Terminales):</span>
                    </h4>
                    <p className="text-[11px] text-stone-500">
                      Digita el total de voucher/lote de cada datáfono. Haz clic en el nombre para personalizarlo a tu banco.
                    </p>
                  </div>

                  {activeShift?.systemSummary?.cardSales ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDataphones(prev => prev.map((d, i) => i === 0 ? { ...d, amount: activeShift.systemSummary.cardSales } : { ...d, amount: 0 }));
                      }}
                      className="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
                      title="Asignar el total de ventas de tarjeta del sistema al Datáfono 1"
                    >
                      <Sparkles className="w-3 h-3 text-blue-600" />
                      <span>Auto-llenar D1 (₡{activeShift.systemSummary.cardSales.toLocaleString()})</span>
                    </button>
                  ) : null}
                </div>

                {/* Grid con los 4 Espacios de Datáfono */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {dataphones.map((df, idx) => {
                    const styles = [
                      { border: 'border-blue-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-400', badge: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500', label: 'D1' },
                      { border: 'border-emerald-200 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-400', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', label: 'D2' },
                      { border: 'border-amber-200 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-400', badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', label: 'D3' },
                      { border: 'border-purple-200 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-400', badge: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500', label: 'D4' }
                    ];
                    const st = styles[idx % styles.length];

                    return (
                      <div key={df.id} className={`bg-white p-3 rounded-xl border ${st.border} shadow-2xs space-y-2 transition-all`}>
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                            <input
                              type="text"
                              value={df.name}
                              onChange={(e) => handleUpdateDataphoneName(idx, e.target.value)}
                              className="text-[11px] font-bold text-stone-800 bg-transparent hover:bg-stone-50 focus:bg-stone-50 rounded px-1.5 py-0.5 border border-transparent focus:border-stone-300 w-full truncate cursor-pointer focus:cursor-text"
                              title="Haz clic para personalizar el nombre de este datáfono (ej. BAC Barra, BN Salón)"
                            />
                          </div>
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${st.badge} shrink-0`}>
                            {st.label}
                          </span>
                        </div>

                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-xs font-black text-stone-400 select-none">₡</span>
                          <input
                            type="number"
                            min={0}
                            value={df.amount === 0 ? '' : df.amount}
                            onChange={(e) => handleUpdateDataphoneAmount(idx, Math.max(0, parseFloat(e.target.value) || 0))}
                            placeholder="0"
                            className="w-full pl-7 pr-3 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs font-black text-stone-900 text-right focus:bg-white outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Resumen Comparativo de Tarjetas y Cuadre de Lotes */}
                <div className="p-3 bg-white rounded-xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-stone-500 uppercase block">Total Tarjetas Declarado (Suma de los 4 Datáfonos):</span>
                    <div className="text-base font-black text-blue-700">
                      ₡{totalDataphonesCounted.toLocaleString()}
                    </div>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="text-[10px] text-stone-500 block">
                      Ventas Tarjetas en Sistema: <strong className="text-stone-800">₡{(activeShift?.systemSummary?.cardSales ?? 0).toLocaleString()}</strong>
                    </span>
                    {(() => {
                      const expectedCard = activeShift?.systemSummary?.cardSales ?? 0;
                      const cardDiff = totalDataphonesCounted - expectedCard;
                      if (cardDiff === 0) {
                        return <span className="text-[11px] font-bold text-emerald-700">✓ Lotes de Datáfonos Cuadrados (Exacto ₡0)</span>;
                      } else if (cardDiff < 0) {
                        return <span className="text-[11px] font-bold text-rose-700">⚠ Faltante en Lotes: -₡{Math.abs(cardDiff).toLocaleString()}</span>;
                      } else {
                        return <span className="text-[11px] font-bold text-amber-700">ℹ Sobrante en Lotes: +₡{cardDiff.toLocaleString()}</span>;
                      }
                    })()}
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/* CONTEO DE TRANSFERENCIAS SINPE MÓVIL                     */}
              {/* ======================================================== */}
              <div className="p-3.5 bg-stone-50 rounded-2xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
                <div className="space-y-0.5">
                  <label className="font-bold text-stone-800 flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-purple-600" />
                    <span>Total SINPE Móvil (Comprobantes Bancarios):</span>
                  </label>
                  <p className="text-[11px] text-stone-500">
                    Suma total de comprobantes de SINPE recibidos en caja durante el turno.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-black text-stone-400 select-none">₡</span>
                  <input
                    type="number"
                    min={0}
                    value={countedSinpeInput === 0 ? '' : countedSinpeInput}
                    onChange={(e) => setCountedSinpeInput(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    className="w-36 px-3 py-1.5 bg-white border border-stone-200 rounded-xl text-xs font-black text-stone-900 text-right focus:ring-1 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>

              {/* Resumen de Efectivo Declarado */}
              <div className="p-4 bg-stone-900 text-white rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-xs text-stone-400 uppercase font-bold">Total Efectivo Declarado:</span>
                  <div className="text-2xl font-black text-[#a9b994]">
                    ₡{countedCashTotal.toLocaleString()}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-stone-400 block">Cierre por:</span>
                  <strong className="text-xs text-white">{currentUser?.name}</strong>
                </div>
              </div>

              {/* Justificación opcional en caso de descuadre */}
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase mb-1">
                  Observación o Justificación de Cierre (Opcional):
                </label>
                <input
                  type="text"
                  value={differenceJustification}
                  onChange={(e) => setDifferenceJustification(e.target.value)}
                  placeholder="Ej. Cierre exacto sin incidentes / Error de vuelto reportado..."
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs"
                />
              </div>

              {closeError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-bold">
                  {closeError}
                </div>
              )}

              <button
                type="button"
                onClick={handleFinalizeShiftClosing}
                className="w-full py-4 bg-stone-900 hover:bg-stone-800 text-white font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
              >
                <CheckCircle2 className="w-5 h-5 text-[#a9b994]" />
                <span>Finalizar Turno y Generar Reporte Z</span>
              </button>

            </div>
          )}

          {/* STATE B3b: TAB "CLOSE" WITHOUT ACTIVE SHIFT */}
          {activeTab === 'close' && !activeShift && (
            <div className="py-12 px-4 max-w-md mx-auto text-center space-y-4 animate-in fade-in">
              <div className="w-16 h-16 bg-amber-100 text-amber-800 rounded-3xl flex items-center justify-center mx-auto shadow-xs">
                <Store className="w-8 h-8 text-amber-700" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">Esta Caja se Encuentra Cerrada</h3>
                <p className="text-xs text-stone-500">
                  No hay ningún turno abierto actualmente en {currentRegisterObj?.name || 'esta terminal'}. Para registrar ventas o arqueos, primero debes abrir el turno.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('status')}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Abrir Turno en esta Caja</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('registers')}
                  className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Monitor className="w-4 h-4" />
                  <span>Ver Panel Multi-Cajas</span>
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE B4: TAB "HISTORY" - TURNOS ANTERIORES              */}
          {/* ======================================================== */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-stone-900">Historial de Turnos Cerrados</h3>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-stone-500">Filtrar por Caja:</span>
                  <select
                    value={historyFilterRegisterId}
                    onChange={(e) => setHistoryFilterRegisterId(e.target.value)}
                    className="px-2.5 py-1 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-800 text-xs"
                  >
                    <option value="ALL">Todas las Cajas ({shiftsHistory.length})</option>
                    {registers.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.terminalCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 text-stone-600 font-bold border-b border-stone-200">
                    <tr>
                      <th className="px-4 py-2.5">Turno #</th>
                      <th className="px-4 py-2.5">Caja / Terminal</th>
                      <th className="px-4 py-2.5">Cajero</th>
                      <th className="px-4 py-2.5">Apertura / Cierre</th>
                      <th className="px-4 py-2.5">Total Ventas</th>
                      <th className="px-4 py-2.5">Estado Cuadre</th>
                      <th className="px-4 py-2.5 text-right">Reporte Z</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {(historyFilterRegisterId === 'ALL'
                      ? shiftsHistory
                      : shiftsHistory.filter(s => s.cashRegisterId === historyFilterRegisterId)
                    ).map((s) => {
                      const diff = s.cashDifference ?? 0;
                      return (
                        <tr key={s.id} className="hover:bg-stone-50">
                          <td className="px-4 py-3 font-bold text-stone-900">#{s.shiftNumber}</td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-stone-800">{s.cashRegisterName || 'Caja 1'}</span>
                            <span className="text-[10px] text-stone-400 font-mono block">DGT: {s.terminalCode || s.terminalId}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">{s.openedBy.userName}</td>
                          <td className="px-4 py-3 text-[11px] text-stone-500">
                            <div>{new Date(s.openedAt).toLocaleDateString('es-CR')}</div>
                            <div>{new Date(s.openedAt).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</div>
                          </td>
                          <td className="px-4 py-3 font-bold text-stone-900">
                            ₡{s.systemSummary.totalSales.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              diff === 0 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : diff < 0 
                                ? 'bg-rose-100 text-rose-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {diff === 0 ? 'Exacto (₡0)' : diff < 0 ? `Faltante -₡${Math.abs(diff)}` : `Sobrante +₡${diff}`}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                const z = cashShiftService.generateZReport(s, tenant);
                                onOpenZReport(z);
                              }}
                              className="px-2.5 py-1 bg-stone-100 hover:bg-stone-900 hover:text-white text-stone-800 rounded-lg text-[11px] font-bold transition-colors inline-flex items-center gap-1"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Ver Z</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE B5: TAB "REGISTERS" - VISTA MULTI-CAJAS GENERAL    */}
          {/* ======================================================== */}
          {activeTab === 'registers' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Terminales y Cajas del Restaurante</h3>
                  <p className="text-xs text-stone-500">
                    Nombra tus terminales a tu gusto y monitorea turnos en tiempo real por cada punto de venta
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddRegister(!showAddRegister);
                      setNewRegisterName('');
                      setNewRegisterTerminalCode(String(registers.length + 1).padStart(5, '0'));
                      setNewRegisterError(null);
                    }}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Nueva Terminal</span>
                  </button>

                  {onOpenConsolidatedZReport && (
                    <button
                      type="button"
                      onClick={handleGenerateConsolidatedReport}
                      className="px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all"
                    >
                      <FileText className="w-4 h-4 text-[#a9b994]" />
                      <span>Reporte Z Consolidado</span>
                    </button>
                  )}
                </div>
              </div>

              {/* QUICK CREATION BANNER */}
              {showAddRegister && (
                <form 
                  onSubmit={handleCreateQuickRegister} 
                  className="bg-emerald-50/90 border border-emerald-300/90 rounded-2xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-150"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-emerald-800" />
                      <h4 className="text-xs font-bold text-emerald-950">Nueva Terminal o Punto de Venta Personalizado</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddRegister(false)}
                      className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {newRegisterError && (
                    <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{newRegisterError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Nombre de la Terminal (Ej: Barra Terraza, Caja Salón 2, Segundo Piso...)
                      </label>
                      <input
                        type="text"
                        value={newRegisterName}
                        onChange={(e) => setNewRegisterName(e.target.value)}
                        placeholder="Ej: Barra Principal, Caja Rápida, Terraza VIP..."
                        required
                        autoFocus
                        className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-semibold text-stone-900 placeholder:text-stone-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Código DGT (5 dígitos)
                      </label>
                      <input
                        type="text"
                        maxLength={5}
                        value={newRegisterTerminalCode}
                        onChange={(e) => setNewRegisterTerminalCode(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="00003"
                        className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-mono font-bold text-stone-900"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddRegister(false)}
                      className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-800 font-semibold"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar Terminal</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {registers.map((reg) => {
                  const regShift = cashShiftService.getActiveShift(reg.id);
                  const isCurrentPcRegister = reg.id === selectedRegisterId;
                  const isEditing = editingRegisterId === reg.id;
                  const canDelete = !reg.isDefault && !regShift && registers.length > 1;

                  return (
                    <div 
                      key={reg.id} 
                      className={`rounded-2xl p-4 border transition-all ${
                        isCurrentPcRegister 
                          ? 'border-emerald-500/80 bg-emerald-50/20 shadow-sm' 
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      {/* CARD HEADER: Normal vs Inline Edit */}
                      {isEditing ? (
                        <div className="space-y-2 mb-3 bg-stone-50 p-2.5 rounded-xl border border-stone-200 animate-in fade-in">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-stone-700 uppercase tracking-wide">
                              Editar Nombre de Terminal
                            </span>
                            <button 
                              type="button" 
                              onClick={handleCancelEditRegister}
                              className="text-stone-400 hover:text-stone-700 p-0.5 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Nombre:</label>
                              <input
                                type="text"
                                value={editRegisterName}
                                onChange={(e) => setEditRegisterName(e.target.value)}
                                placeholder="Ej: Barra Terraza, Caja Salón..."
                                className="w-full px-2.5 py-1 text-xs border border-stone-300 rounded-lg bg-white font-bold text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                autoFocus
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-stone-200">
                              <div className="flex items-center gap-1 text-[10px] text-stone-500 font-mono">
                                <span>DGT:</span>
                                <input
                                  type="text"
                                  maxLength={5}
                                  value={editRegisterTerminalCode}
                                  onChange={(e) => setEditRegisterTerminalCode(e.target.value.replace(/[^0-9]/g, ''))}
                                  className="w-16 px-1.5 py-0.5 text-[10px] border border-stone-300 rounded-md bg-white font-mono font-bold text-stone-800"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={handleCancelEditRegister}
                                  className="px-2 py-1 text-[11px] text-stone-500 hover:text-stone-800 font-semibold"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditRegister(reg.id)}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Guardar</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-stone-100">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-stone-900 truncate" title={reg.name}>
                                {reg.name}
                              </h4>
                              <button
                                type="button"
                                onClick={() => handleStartEditRegister(reg)}
                                title="Cambiar nombre a esta terminal"
                                className="p-1 rounded-md text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRegister(reg.id, reg.name)}
                                  title="Eliminar esta terminal"
                                  className="p-1 rounded-md text-stone-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                              {isCurrentPcRegister && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-stone-900 text-[#a9b994]">
                                  Esta PC
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-stone-400 font-mono block">
                              DGT: {reg.terminalCode} • Sucursal {reg.branchCode}
                            </span>
                          </div>

                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                            regShift
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${regShift ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
                            <span>{regShift ? `Turno #${regShift.shiftNumber}` : 'Cerrada'}</span>
                          </span>
                        </div>
                      )}

                      {regShift ? (
                        <div className="space-y-1.5 text-xs text-stone-600 my-3">
                          <div className="flex justify-between">
                            <span className="text-stone-400">Cajero en turno:</span>
                            <span className="font-bold text-stone-900">{regShift.openedBy.userName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">Apertura:</span>
                            <span className="font-semibold">{new Date(regShift.openedAt).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">Fondo inicial:</span>
                            <span className="font-bold text-stone-900">₡{regShift.initialCashFloat.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-stone-400">Ventas totales:</span>
                            <span className="font-black text-emerald-700">₡{regShift.systemSummary.totalSales.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between border-t border-dashed border-stone-200 pt-1.5">
                            <span className="text-stone-500 font-semibold">Efectivo en gaveta:</span>
                            <span className="font-black text-stone-900">₡{regShift.systemSummary.expectedCashInDrawer.toLocaleString()}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-xs text-stone-400">
                          <Store className="w-6 h-6 mx-auto mb-1 text-stone-300" />
                          <span>Sin turno activo</span>
                        </div>
                      )}

                      <div className="pt-2 border-t border-stone-100 flex items-center gap-2">
                        {!isCurrentPcRegister ? (
                          <button
                            type="button"
                            onClick={() => handleSelectRegister(reg.id)}
                            className="flex-1 py-2 bg-stone-100 hover:bg-stone-900 hover:text-white text-stone-800 rounded-xl text-xs font-bold transition-all text-center cursor-pointer"
                          >
                            Asignar esta PC a esta Caja
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActiveTab('status')}
                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all text-center cursor-pointer"
                          >
                            {regShift ? 'Gestionar Turno Activo' : 'Abrir Turno Aquí'}
                          </button>
                        )}
                        {regShift && (
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectRegister(reg.id);
                              setActiveTab('close');
                            }}
                            className="py-2 px-3 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-xl text-xs font-black transition-all flex items-center gap-1 shadow-xs cursor-pointer shrink-0"
                            title="Cerrar turno de esta caja y realizar arqueo"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Cerrar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* ======================================================== */}
        {/* SUBMODAL: REGISTRAR EGRESO (SALIDA) O INGRESO (ENTRADA)  */}
        {/* ======================================================== */}
        {showMovementForm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                  <ArrowDownRight className="w-5 h-5 text-amber-600" />
                  <span>Registrar Movimiento de Caja</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowMovementForm(false)}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddMovementSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-stone-700 uppercase mb-1">Tipo de Movimiento:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMovementType('OUTFLOW')}
                      className={`py-2 rounded-xl font-bold border transition-colors ${
                        movementType === 'OUTFLOW'
                          ? 'bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-200'
                          : 'bg-stone-50 text-stone-600 border-stone-200'
                      }`}
                    >
                      🔴 Egreso (Salida)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovementType('INFLOW')}
                      className={`py-2 rounded-xl font-bold border transition-colors ${
                        movementType === 'INFLOW'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-200'
                          : 'bg-stone-50 text-stone-600 border-stone-200'
                      }`}
                    >
                      🟢 Ingreso (Entrada)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-stone-700 uppercase mb-1">Monto en Colones (CRC):</label>
                  <input
                    type="number"
                    step={500}
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-base font-black text-stone-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 uppercase mb-1">Motivo / Justificación:</label>
                  <input
                    type="text"
                    value={movementReason}
                    onChange={(e) => setMovementReason(e.target.value)}
                    placeholder="Ej. Pago a proveedor de verduras, compra de gas, etc."
                    required
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-medium"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 uppercase mb-1">Autorizado Por:</label>
                  <input
                    type="text"
                    value={movementAuthorizedBy}
                    onChange={(e) => setMovementAuthorizedBy(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl font-bold text-stone-800"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMovementForm(false)}
                    className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800 shadow-xs"
                  >
                    Guardar Movimiento
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
