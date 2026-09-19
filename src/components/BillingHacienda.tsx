import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  Send, 
  ShieldCheck, 
  Building2, 
  Copy, 
  Check, 
  Download, 
  Code, 
  SplitSquareVertical,
  CheckCircle2,
  ArrowRightLeft,
  Plus,
  X,
  Receipt,
  Lock
} from 'lucide-react';
import { Table, TableItem, TenantInfo, ElectronicInvoiceCR, SubAccount } from '../types';
import { generateHaciendaXmlV43, downloadXmlFile } from '../services/haciendaXml';
import { cashShiftService } from '../services/cashShiftService';
import { haciendaService } from '../services/haciendaService';
import { PosNotification } from './NotificationToast';

interface BillingHaciendaProps {
  tenant: TenantInfo;
  selectedTable: Table;
  onEmitInvoice?: (invoice: ElectronicInvoiceCR) => void;
  onSaveTable?: (updatedTable: Table) => void;
  onOpenCashShift?: (initialTab?: 'status' | 'close') => void;
  onNotify?: (notif: PosNotification) => void;
}

export const BillingHacienda: React.FC<BillingHaciendaProps> = ({
  tenant,
  selectedTable,
  onSaveTable,
  onOpenCashShift,
  onNotify
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [copiedClave, setCopiedClave] = useState(false);
  const [isInvoiceEmitted, setIsInvoiceEmitted] = useState(false);
  const [showXmlModal, setShowXmlModal] = useState(false);
  const [transferToast, setTransferToast] = useState<string | null>(null);

  // Subaccounts list state (defaults to 2 subaccounts if none exist)
  const defaultSubs: SubAccount[] = selectedTable.activeOrder?.subAccounts?.length
    ? selectedTable.activeOrder.subAccounts
    : [
        { id: 1, name: 'Cuenta 1 (Comensal 1)' },
        { id: 2, name: 'Cuenta 2 (Comensal 2)' }
      ];
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>(defaultSubs);
  const [selectedSubAccount, setSelectedSubAccount] = useState<number | 'ALL'>('ALL');

  // Items state
  const fallbackItems: TableItem[] = [
    {
      id: 'it_default_1',
      name: 'Ceviche Tico Clásico de Corvina',
      price: 6800,
      quantity: 2,
      subAccountId: 1,
      dinerName: 'Comensal 1',
      cabysCode: '2121100000100',
      taxRate: 0.13,
      category: 'Cocina'
    },
    {
      id: 'it_default_2',
      name: 'Corte Ribeye Angus 350g a la Leña',
      price: 18500,
      quantity: 1,
      subAccountId: 2,
      dinerName: 'Comensal 2',
      cabysCode: '2111100000200',
      taxRate: 0.13,
      category: 'Cocina'
    },
    {
      id: 'it_default_3',
      name: 'Cóctel Pasión Tica (Guaro Cacique)',
      price: 4900,
      quantity: 2,
      subAccountId: 1,
      dinerName: 'Comensal 1',
      cabysCode: '2411000000400',
      taxRate: 0.13,
      category: 'Bar'
    }
  ];

  const [orderItems, setOrderItems] = useState<TableItem[]>(
    selectedTable.activeOrder?.items?.length ? selectedTable.activeOrder.items : fallbackItems
  );

  // Transfer item modal/popover state
  const [itemToTransfer, setItemToTransfer] = useState<TableItem | null>(null);
  const [transferTargetSubId, setTransferTargetSubId] = useState<number>(2);
  const [transferQty, setTransferQty] = useState<number>(1);

  // Sync state if selectedTable changes
  useEffect(() => {
    if (selectedTable.activeOrder?.items?.length) {
      setOrderItems(selectedTable.activeOrder.items);
    }
    if (selectedTable.activeOrder?.subAccounts?.length) {
      setSubAccounts(selectedTable.activeOrder.subAccounts);
    }
  }, [selectedTable]);

  // Customer form state
  const [customerName, setCustomerName] = useState('Cliente General Contado');
  const [customerCedula, setCustomerCedula] = useState('1-0987-0654');
  const [customerEmail, setCustomerEmail] = useState('factura@cliente.cr');
  const [paymentMethod, setPaymentMethod] = useState<'01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil'>('02-Tarjeta');
  const [includeService10, setIncludeService10] = useState(tenant.includeService10ByDefault ?? true);

  // Filter items based on active subaccount tab
  const activeItems: TableItem[] = selectedSubAccount === 'ALL'
    ? orderItems
    : orderItems.filter(i => (i.subAccountId || 1) === selectedSubAccount);

  const isSimplified = tenant.taxRegime === 'SIMPLIFIED';
  const subtotal = activeItems.reduce((sum, it) => sum + (it.price * it.quantity), 0);
  const iva13 = isSimplified ? 0 : Math.round(subtotal * 0.13);
  const servicio10 = includeService10 ? Math.round(subtotal * 0.10) : 0;
  const total = Math.round(subtotal + iva13 + servicio10);
  const currentRegister = cashShiftService.getCurrentRegister();
  const currentShift = cashShiftService.getActiveShift();
  const terminalCode = currentRegister.terminalCode || '00001';
  const branchCode = currentRegister.branchCode || '001';

  const clave50Digitos = `50616092600${tenant.cedulaJuridica.replace(/[^0-9]/g, '').padEnd(12, '0')}${branchCode}${terminalCode}010000008921100987654`;
  const consecutivo = `${branchCode}${terminalCode}010000008921`;

  // Create another subaccount (e.g. Cuenta 3)
  const handleAddSubAccount = () => {
    const nextId = Math.max(...subAccounts.map(s => s.id), 0) + 1;
    const newSub: SubAccount = {
      id: nextId,
      name: `Cuenta ${nextId} (Comensal ${nextId})`
    };
    const updatedSubs = [...subAccounts, newSub];
    setSubAccounts(updatedSubs);

    if (onSaveTable) {
      onSaveTable({
        ...selectedTable,
        activeOrder: {
          orderNumber: selectedTable.activeOrder?.orderNumber || 'ORD-8921',
          server: selectedTable.activeOrder?.server || 'Mesero General',
          openedAt: selectedTable.activeOrder?.openedAt || 'Ahora',
          subAccounts: updatedSubs,
          items: orderItems
        }
      });
    }
  };

  // Execute transfer from inside the invoice
  const handleConfirmTransfer = () => {
    if (!itemToTransfer) return;

    const targetSub = subAccounts.find(s => s.id === transferTargetSubId);
    if (!targetSub) return;

    let updatedList: TableItem[] = [];

    // Transfer partial qty or full
    const sourceItem = orderItems.find(i => i.id === itemToTransfer.id);
    if (!sourceItem) return;

    if (sourceItem.quantity <= transferQty) {
      // Move entirely
      updatedList = orderItems.map(it => 
        it.id === itemToTransfer.id ? { ...it, subAccountId: targetSub.id, dinerName: targetSub.name } : it
      );
    } else {
      // Split
      const remainingQty = sourceItem.quantity - transferQty;
      const newItem: TableItem = {
        ...sourceItem,
        id: `split_${Date.now()}`,
        quantity: transferQty,
        subAccountId: targetSub.id,
        dinerName: targetSub.name
      };

      updatedList = [
        ...orderItems.map(it => it.id === sourceItem.id ? { ...it, quantity: remainingQty } : it),
        newItem
      ];
    }

    setOrderItems(updatedList);
    setItemToTransfer(null);

    // Save back to table state
    if (onSaveTable) {
      onSaveTable({
        ...selectedTable,
        activeOrder: {
          orderNumber: selectedTable.activeOrder?.orderNumber || 'ORD-8921',
          server: selectedTable.activeOrder?.server || 'Mesero General',
          openedAt: selectedTable.activeOrder?.openedAt || 'Ahora',
          subAccounts,
          items: updatedList
        }
      });
    }

    // Toast notification
    setTransferToast(`"${itemToTransfer.name}" trasladado a ${targetSub.name} con éxito ✓`);
    setTimeout(() => setTransferToast(null), 2500);
  };

  const invoiceObject: ElectronicInvoiceCR = {
    clave50Digitos,
    consecutivo,
    emisor: {
      nombre: tenant.name,
      cedulaJuridica: tenant.cedulaJuridica,
      nombreComercial: "Saborai POS Restaurant",
      correo: tenant.email,
      sucursal: branchCode,
      terminal: terminalCode
    },
    receptor: {
      nombre: customerName,
      tipoIdentificacion: '01-Fisica',
      identificacion: customerCedula,
      correo: customerEmail
    },
    fechaEmision: new Date().toISOString(),
    condicionVenta: '01-Efectivo',
    medioPago: paymentMethod,
    moneda: 'CRC',
    tipoCambio: 1.0,
    items: activeItems,
    subtotal,
    iva13,
    iva4: 0,
    iva2: 0,
    iva1: 0,
    servicio10,
    totalComprobante: total,
    estadoHacienda: 'ACEPTADO'
  };

  const xmlContent = generateHaciendaXmlV43(invoiceObject, tenant);

  const handleCopyClave = () => {
    navigator.clipboard.writeText(clave50Digitos);
    setCopiedClave(true);
    setTimeout(() => setCopiedClave(false), 2000);
  };

  const handleDownloadXml = () => {
    downloadXmlFile(xmlContent, `FacturaElectronica_${clave50Digitos}.xml`);
  };

  const handleEmitToHacienda = () => {
    setIsInvoiceEmitted(true);

    // Record transaction into active cash shift of the current register
    let cashAmt = 0;
    let cardAmt = 0;
    let sinpeAmt = 0;

    if (paymentMethod === '01-Efectivo') {
      cashAmt = total;
    } else if (paymentMethod === '02-Tarjeta') {
      cardAmt = total;
    } else {
      sinpeAmt = total;
    }

    cashShiftService.recordSalePayment({
      cashAmount: cashAmt,
      cardAmount: cardAmt,
      sinpeAmount: sinpeAmt,
      subtotal,
      tax: iva13,
      service10: servicio10,
      registerId: currentRegister.id
    });

    // Send to Hacienda Simulation
    const finalInvoice: ElectronicInvoiceCR = {
      ...invoiceObject,
      fechaEmision: new Date().toISOString(),
      xmlContent
    };

    haciendaService.emitInvoice(finalInvoice, (status) => {
      if (onNotify) {
        onNotify({
          id: `hacienda_${Date.now()}`,
          type: status === 'ACEPTADO' ? 'ORDER_READY' : status === 'RECHAZADO' ? 'NEW_ORDER' : 'HACIENDA_UPDATE',
          title: status === 'ACEPTADO' ? '✅ Factura Aceptada' : status === 'RECHAZADO' ? '❌ Factura Rechazada' : '⏳ Procesando DGT...',
          message: status === 'ACEPTADO' ? `Hacienda aceptó la factura ${clave50Digitos.slice(-6)}` : status === 'RECHAZADO' ? `Error en DGT para ${clave50Digitos.slice(-6)}` : `Enviando XML a Hacienda...`,
          station: 'Bar',
          tableNumber: 0,
          server: 'Sistema',
          timestamp: new Date()
        });
      }
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2 flex-wrap">
            <span>Caja & Facturación Electrónica</span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
              isSimplified
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-stone-100 text-stone-600 border border-stone-200'
            }`}>
              {isSimplified ? 'Régimen Simplificado CR (0% IVA • 10% Serv)' : 'Hacienda CR v4.3 (IVA 13%)'}
            </span>

            {/* Active Register Chip */}
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full border bg-white text-stone-800 border-stone-300 shadow-2xs flex items-center gap-1.5" title={`Terminal DGT: ${terminalCode} - ${currentRegister.name}`}>
              <span className={`w-2 h-2 rounded-full ${currentShift ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{currentRegister.name} ({terminalCode})</span>
            </span>
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {isSimplified
              ? 'Comprobante de Régimen Simplificado con desglose del 10% de servicio de mesa (Ley N° 4946).'
              : 'División de cuentas entre comensales, traslado de ítems y emisión de tiquete fiscal v4.3.'}
          </p>

          {/* Warning if no shift open on this terminal */}
          {!currentShift && (
            <div className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-1.5 inline-flex items-center gap-2">
              <span>⚠️ Esta terminal ({currentRegister.name}) no tiene un turno de caja abierto.</span>
              {onOpenCashShift && (
                <button 
                  type="button" 
                  onClick={() => onOpenCashShift('status')} 
                  className="underline font-bold text-amber-950 hover:opacity-80 cursor-pointer"
                >
                  Abrir Turno Ahora
                </button>
              )}
            </div>
          )}
        </div>

        {/* Header Right Actions: Turno & Caja button + Paper Width Selector */}
        <div className="flex items-center gap-2">
          {onOpenCashShift && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenCashShift('status')}
                className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                title={`Ver movimientos de ${currentRegister.name} o estado de caja`}
              >
                <Receipt className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>{currentRegister.name}</span>
              </button>

              {currentShift && (
                <button
                  type="button"
                  onClick={() => onOpenCashShift('close')}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-xs cursor-pointer animate-in fade-in"
                  title="Cerrar turno de caja y realizar arqueo"
                >
                  <Lock className="w-3.5 h-3.5 text-stone-950" />
                  <span>Cerrar Turno</span>
                </button>
              )}
            </div>
          )}

          <div className="inline-flex p-1 rounded-2xl bg-stone-100 border border-stone-200/80 text-xs">
            <button
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-xl font-bold transition-all ${
                paperWidth === '80mm' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
              }`}
            >
              80mm
            </button>
            <button
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-xl font-bold transition-all ${
                paperWidth === '58mm' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
              }`}
            >
              58mm
            </button>
          </div>
        </div>
      </div>

      {/* Transfer Success Toast */}
      {transferToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top duration-200">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{transferToast}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Interactive Account Splitter, Items & Hacienda Customer Data (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* ================= SECTION 1: DIVISIÓN DE CUENTAS & TRASLADO DE ÍTEMS ================= */}
          <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <SplitSquareVertical className="w-4 h-4 text-[#588157]" />
                <h3 className="font-bold text-sm text-stone-900">
                  Separación de Cuentas & Traslado de Ítems
                </h3>
              </div>

              {/* Subaccount Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setSelectedSubAccount('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                    selectedSubAccount === 'ALL'
                      ? 'bg-stone-900 text-white shadow-xs'
                      : 'bg-stone-100 text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Cuenta Total ({orderItems.length})
                </button>

                {subAccounts.map((sub) => {
                  const count = orderItems.filter(i => (i.subAccountId || 1) === sub.id).length;
                  const isSelected = selectedSubAccount === sub.id;

                  return (
                    <button
                      key={sub.id}
                      onClick={() => setSelectedSubAccount(sub.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1 ${
                        isSelected
                          ? 'bg-stone-900 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      <span>Cuenta {sub.id}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        isSelected ? 'bg-[#588157] text-white' : 'bg-stone-200 text-stone-700'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={handleAddSubAccount}
                  className="px-2.5 py-1.5 rounded-xl border border-dashed border-stone-300 hover:border-stone-400 text-stone-600 text-xs font-bold flex items-center gap-1 transition-all shrink-0"
                  title="Añadir Cuenta 3 o más"
                >
                  <Plus className="w-3.5 h-3.5 text-[#588157]" />
                  <span>+ Subcuenta</span>
                </button>
              </div>
            </div>

            {/* List of items with direct Transfer actions */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-stone-400 uppercase block">
                {selectedSubAccount === 'ALL' 
                  ? 'Todos los ítems comandados en la mesa (Puedes trasladar cualquiera entre cuentas):' 
                  : `Ítems asignados a Cuenta ${selectedSubAccount}:`}
              </span>

              {activeItems.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-xs bg-stone-50 rounded-2xl">
                  Esta cuenta no tiene ítems asignados en este momento.
                </div>
              ) : (
                activeItems.map((item) => {
                  const currentSubId = item.subAccountId || 1;
                  // Other subaccounts available to transfer to
                  const otherSubs = subAccounts.filter(s => s.id !== currentSubId);

                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-stone-50 hover:bg-stone-100/80 rounded-2xl border border-stone-200/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-stone-900">{item.quantity}x</span>
                          <span className="font-bold text-stone-800 truncate">{item.name}</span>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-stone-200 text-[10px] font-semibold text-stone-600 shrink-0">
                            Asignado a: Cuenta {currentSubId}
                          </span>
                        </div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          Precio unitario: ₡{item.price.toLocaleString()} • Subtotal: ₡{(item.price * item.quantity).toLocaleString()}
                        </div>
                      </div>

                      {/* Traslado Rápido Button / Selector */}
                      <div className="flex items-center gap-2 shrink-0">
                        {otherSubs.length === 1 ? (
                          // Direct 1-click button if there are only 2 accounts (Cuenta 1 <-> Cuenta 2)
                          <button
                            onClick={() => {
                              setItemToTransfer(item);
                              setTransferTargetSubId(otherSubs[0].id);
                              setTransferQty(item.quantity);
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-stone-900 hover:text-white border border-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                            title={`Trasladar a Cuenta ${otherSubs[0].id}`}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[#588157]" />
                            <span>Mover a Cuenta {otherSubs[0].id}</span>
                          </button>
                        ) : (
                          // Dropdown / button if there are 3 or more accounts
                          <button
                            onClick={() => {
                              setItemToTransfer(item);
                              setTransferTargetSubId(otherSubs[0]?.id || 1);
                              setTransferQty(item.quantity);
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-stone-900 hover:text-white border border-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[#588157]" />
                            <span>Trasladar a...</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

          </div>

          {/* ================= SECTION 2: DATOS DEL RECEPTOR / CLIENTE ================= */}
          <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="font-bold text-sm text-stone-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#588157]" />
                <span>Datos del Receptor / Cliente</span>
              </h3>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-700">
                {selectedSubAccount === 'ALL' ? 'Facturando Cuenta Total' : `Facturando Cuenta ${selectedSubAccount}`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs font-semibold text-stone-700">
              <div>
                <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Nombre o Razón Social</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Cédula / Identificación</label>
                <input
                  type="text"
                  value={customerCedula}
                  onChange={(e) => setCustomerCedula(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Correo Electrónico (XML & PDF)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Medio de Pago</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none"
                >
                  <option value="02-Tarjeta">02 - Tarjeta Débito/Crédito</option>
                  <option value="01-Efectivo">01 - Efectivo</option>
                  <option value="03-SINPE_Movil">03 - SINPE Móvil Bancario</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
              <input
                type="checkbox"
                id="serv10"
                checked={includeService10}
                onChange={(e) => setIncludeService10(e.target.checked)}
                className="rounded border-stone-300 text-stone-900 focus:ring-[#588157]"
              />
              <label htmlFor="serv10" className="text-xs font-semibold text-stone-700">
                Incluir 10% de Servicio de Mesa Ley Costa Rica (Propina de ley)
              </label>
            </div>
          </div>

          {/* ================= SECTION 3: HACIENDA CLAVE & XML / RÉGIMEN SIMPLIFICADO ================= */}
          <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-900 uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#588157]" />
                <span>
                  {isSimplified ? 'Régimen de Tributación Simplificada (Costa Rica)' : 'Clave Numérica de Hacienda (50 Dígitos)'}
                </span>
              </span>
              {!isSimplified && (
                <button
                  onClick={handleCopyClave}
                  className="text-xs font-bold text-stone-700 hover:text-stone-900 flex items-center gap-1"
                >
                  {copiedClave ? <Check className="w-3.5 h-3.5 text-[#588157]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedClave ? 'Copiada' : 'Copiar Clave'}</span>
                </button>
              )}
            </div>

            {isSimplified ? (
              <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-200 text-xs text-stone-700 space-y-1.5">
                <div className="font-bold text-emerald-950 flex items-center gap-1">
                  <span>Autorizado por la Dirección General de Tributación (DGT)</span>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  Las ventas no generan débito fiscal del 13% de IVA al consumidor (0% IVA). Se desglosa el 10% de ventas por servicio de mesa de conformidad con la Ley N° 4946.
                </p>
                <div className="text-[11px] font-mono text-stone-600 pt-1">
                  Comprobante N°: <strong>{consecutivo}</strong>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 font-mono text-xs text-stone-800 break-all select-all">
                {clave50Digitos}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                onClick={() => setShowXmlModal(true)}
                className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-stone-200"
              >
                <Code className="w-3.5 h-3.5 text-[#588157]" />
                <span>{isSimplified ? 'Ver Documento Fiscal' : 'Ver XML v4.3'}</span>
              </button>

              <button
                onClick={handleDownloadXml}
                className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-stone-200"
              >
                <Download className="w-3.5 h-3.5 text-[#588157]" />
                <span>{isSimplified ? 'Descargar Comprobante' : 'Descargar .XML'}</span>
              </button>
            </div>
          </div>

          {/* Action Trigger */}
          <button
            onClick={handleEmitToHacienda}
            className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold text-sm hover:bg-stone-800 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            {isInvoiceEmitted ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>{isSimplified ? 'Comprobante Registrado con Éxito ✓' : 'Factura Transmitida con Éxito a Hacienda CR ✓'}</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-[#a9b994]" />
                <span>
                  {isSimplified ? 'Emitir Comprobante Simplificado' : 'Emitir Factura Electrónica'} de {selectedSubAccount === 'ALL' ? 'Cuenta Total' : `Cuenta ${selectedSubAccount}`} (₡{total.toLocaleString()})
                </span>
              </>
            )}
          </button>

        </div>

        {/* Right Column: Thermal Receipt Preview (Monochrome 80mm/58mm) (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          
          <div className="text-xs font-bold text-stone-500 mb-2 flex items-center justify-between w-full max-w-[340px]">
            <span className="flex items-center gap-1">
              <Printer className="w-3.5 h-3.5 text-[#588157]" />
              <span>Vista Previa Impresión ({paperWidth})</span>
            </span>
            <button
              onClick={() => window.print()}
              className="text-stone-700 hover:text-stone-900 text-xs font-bold underline"
            >
              Imprimir Ahora
            </button>
          </div>

          {/* Thermal Paper Container */}
          <div 
            className={`printable-invoice bg-white text-black font-mono text-[11px] leading-tight p-6 shadow-xl border border-stone-300 rounded-xl transition-all ${
              paperWidth === '80mm' ? 'w-full max-w-[340px]' : 'w-full max-w-[260px] text-[10px]'
            }`}
          >
            {/* Ticket Header */}
            <div className="text-center space-y-1 pb-3 border-b border-dashed border-black">
              <div className="font-black text-sm tracking-wider">SABORAI POS</div>
              <div className="font-bold uppercase text-[12px]">{tenant.name}</div>
              <div>Cédula: {tenant.cedulaJuridica}</div>
              <div>{tenant.location}</div>
              <div>Tel: {tenant.phone}</div>
            </div>

            {/* Invoice Meta */}
            <div className="py-2.5 border-b border-dashed border-black space-y-0.5 text-[10px]">
              <div className="font-bold text-center uppercase">
                {isSimplified
                  ? (selectedSubAccount === 'ALL' ? 'COMPROBANTE RÉGIMEN SIMPLIFICADO' : `COMPROBANTE RÉGIMEN SIMPLIFICADO - CUENTA ${selectedSubAccount}`)
                  : (selectedSubAccount === 'ALL' ? 'TIQUETE ELECTRÓNICO v4.3' : `TIQUETE ELECTRÓNICO - CUENTA ${selectedSubAccount}`)}
              </div>
              <div>Consecutivo: {consecutivo}</div>
              <div>Fecha: {new Date().toLocaleDateString('es-CR')} {new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div>Mesa: {selectedTable.name}</div>
              <div>Cliente: {customerName}</div>
              <div>Cédula: {customerCedula}</div>
              <div>Pago: {paymentMethod}</div>
            </div>

            {/* Line Items */}
            <div className="py-3 border-b border-dashed border-black space-y-1.5">
              <div className="flex justify-between font-bold uppercase text-[9px]">
                <span>CANT / DESCRIPCION</span>
                <span>TOTAL</span>
              </div>
              {activeItems.map((item: TableItem, idx: number) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span>{item.quantity}x {item.name.substring(0, paperWidth === '80mm' ? 24 : 16)}</span>
                    <span>₡{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                  <div className="text-[8px] text-stone-600">
                    CABYS: {item.cabysCode} (Cuenta {item.subAccountId || 1})
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="py-2.5 border-b border-dashed border-black space-y-1 text-right">
              <div className="flex justify-between">
                <span>SUBTOTAL:</span>
                <span>₡{subtotal.toLocaleString()}</span>
              </div>
              {!isSimplified ? (
                <div className="flex justify-between">
                  <span>IVA (13%):</span>
                  <span>₡{iva13.toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex justify-between text-[9px] text-stone-600">
                  <span>IVA (0%):</span>
                  <span>EXENTO / RÉGIMEN SIMPLIFICADO</span>
                </div>
              )}
              {includeService10 && (
                <div className="flex justify-between font-bold">
                  <span>SERVICIO MESA LEY 4946 (10%):</span>
                  <span>₡{servicio10.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm pt-1 border-t border-dashed border-black">
                <span>TOTAL A PAGAR:</span>
                <span>₡{total.toLocaleString()}</span>
              </div>
            </div>

            {/* Footer: Hacienda Clave & QR or Simplified Regime Note */}
            {isSimplified ? (
              <div className="pt-3 text-center space-y-1 text-[9px]">
                <div className="font-bold uppercase tracking-wider">
                  RÉGIMEN DE TRIBUTACIÓN SIMPLIFICADA
                </div>
                <div className="text-[8px] text-stone-600 leading-tight">
                  Autorizado por la Dirección General de Tributación Costa Rica.
                  <br />
                  No genera crédito fiscal de IVA para el consumidor.
                </div>
                <div className="text-[8px] text-stone-700 font-semibold pt-1">
                  Ley N° 4946: 10% de Servicio incluido para personal de mesa.
                </div>
                <div className="text-[8px] font-mono pt-1 text-stone-500">
                  Control Interno #{consecutivo}
                </div>
              </div>
            ) : (
              <div className="pt-3 text-center space-y-2">
                <div className="text-[8px] break-all">
                  Clave Numérica:
                  <br />
                  {clave50Digitos}
                </div>

                <div className="w-20 h-20 mx-auto border border-black p-1 bg-white flex flex-col items-center justify-center">
                  <div className="w-full h-full bg-stone-900 flex items-center justify-center text-[7px] text-white font-bold p-1 text-center">
                    QR HACIENDA CR v4.3
                  </div>
                </div>

                <div className="text-[8px] text-stone-500">
                  Autorizada mediante resolución DGT-R-033-2019
                </div>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* ================= MODAL: TRASLADAR ÍTEM ENTRE CUENTAS ================= */}
      {itemToTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-4 animate-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-[#588157]" />
                <h3 className="text-sm font-bold text-stone-900">Trasladar Ítem a otra Cuenta</h3>
              </div>
              <button
                onClick={() => setItemToTransfer(null)}
                className="w-7 h-7 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center hover:bg-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/80">
                <span className="font-bold text-stone-900 block">{itemToTransfer.name}</span>
                <span className="text-stone-500 text-[11px]">
                  Cuenta actual: <strong>Cuenta {itemToTransfer.subAccountId || 1}</strong> • Total disponibles: {itemToTransfer.quantity} und.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Mover hacia:</label>
                <select
                  value={transferTargetSubId}
                  onChange={(e) => setTransferTargetSubId(Number(e.target.value))}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-900 focus:outline-none"
                >
                  {subAccounts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.id === (itemToTransfer.subAccountId || 1) ? '(Actual)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {itemToTransfer.quantity > 1 && (
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Cantidad a mover (de {itemToTransfer.quantity} disponibles):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={itemToTransfer.quantity}
                    value={transferQty}
                    onChange={(e) => setTransferQty(Math.min(itemToTransfer.quantity, Math.max(1, Number(e.target.value))))}
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-900 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setItemToTransfer(null)}
                className="px-3.5 py-2 rounded-xl border border-stone-200 text-stone-600 text-xs font-semibold hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmTransfer}
                className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-stone-800 shadow-xs flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>Confirmar Traslado</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* XML Modal */}
      {showXmlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-base font-bold text-stone-900">XML Factura Electrónica v4.3 (Hacienda CR)</h3>
              <button
                onClick={() => setShowXmlModal(false)}
                className="px-3 py-1 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-bold"
              >
                Cerrar
              </button>
            </div>

            <pre className="p-4 bg-stone-900 text-emerald-400 font-mono text-[11px] rounded-2xl max-h-[450px] overflow-y-auto whitespace-pre-wrap">
              {xmlContent}
            </pre>
          </div>
        </div>
      )}

    </div>
  );
};
