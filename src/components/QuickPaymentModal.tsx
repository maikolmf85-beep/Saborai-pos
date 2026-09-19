import React, { useState, useEffect } from 'react';
import { 
  CreditCard, 
  Banknote, 
  Smartphone, 
  CheckCircle2, 
  X, 
  Receipt, 
  Printer, 
  ShieldCheck,
  SplitSquareVertical,
  Download
} from 'lucide-react';
import { Table, TableItem, TenantInfo } from '../types';
import { generateHaciendaXmlV43, downloadXmlFile } from '../services/haciendaXml';
import { cashShiftService } from '../services/cashShiftService';
import { haciendaService } from '../services/haciendaService';
import { PosNotification } from './NotificationToast';

interface QuickPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table;
  tenant: TenantInfo;
  subAccountId?: number | 'ALL';
  dinerName?: string;
  onPaymentComplete: (method: string, amount: number) => void;
  onNotify?: (notif: PosNotification) => void;
}

type PaymentMode = 'single' | 'mixed';
type SingleMethod = 'Tarjeta' | 'Efectivo' | 'SINPE Móvil';

export const QuickPaymentModal: React.FC<QuickPaymentModalProps> = ({
  isOpen,
  onClose,
  table,
  tenant,
  subAccountId = 'ALL',
  dinerName,
  onPaymentComplete,
  onNotify
}) => {
  const currentRegister = cashShiftService.getCurrentRegister();
  const terminalCode = currentRegister.terminalCode || '00001';
  const branchCode = currentRegister.branchCode || '001';

  // Mode: Single method or Mixed payment
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('single');
  const [singleMethod, setSingleMethod] = useState<SingleMethod>('Tarjeta');

  // Single payment inputs
  const [cashReceived, setCashReceived] = useState<string>('');
  const [sinpeRef, setSinpeRef] = useState<string>('');

  // Mixed payment inputs
  const [mixedCash, setMixedCash] = useState<number>(0);
  const [mixedCashGiven, setMixedCashGiven] = useState<number>(0);
  const [mixedCard, setMixedCard] = useState<number>(0);
  const [mixedSinpe, setMixedSinpe] = useState<number>(0);

  // Status states
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReceiptView, setShowReceiptView] = useState(false);
  const [clave50Digitos, setClave50Digitos] = useState('');
  const [consecutivo, setConsecutivo] = useState('');

  const rawItems = table.activeOrder?.items || [];
  const items: TableItem[] = subAccountId === 'ALL'
    ? rawItems
    : rawItems.filter(i => (i.subAccountId || 1) === subAccountId);

  const isSimplified = tenant.taxRegime === 'SIMPLIFIED';
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const iva13 = isSimplified ? 0 : Math.round(subtotal * 0.13);
  const servicio10 = Math.round(subtotal * 0.10);
  const total = Math.round(subtotal + iva13 + servicio10);

  // Initialize mixed payment defaults when total changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setPaymentMode('single');
      setSingleMethod('Tarjeta');
      setCashReceived('');
      setSinpeRef('');
      setMixedCash(0);
      setMixedCashGiven(0);
      setMixedCard(0);
      setMixedSinpe(0);
      setShowReceiptView(false);
      setIsProcessing(false);
    }
  }, [isOpen, total]);

  // Single cash calculations
  const singleCashGivenNum = parseFloat(cashReceived) || 0;
  const singleChangeDue = Math.max(0, singleCashGivenNum - total);

  // Mixed payment calculations
  const mixedTotalAssigned = mixedCash + mixedCard + mixedSinpe;
  const mixedRemaining = Math.max(0, total - mixedTotalAssigned);
  const mixedChangeDue = Math.max(0, mixedCashGiven - mixedCash);

  // Quick distribution helpers for Mixed payment
  const handleSetHalfAndHalf = () => {
    const half = Math.round(total / 2);
    setMixedCash(half);
    setMixedCashGiven(half);
    setMixedCard(total - half);
    setMixedSinpe(0);
  };

  const handleFillRemainingCard = () => {
    const need = total - (mixedCash + mixedSinpe);
    setMixedCard(Math.max(0, need));
  };

  const handleFillRemainingCash = () => {
    const need = total - (mixedCard + mixedSinpe);
    setMixedCash(Math.max(0, need));
    if (mixedCashGiven < need) {
      setMixedCashGiven(Math.max(0, need));
    }
  };

  const handleFillRemainingSinpe = () => {
    const need = total - (mixedCash + mixedCard);
    setMixedSinpe(Math.max(0, need));
  };

  const canSubmit = () => {
    if (paymentMode === 'single') {
      if (singleMethod === 'Efectivo') {
        return singleCashGivenNum >= total;
      }
      return true;
    } else {
      return mixedTotalAssigned >= total;
    }
  };

  const handleProcessPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit()) return;

    setIsProcessing(true);

    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const generatedClave = `50616092600${tenant.cedulaJuridica.replace(/[^0-9]/g, '').padEnd(12, '0')}${branchCode}${terminalCode}0100000${randomSuffix}100987654`;
    const generatedConsecutivo = `${branchCode}${terminalCode}0100000${randomSuffix}`;
    setClave50Digitos(generatedClave);
    setConsecutivo(generatedConsecutivo);

    // Record into active cash shift of the current register
    let cashAmt = 0;
    let cardAmt = 0;
    let sinpeAmt = 0;
    if (paymentMode === 'single') {
      if (singleMethod === 'Efectivo') cashAmt = total;
      else if (singleMethod === 'Tarjeta') cardAmt = total;
      else sinpeAmt = total;
    } else {
      cashAmt = mixedCash;
      cardAmt = mixedCard;
      sinpeAmt = mixedSinpe;
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

    // Hacienda Simulation Integration
    const invoiceObj: any = {
      clave50Digitos: generatedClave,
      consecutivo: generatedConsecutivo,
      emisor: {
        nombre: tenant.name,
        cedulaJuridica: tenant.cedulaJuridica,
        nombreComercial: "Saborai POS",
        correo: tenant.email,
        sucursal: branchCode,
        terminal: terminalCode
      },
      receptor: {
        nombre: "Cliente General Contado",
        tipoIdentificacion: '01-Fisica',
        identificacion: '1-0000-0000',
        correo: 'factura@cliente.cr'
      },
      condicionVenta: '01-Efectivo',
      medioPago: paymentMode === 'single' ? singleMethod : 'Mixto',
      moneda: 'CRC',
      tipoCambio: 1.0,
      items,
      subtotal,
      iva13,
      iva4: 0,
      iva2: 0,
      iva1: 0,
      servicio10,
      totalComprobante: total,
      estadoHacienda: 'PROCESANDO',
      fechaEmision: new Date()
    };
    
    const xml = generateHaciendaXmlV43(invoiceObj, tenant);
    invoiceObj.xmlContent = xml;

    haciendaService.emitInvoice(invoiceObj, (status) => {
      if (onNotify) {
        onNotify({
          id: `hacienda_${Date.now()}`,
          type: status === 'ACEPTADO' ? 'ORDER_READY' : status === 'RECHAZADO' ? 'NEW_ORDER' : 'HACIENDA_UPDATE',
          title: status === 'ACEPTADO' ? '✅ Factura Aceptada' : status === 'RECHAZADO' ? '❌ Factura Rechazada' : '⏳ Procesando DGT...',
          message: status === 'ACEPTADO' ? `Hacienda aceptó la factura ${generatedClave.slice(-6)}` : status === 'RECHAZADO' ? `Error en DGT para ${generatedClave.slice(-6)}` : `Enviando XML a Hacienda...`,
          station: 'Bar',
          tableNumber: table.number,
          server: 'Sistema',
          timestamp: new Date()
        });
      }
    });

    setTimeout(() => {
      setIsProcessing(false);
      setShowReceiptView(true);

      // Trigger automatic print
      setTimeout(() => {
        try {
          window.print();
        } catch {
          // ignore if print blocked
        }
      }, 500);
    }, 700);
  };

  const handleFinalizeAndClose = () => {
    let methodSummary = '';
    if (paymentMode === 'single') {
      methodSummary = singleMethod;
    } else {
      const parts = [];
      if (mixedCash > 0) parts.push(`Efectivo ₡${mixedCash.toLocaleString()}`);
      if (mixedCard > 0) parts.push(`Tarjeta ₡${mixedCard.toLocaleString()}`);
      if (mixedSinpe > 0) parts.push(`SINPE ₡${mixedSinpe.toLocaleString()}`);
      methodSummary = `Mixto (${parts.join(' + ')})`;
    }

    onPaymentComplete(methodSummary, total);
    onClose();
  };

  const handleDownloadXmlInvoice = () => {
    const invoiceObj: any = {
      clave50Digitos,
      consecutivo,
      emisor: {
        nombre: tenant.name,
        cedulaJuridica: tenant.cedulaJuridica,
        nombreComercial: "Saborai POS",
        correo: tenant.email,
        sucursal: branchCode,
        terminal: terminalCode
      },
      receptor: {
        nombre: "Cliente General Contado",
        tipoIdentificacion: '01-Fisica',
        identificacion: '1-0000-0000',
        correo: 'factura@cliente.cr'
      },
      fechaEmision: new Date().toISOString(),
      condicionVenta: '01-Efectivo',
      medioPago: paymentMode === 'single' ? singleMethod : 'Mixto',
      moneda: 'CRC',
      tipoCambio: 1.0,
      items,
      subtotal,
      iva13,
      iva4: 0,
      iva2: 0,
      iva1: 0,
      servicio10,
      totalComprobante: total,
      estadoHacienda: 'ACEPTADO'
    };
    const xml = generateHaciendaXmlV43(invoiceObj, tenant);
    downloadXmlFile(xml, `Factura_${consecutivo}.xml`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-7 max-w-xl w-full shadow-2xl relative space-y-4 max-h-[95vh] overflow-y-auto">
        
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center font-bold">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-stone-900 leading-tight">Cobrar Cuenta & Factura</h3>
            <p className="text-xs text-stone-500">
              {table.name} • {subAccountId === 'ALL' ? 'Cuenta Completa' : `Cuenta de ${dinerName || `Comensal ${subAccountId}`}`}
            </p>
          </div>
        </div>

        {/* ===================== VIEW 1: RECEIPT & PRINT CONFIRMATION ===================== */}
        {showReceiptView ? (
          <div className="space-y-4 animate-in zoom-in-95 duration-200">
            
            {/* Success Alert */}
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>
                  <strong>¡Pago registrado con éxito!</strong> Factura transmitida a Hacienda Costa Rica v4.3.
                </span>
              </div>
            </div>

            {/* Printable Thermal Receipt Container */}
            <div className="printable-invoice bg-stone-50 border border-stone-300 rounded-2xl p-5 font-mono text-[11px] leading-tight text-black max-w-[340px] mx-auto shadow-sm">
              <div className="text-center space-y-1 pb-2 border-b border-dashed border-stone-400">
                <div className="font-black text-sm tracking-wider">SABORAI POS</div>
                <div className="font-bold uppercase text-[11px]">{tenant.name}</div>
                <div>Cédula Jurídica: {tenant.cedulaJuridica}</div>
                <div>{tenant.location}</div>
                <div>Tel: {tenant.phone}</div>
              </div>

              <div className="py-2 border-b border-dashed border-stone-400 space-y-0.5 text-[10px]">
                <div className="font-bold text-center uppercase">
                  {isSimplified ? 'COMPROBANTE RÉGIMEN SIMPLIFICADO' : 'TIQUETE ELECTRÓNICO v4.3'}
                </div>
                <div>Consecutivo: {consecutivo}</div>
                <div>Fecha: {new Date().toLocaleDateString('es-CR')} {new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</div>
                <div>Mesa: {table.name}</div>
                <div>Cliente: Cliente General Contado</div>
              </div>

              {/* Items List */}
              <div className="py-2 border-b border-dashed border-stone-400 space-y-1">
                <div className="flex justify-between font-bold text-[9px] uppercase">
                  <span>Cant / Descrip</span>
                  <span>Total</span>
                </div>
                {items.map((it, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span>{it.quantity}x {it.name.substring(0, 20)}</span>
                    <span>₡{(it.price * it.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {/* Totals Breakdown */}
              <div className="py-2 border-b border-dashed border-stone-400 space-y-0.5 text-right">
                <div className="flex justify-between">
                  <span>SUBTOTAL:</span>
                  <span>₡{subtotal.toLocaleString()}</span>
                </div>
                {!isSimplified ? (
                  <div className="flex justify-between">
                    <span>IVA 13%:</span>
                    <span>₡{iva13.toLocaleString()}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-[9px] text-stone-600">
                    <span>IVA (0%):</span>
                    <span>EXENTO / RÉGIMEN SIMPLIFICADO</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span>SERVICIO 10% (LEY 4946):</span>
                  <span>₡{servicio10.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black text-sm pt-1 border-t border-dashed border-stone-400">
                  <span>TOTAL PAGADO:</span>
                  <span>₡{total.toLocaleString()}</span>
                </div>
              </div>

              {/* Payment Methods Applied (Single or Mixed breakdown) */}
              <div className="py-2 border-b border-dashed border-stone-400 space-y-0.5 text-[10px]">
                <div className="font-bold uppercase text-[9px] text-stone-600">DESGLOSE DE PAGO:</div>
                {paymentMode === 'single' ? (
                  <>
                    <div className="flex justify-between">
                      <span>{singleMethod}:</span>
                      <span>₡{total.toLocaleString()}</span>
                    </div>
                    {singleMethod === 'Efectivo' && (
                      <div className="flex justify-between text-stone-600">
                        <span>Recibido / Cambio:</span>
                        <span>₡{singleCashGivenNum.toLocaleString()} / ₡{singleChangeDue.toLocaleString()}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {mixedCash > 0 && (
                      <div className="flex justify-between">
                        <span>Efectivo:</span>
                        <span>₡{mixedCash.toLocaleString()} (Vuelto: ₡{mixedChangeDue.toLocaleString()})</span>
                      </div>
                    )}
                    {mixedCard > 0 && (
                      <div className="flex justify-between">
                        <span>Tarjeta Crédito/Débito:</span>
                        <span>₡{mixedCard.toLocaleString()}</span>
                      </div>
                    )}
                    {mixedSinpe > 0 && (
                      <div className="flex justify-between">
                        <span>SINPE Móvil Bancario:</span>
                        <span>₡{mixedSinpe.toLocaleString()}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Clave Hacienda / Nota Régimen */}
              <div className="pt-2 text-center text-[7px] text-stone-600 break-all space-y-1">
                {isSimplified ? (
                  <>
                    <div className="font-bold text-[8px] uppercase">Régimen de Tributación Simplificada DGT</div>
                    <div>Ley N° 4946: 10% de Servicio incluido para meseros</div>
                  </>
                ) : (
                  <div>Clave Hacienda: {clave50Digitos}</div>
                )}
                <div className="font-bold text-[8px] text-stone-800">¡Gracias por su visita a {tenant.name}!</div>
              </div>
            </div>

            {/* Print & Close Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="py-3 px-3 bg-white border border-stone-300 hover:bg-stone-50 text-stone-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              >
                <Printer className="w-4 h-4 text-[#588157]" />
                <span>Re-imprimir</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadXmlInvoice}
                className="py-3 px-3 bg-white border border-stone-300 hover:bg-stone-50 text-stone-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              >
                <Download className="w-4 h-4 text-[#588157]" />
                <span>Bajar XML</span>
              </button>

              <button
                type="button"
                onClick={handleFinalizeAndClose}
                className="py-3 px-3 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>Finalizar y Salir</span>
              </button>
            </div>

          </div>
        ) : (
          /* ===================== VIEW 2: PAYMENT CONFIGURATION ===================== */
          <form onSubmit={handleProcessPayment} className="space-y-4">
            
            {/* Total to pay banner */}
            <div className="p-4 rounded-2xl bg-stone-900 text-white flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#a9b994] block">
                  {isSimplified 
                    ? 'Total de la Cuenta (Régimen Simplificado • 10% Serv Ley 4946):' 
                    : 'Total de la Cuenta (con IVA 13% + 10% Serv):'}
                </span>
                <span className="text-2xl sm:text-3xl font-black tracking-tight">
                  ₡{total.toLocaleString()}
                </span>
              </div>
              <span className="text-xs text-stone-300 font-semibold px-2.5 py-1 rounded-lg bg-white/10 border border-white/10">
                {items.length} ítems
              </span>
            </div>

            {/* Mode Toggle: Pago Único vs Pago Mixto */}
            <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-2xl border border-stone-200/80">
              <button
                type="button"
                onClick={() => setPaymentMode('single')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                  paymentMode === 'single'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Pago Único (1 Método)
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMode('mixed');
                  if (mixedTotalAssigned === 0) {
                    handleSetHalfAndHalf();
                  }
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  paymentMode === 'mixed'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <SplitSquareVertical className="w-3.5 h-3.5 text-[#588157]" />
                <span>Pago Mixto (Efectivo + Tarjeta)</span>
              </button>
            </div>

            {/* ================= PAGO ÚNICO ================= */}
            {paymentMode === 'single' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSingleMethod('Tarjeta')}
                    className={`p-3 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      singleMethod === 'Tarjeta'
                        ? 'bg-stone-900 border-stone-900 text-white shadow-xs'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    <CreditCard className={`w-5 h-5 ${singleMethod === 'Tarjeta' ? 'text-[#a9b994]' : 'text-stone-500'}`} />
                    <span className="text-xs font-bold">Tarjeta</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSingleMethod('Efectivo')}
                    className={`p-3 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      singleMethod === 'Efectivo'
                        ? 'bg-stone-900 border-stone-900 text-white shadow-xs'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    <Banknote className={`w-5 h-5 ${singleMethod === 'Efectivo' ? 'text-[#a9b994]' : 'text-stone-500'}`} />
                    <span className="text-xs font-bold">Efectivo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSingleMethod('SINPE Móvil')}
                    className={`p-3 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      singleMethod === 'SINPE Móvil'
                        ? 'bg-stone-900 border-stone-900 text-white shadow-xs'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'
                    }`}
                  >
                    <Smartphone className={`w-5 h-5 ${singleMethod === 'SINPE Móvil' ? 'text-[#a9b994]' : 'text-stone-500'}`} />
                    <span className="text-xs font-bold">SINPE Móvil</span>
                  </button>
                </div>

                {singleMethod === 'Efectivo' && (
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">
                        Monto Recibido del Cliente (₡)
                      </label>
                      <input
                        type="number"
                        placeholder={`₡${total.toLocaleString()}`}
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#588157]/40 bg-white"
                        autoFocus
                        required
                      />
                    </div>

                    {singleCashGivenNum > 0 && (
                      <div className="flex justify-between items-center text-xs pt-1 border-t border-stone-200">
                        <span className="font-semibold text-stone-600">Cambio / Vuelto:</span>
                        <span className={`text-base font-black ${singleChangeDue >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {singleCashGivenNum < total 
                            ? `Faltan ₡${(total - singleCashGivenNum).toLocaleString()}` 
                            : `₡${singleChangeDue.toLocaleString()}`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {singleMethod === 'SINPE Móvil' && (
                  <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-950">Número SINPE Móvil Comercio:</span>
                      <span className="font-black text-emerald-900 text-sm">{tenant.phone}</span>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-900 uppercase mb-1">
                        Número de Comprobante / Referencia (Opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. #REF-902834"
                        value={sinpeRef}
                        onChange={(e) => setSinpeRef(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-emerald-300 text-xs text-stone-900 bg-white focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {singleMethod === 'Tarjeta' && (
                  <div className="p-3 bg-stone-50 border border-stone-200 rounded-2xl text-xs text-stone-600 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#588157] shrink-0" />
                    <span>Cobro procesado mediante terminal datáfono bancario.</span>
                  </div>
                )}
              </div>
            )}

            {/* ================= PAGO MIXTO (COMBINADO) ================= */}
            {paymentMode === 'mixed' && (
              <div className="space-y-3.5 bg-stone-50 p-4 rounded-2xl border border-stone-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-stone-800 uppercase">
                    Distribuir Pago entre Métodos:
                  </span>
                  <button
                    type="button"
                    onClick={handleSetHalfAndHalf}
                    className="text-[11px] text-[#588157] font-bold hover:underline"
                  >
                    Dividir 50% / 50%
                  </button>
                </div>

                {/* 1. Efectivo in Mixed */}
                <div className="p-3 bg-white rounded-xl border border-stone-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                      <Banknote className="w-4 h-4 text-[#588157]" />
                      <span>1. Efectivo a Cobrar</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleFillRemainingCash}
                      className="text-[10px] font-bold text-stone-500 hover:text-stone-800 underline"
                    >
                      Poner restante
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-stone-400 block mb-0.5">Monto de la cuenta</span>
                      <input
                        type="number"
                        min={0}
                        value={mixedCash || ''}
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value));
                          setMixedCash(val);
                          if (mixedCashGiven < val) setMixedCashGiven(val);
                        }}
                        placeholder="₡0"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-bold text-stone-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-stone-400 block mb-0.5">Billete recibido</span>
                      <input
                        type="number"
                        min={0}
                        value={mixedCashGiven || ''}
                        onChange={(e) => setMixedCashGiven(Math.max(0, Number(e.target.value)))}
                        placeholder="₡0"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-bold text-stone-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  {mixedCashGiven > mixedCash && mixedCash > 0 && (
                    <div className="text-[11px] text-emerald-800 font-bold text-right pt-0.5">
                      Vuelto en efectivo: ₡{mixedChangeDue.toLocaleString()}
                    </div>
                  )}
                </div>

                {/* 2. Tarjeta in Mixed */}
                <div className="p-3 bg-white rounded-xl border border-stone-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-[#588157]" />
                      <span>2. Tarjeta Crédito / Débito</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleFillRemainingCard}
                      className="text-[10px] font-bold text-stone-500 hover:text-stone-800 underline"
                    >
                      Poner restante
                    </button>
                  </div>

                  <input
                    type="number"
                    min={0}
                    value={mixedCard || ''}
                    onChange={(e) => setMixedCard(Math.max(0, Number(e.target.value)))}
                    placeholder="₡0"
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-bold text-stone-900 focus:outline-none"
                  />
                </div>

                {/* 3. SINPE in Mixed */}
                <div className="p-3 bg-white rounded-xl border border-stone-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-[#588157]" />
                      <span>3. SINPE Móvil</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleFillRemainingSinpe}
                      className="text-[10px] font-bold text-stone-500 hover:text-stone-800 underline"
                    >
                      Poner restante
                    </button>
                  </div>

                  <input
                    type="number"
                    min={0}
                    value={mixedSinpe || ''}
                    onChange={(e) => setMixedSinpe(Math.max(0, Number(e.target.value)))}
                    placeholder="₡0"
                    className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-bold text-stone-900 focus:outline-none"
                  />
                </div>

                {/* Mixed Balance Summary */}
                <div className="p-3 bg-white rounded-xl border border-stone-200 text-xs space-y-1">
                  <div className="flex justify-between font-semibold text-stone-600">
                    <span>Total Abonado:</span>
                    <span>₡{mixedTotalAssigned.toLocaleString()} de ₡{total.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center font-bold pt-1 border-t border-stone-100">
                    <span>Faltante por cubrir:</span>
                    <span className={`text-sm ${mixedRemaining === 0 ? 'text-emerald-700' : 'text-amber-600 font-black'}`}>
                      {mixedRemaining === 0 ? '¡Completo ✓!' : `₡${mixedRemaining.toLocaleString()}`}
                    </span>
                  </div>
                </div>

              </div>
            )}

            {/* Action Submit & Print */}
            <button
              type="submit"
              disabled={isProcessing || !canSubmit()}
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold text-sm hover:bg-stone-800 disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-xs"
            >
              {isProcessing ? (
                <span>Emitiendo Factura Hacienda CR...</span>
              ) : (
                <>
                  <Printer className="w-4 h-4 text-[#a9b994]" />
                  <span>Cobrar ₡{total.toLocaleString()} e Imprimir Factura</span>
                </>
              )}
            </button>

          </form>
        )}

      </div>
    </div>
  );
};
