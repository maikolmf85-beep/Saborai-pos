import React, { useState, useEffect } from 'react';
import { 
  X, 
  Printer, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  Receipt, 
  DollarSign, 
  CreditCard, 
  Smartphone,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Clock,
  User,
  Building2,
  FileText
} from 'lucide-react';
import { ZReportData, ConsolidatedZReportData } from '../types/cashShift';
import { soundService } from '../services/soundEffects';

interface ZReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: ZReportData | null;
  consolidatedReport?: ConsolidatedZReportData | null;
}

export const ZReportModal: React.FC<ZReportModalProps> = ({
  isOpen,
  onClose,
  report,
  consolidatedReport
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen || (!report && !consolidatedReport)) return null;

  const handlePrint = () => {
    soundService.playKeyClickSound();
    window.print();
  };

  const generatePlainTextZReport = (): string => {
    const divider = '==========================================\n';
    const subDivider = '------------------------------------------\n';

    if (consolidatedReport) {
      let text = '';
      text += `${consolidatedReport.tenantName.toUpperCase()}\n`;
      text += `Cedula: ${consolidatedReport.cedulaJuridica}\n`;
      text += `${consolidatedReport.location}\n`;
      text += divider;
      text += `REPORTE Z CONSOLIDADO MULTI-CAJAS\n`;
      text += `Sucursal: ${consolidatedReport.branchCode} | Fecha: ${consolidatedReport.reportDate}\n`;
      text += `Generado: ${new Date(consolidatedReport.generatedAt).toLocaleString('es-CR')}\n`;
      text += `Por: ${consolidatedReport.generatedBy}\n`;
      text += divider;
      text += `RESUMEN GLOBAL DE VENTAS\n`;
      text += `Comprobantes Emitidos: ${consolidatedReport.totals?.invoicesCount ?? 0}\n`;
      text += `Subtotal Grav/Exento:  CRC ${(consolidatedReport.totals?.subtotal ?? 0).toLocaleString()}\n`;
      text += `IVA Trasladado (13%):  CRC ${(consolidatedReport.totals?.taxTotal ?? 0).toLocaleString()}\n`;
      text += `Servicio Rest. (10%):  CRC ${(consolidatedReport.totals?.service10Total ?? 0).toLocaleString()}\n`;
      text += subDivider;
      text += `VENTA TOTAL:           CRC ${(consolidatedReport.totals?.grossTotal ?? 0).toLocaleString()}\n`;
      text += subDivider;
      text += `AUDITORIA DE GAVETAS DE EFECTIVO\n`;
      text += `(+) Fondos Iniciales:  CRC ${(consolidatedReport.totals?.initialFloatTotal ?? 0).toLocaleString()}\n`;
      text += `(+) Ventas Efectivo:   CRC ${(consolidatedReport.totals?.cashTotal ?? 0).toLocaleString()}\n`;
      text += `(=) Esperado Gavetas:  CRC ${(consolidatedReport.totals?.expectedCashTotal ?? 0).toLocaleString()}\n`;
      text += `(✓) Declarado Real:    CRC ${(consolidatedReport.totals?.countedCashTotal ?? 0).toLocaleString()}\n`;
      text += `DIFERENCIA TOTAL:      CRC ${(consolidatedReport.totals?.differenceTotal ?? 0).toLocaleString()}\n`;
      text += divider;
      text += `DESGLOSE POR TERMINAL / CAJA:\n`;
      consolidatedReport.registersSummary.forEach((r) => {
        text += `• ${r.registerName} (DGT: ${r.terminalCode}): CRC ${r.totalSales.toLocaleString()} (Dif: CRC ${r.difference.toLocaleString()})\n`;
      });
      text += divider;
      text += `\n\n\n_____________________   _____________________\n`;
      text += `  Firma Auditor/Admin     Firma Gerencia\n\n\n`;
      return text;
    }

    if (report) {
      let text = '';
      text += `${report.tenantName.toUpperCase()}\n`;
      text += `Cedula: ${report.cedulaJuridica}\n`;
      text += `${report.location}\n`;
      text += divider;
      text += `CORTE DE CAJA "REPORTE Z"\n`;
      text += `TURNO #${report.shiftNumber} • ${report.cashRegisterName || 'Caja'} (DGT: ${report.terminalId})\n`;
      text += `Apertura: ${new Date(report.openedAt).toLocaleString('es-CR')}\n`;
      text += `Cierre:   ${new Date(report.closedAt).toLocaleString('es-CR')}\n`;
      text += `Cajero:   ${report.cashierName}\n`;
      text += divider;
      text += `RESUMEN DE VENTAS FACTURADAS\n`;
      text += `Comprobantes Emitidos: ${report.salesSummary?.invoicesCount ?? 0}\n`;
      text += `Subtotal:              CRC ${(report.salesSummary?.subtotal ?? 0).toLocaleString()}\n`;
      text += `IVA (13%):             CRC ${(report.salesSummary?.taxTotal ?? 0).toLocaleString()}\n`;
      text += `Servicio (10%):        CRC ${(report.salesSummary?.service10Total ?? 0).toLocaleString()}\n`;
      text += subDivider;
      text += `VENTA BRUTA TOTAL:     CRC ${(report.salesSummary?.grossTotal ?? 0).toLocaleString()}\n`;
      text += subDivider;
      text += `VENTAS POR MEDIO DE PAGO\n`;
      text += `Efectivo:              CRC ${(report.salesSummary?.cashTotal ?? 0).toLocaleString()}\n`;
      text += `Tarjetas (Datáfono):   CRC ${(report.salesSummary?.cardTotal ?? 0).toLocaleString()}\n`;
      if (report.cardSummary?.dataphonesBreakdown && report.cardSummary.dataphonesBreakdown.some(d => (d.amount ?? 0) > 0)) {
        report.cardSummary.dataphonesBreakdown.forEach((df, i) => {
          text += `  • ${df.name || `Datáfono ${i+1}`}: CRC ${(df.amount ?? 0).toLocaleString()}\n`;
        });
        text += `  Total Lotes Tarjeta: CRC ${(report.cardSummary.counted ?? 0).toLocaleString()}\n`;
        text += `  Diferencia Lotes:    CRC ${(report.cardSummary.difference ?? 0).toLocaleString()}\n`;
      }
      text += `SINPE Móvil:           CRC ${(report.salesSummary?.sinpeTotal ?? 0).toLocaleString()}\n`;
      text += subDivider;
      text += `AUDITORIA DE GAVETA DE EFECTIVO\n`;
      text += `(+) Fondo Inicial:     CRC ${(report.cashFlowSummary?.initialFloat ?? 0).toLocaleString()}\n`;
      text += `(+) Ventas Efectivo:   CRC ${(report.cashFlowSummary?.cashSales ?? 0).toLocaleString()}\n`;
      if ((report.cashFlowSummary?.inflows ?? 0) > 0) {
        text += `(+) Ingresos:          CRC ${(report.cashFlowSummary?.inflows ?? 0).toLocaleString()}\n`;
      }
      if ((report.cashFlowSummary?.outflows ?? 0) > 0) {
        text += `(-) Egresos:          -CRC ${(report.cashFlowSummary?.outflows ?? 0).toLocaleString()}\n`;
      }
      text += `(=) Efectivo Esperado: CRC ${(report.cashFlowSummary?.expectedCash ?? 0).toLocaleString()}\n`;
      text += `(✓) Efectivo Contado:  CRC ${(report.cashFlowSummary?.countedCash ?? 0).toLocaleString()}\n`;
      text += `DIFERENCIA CAJA:       CRC ${(report.cashFlowSummary?.difference ?? 0).toLocaleString()}\n`;
      text += divider;
      text += `\n\n\n_____________________   _____________________\n`;
      text += `   Firma Cajero(a)         Firma Gerencia\n\n\n`;
      return text;
    }

    return '';
  };

  const handleDownloadTxt = () => {
    soundService.playSuccessChime();
    const text = generatePlainTextZReport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reporte_Z_${report ? `Turno_${report.shiftNumber}` : 'Consolidado'}_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const isExact = report 
    ? (report?.cashFlowSummary?.status === 'EXACT' || report?.cashFlowSummary?.difference === 0) 
    : ((consolidatedReport?.totals?.differenceTotal ?? 0) === 0);
  const isShortage = report 
    ? (report?.cashFlowSummary?.status === 'SHORTAGE' || (report?.cashFlowSummary?.difference ?? 0) < 0) 
    : ((consolidatedReport?.totals?.differenceTotal ?? 0) < 0);
  const isSurplus = report 
    ? (report?.cashFlowSummary?.status === 'SURPLUS' || (report?.cashFlowSummary?.difference ?? 0) > 0) 
    : ((consolidatedReport?.totals?.differenceTotal ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-xl max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Controls */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center font-bold shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <span>
                  {consolidatedReport 
                    ? 'Reporte Z Consolidado - Multi-Cajas' 
                    : `Reporte Z - Cierre de Turno #${report?.shiftNumber}`}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-800">
                  {consolidatedReport ? 'Auditoría Global' : 'Oficial'}
                </span>
              </h3>
              <p className="text-xs text-stone-500">
                {consolidatedReport
                  ? 'Cierre global acumulado de todas las terminales y cajas del restaurante'
                  : 'Auditoría fiscal y cuadre de caja de restaurante'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Paper Width Selector */}
            <div className="flex items-center bg-stone-200/80 p-0.5 rounded-xl text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  paperWidth === '80mm' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-600'
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  paperWidth === '58mm' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-600'
                }`}
              >
                58mm
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Thermal Preview Area */}
        <div className="p-4 sm:p-6 overflow-y-auto bg-stone-100 flex justify-center">
          
          {/* ======================================================== */}
          {/* OPTION A: CONSOLIDATED MULTI-REGISTER Z REPORT           */}
          {/* ======================================================== */}
          {consolidatedReport ? (
            <div 
              className={`printable-zreport paper-${paperWidth} bg-white shadow-xl border border-stone-300 p-5 rounded-2xl font-mono text-xs text-stone-900 transition-all ${
                paperWidth === '80mm' ? 'max-w-[420px] w-full' : 'max-w-[320px] w-full text-[11px]'
              }`}
            >
              {/* Thermal Header */}
              <div className="text-center pb-3 border-b-2 border-dashed border-stone-300 space-y-1">
                <h2 className="text-base font-black tracking-wider uppercase">{consolidatedReport.tenantName}</h2>
                <div className="text-[11px] text-stone-600">Cédula: {consolidatedReport.cedulaJuridica}</div>
                <div className="text-[10px] text-stone-500">{consolidatedReport.location}</div>
                <div className="text-[10px] font-bold text-stone-800 uppercase mt-1">
                  REPORTE Z CONSOLIDADO DEL NEGOCIO
                </div>
                <div className="text-[11px] font-bold bg-stone-900 text-white py-1 rounded mt-1">
                  TODAS LAS CAJAS • SUCURSAL {consolidatedReport.branchCode}
                </div>
              </div>

              {/* Report Metadata */}
              <div className="py-2.5 border-b border-dashed border-stone-300 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-stone-500">Fecha de Operación:</span>
                  <span className="font-bold">{consolidatedReport.reportDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Hora de Generación:</span>
                  <span className="font-bold">{new Date(consolidatedReport.generatedAt).toLocaleString('es-CR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Generado Por:</span>
                  <span className="font-bold">{consolidatedReport.generatedBy}</span>
                </div>
              </div>

              {/* Consolidated Sales Totals */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Resumen Global de Facturación
                </div>
                <div className="flex justify-between">
                  <span>Comprobantes Emitidos:</span>
                  <span className="font-bold">{consolidatedReport.totals?.invoicesCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Subtotal Gravado/Exento:</span>
                  <span>₡{(consolidatedReport.totals?.subtotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>IVA Trasladado (13%):</span>
                  <span>₡{(consolidatedReport.totals?.taxTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Servicio Restaurante (10%):</span>
                  <span>₡{(consolidatedReport.totals?.service10Total ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-stone-200 text-sm font-black">
                  <span>VENTA TOTAL CONSOLIDADA:</span>
                  <span>₡{(consolidatedReport.totals?.grossTotal ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Sales by Payment Method */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Consolidado por Medio de Pago
                </div>
                <div className="flex justify-between items-center">
                  <span>💵 Efectivo Total:</span>
                  <span className="font-bold">₡{(consolidatedReport.totals?.cashTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>💳 Tarjetas (Datáfono) Total:</span>
                  <span className="font-bold">₡{(consolidatedReport.totals?.cardTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>📱 SINPE Móvil Total:</span>
                  <span className="font-bold">₡{(consolidatedReport.totals?.sinpeTotal ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Consolidated Cash Flow */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Auditoría Global de Gavetas de Efectivo
                </div>
                <div className="flex justify-between">
                  <span>(+) Fondos Iniciales (Todas las cajas):</span>
                  <span>₡{(consolidatedReport.totals?.initialFloatTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>(+) Ventas Totales en Efectivo:</span>
                  <span>₡{(consolidatedReport.totals?.cashTotal ?? 0).toLocaleString()}</span>
                </div>
                {(consolidatedReport.totals?.inflowsTotal ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>(+) Ingresos Totales:</span>
                    <span>+₡{(consolidatedReport.totals?.inflowsTotal ?? 0).toLocaleString()}</span>
                  </div>
                )}
                {(consolidatedReport.totals?.outflowsTotal ?? 0) > 0 && (
                  <div className="flex justify-between text-rose-700 font-bold">
                    <span>(-) Egresos Totales:</span>
                    <span>-₡{(consolidatedReport.totals?.outflowsTotal ?? 0).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                  <span>(=) Efectivo Teórico Esperado:</span>
                  <span>₡{(consolidatedReport.totals?.expectedCashTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black text-sm">
                  <span>(✓) Efectivo Real Declarado:</span>
                  <span>₡{(consolidatedReport.totals?.countedCashTotal ?? 0).toLocaleString()}</span>
                </div>

                <div className={`p-2 rounded-xl text-center font-bold text-xs mt-2 ${
                  isExact 
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                    : isShortage
                    ? 'bg-rose-50 text-rose-900 border border-rose-300'
                    : 'bg-amber-50 text-amber-900 border border-amber-300'
                }`}>
                  {isExact && '✓ CUADRE GENERAL EXACTO (₡0)'}
                  {isShortage && `⚠ FALTANTE GENERAL: -₡${Math.abs(consolidatedReport.totals?.differenceTotal ?? 0).toLocaleString()}`}
                  {isSurplus && `ℹ SOBRANTE GENERAL: +₡${(consolidatedReport.totals?.differenceTotal ?? 0).toLocaleString()}`}
                </div>
              </div>

              {/* Breakdown Per Cash Register */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Desglose Detallado por Caja / Terminal
                </div>
                {consolidatedReport.registersSummary.map((reg) => (
                  <div key={reg.registerId} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1 text-[11px]">
                    <div className="flex justify-between items-center font-black text-stone-900 border-b border-stone-200 pb-1">
                      <span>{reg.registerName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-stone-200 rounded font-mono">DGT: {reg.terminalCode}</span>
                    </div>
                    <div className="flex justify-between text-stone-600">
                      <span>Turnos procesados:</span>
                      <span className="font-bold">{reg.shiftsCount}</span>
                    </div>
                    <div className="flex justify-between text-stone-600">
                      <span>Ventas:</span>
                      <span className="font-bold">₡{reg.totalSales.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-stone-500">
                      <span>Efec: ₡{reg.cashSales.toLocaleString()}</span>
                      <span>Tarj: ₡{reg.cardSales.toLocaleString()}</span>
                      <span>SINPE: ₡{reg.sinpeSales.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t border-dashed border-stone-200 pt-1">
                      <span>Esperado / Contado:</span>
                      <span className="font-bold">₡{reg.expectedCash.toLocaleString()} / ₡{reg.countedCash.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Diferencia:</span>
                      <span className={reg.difference === 0 ? 'text-emerald-700' : reg.difference < 0 ? 'text-rose-700' : 'text-amber-700'}>
                        {reg.difference === 0 ? '₡0 (Exacto)' : reg.difference < 0 ? `-₡${Math.abs(reg.difference).toLocaleString()}` : `+₡${reg.difference.toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Signatures */}
              <div className="pt-6 pb-2 grid grid-cols-2 gap-4 text-center text-[10px] text-stone-500">
                <div>
                  <div className="border-b border-stone-400 pb-8 mb-1"></div>
                  <span>Auditor / Administrador</span>
                </div>
                <div>
                  <div className="border-b border-stone-400 pb-8 mb-1"></div>
                  <span>Gerencia General</span>
                </div>
              </div>

              <div className="text-center pt-3 text-[9px] text-stone-400">
                SaborAI POS • Sistema Multi-Caja & Gastronomía Inteligente
              </div>

              {/* Thermal Cutter Feed Guide */}
              <div className="pt-3 pb-6 text-center select-none">
                <div className="font-mono text-[9px] text-stone-400 border-b border-dashed border-stone-300 pb-1">
                  - - - - CORTE DE PAPEL - - - -
                </div>
                <div className="h-6 print:h-12" />
              </div>
            </div>
          ) : report ? (
            /* ======================================================== */
            /* OPTION B: INDIVIDUAL REGISTER Z REPORT                   */
            /* ======================================================== */
            <div 
              className={`printable-zreport paper-${paperWidth} bg-white shadow-xl border border-stone-300 p-5 rounded-2xl font-mono text-xs text-stone-900 transition-all ${
                paperWidth === '80mm' ? 'max-w-[400px] w-full' : 'max-w-[300px] w-full text-[11px]'
              }`}
            >
              {/* Thermal Header */}
              <div className="text-center pb-3 border-b-2 border-dashed border-stone-300 space-y-1">
                <h2 className="text-base font-black tracking-wider uppercase">{report.tenantName}</h2>
                <div className="text-[11px] text-stone-600">Cédula: {report.cedulaJuridica}</div>
                <div className="text-[10px] text-stone-500">{report.location}</div>
                <div className="text-[10px] font-bold text-stone-800 uppercase mt-1">
                  COMPROBANTE DE CORTE FISCAL "REPORTE Z"
                </div>
                <div className="text-[11px] font-bold bg-stone-900 text-white py-1 rounded mt-1">
                  TURNO #{report.shiftNumber} • {report.cashRegisterName || 'Caja'} (DGT: {report.terminalId})
                </div>
              </div>

              {/* Shift Metadata */}
              <div className="py-2.5 border-b border-dashed border-stone-300 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-stone-500">Apertura:</span>
                  <span className="font-bold">{new Date(report.openedAt).toLocaleString('es-CR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Cierre:</span>
                  <span className="font-bold">{new Date(report.closedAt).toLocaleString('es-CR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Cajero:</span>
                  <span className="font-bold">{report.cashierName}</span>
                </div>
                {report.supervisorName && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Supervisor:</span>
                    <span className="font-bold">{report.supervisorName}</span>
                  </div>
                )}
              </div>

              {/* Sales Summary & Taxes */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Resumen de Ventas Facturadas
                </div>
                <div className="flex justify-between">
                  <span>Comprobantes Emitidos:</span>
                  <span className="font-bold">{report.salesSummary?.invoicesCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Subtotal Gravado/Exento:</span>
                  <span>₡{(report.salesSummary?.subtotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>IVA Trasladado (Hacienda):</span>
                  <span>₡{(report.salesSummary?.taxTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Servicio Restaurante (10% Ley):</span>
                  <span>₡{(report.salesSummary?.service10Total ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-stone-200 text-sm font-black">
                  <span>VENTA TOTAL BRUTA:</span>
                  <span>₡{(report.salesSummary?.grossTotal ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Sales by Payment Method */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Ventas por Medio de Pago
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <span>💵 Efectivo:</span>
                  </span>
                  <span className="font-bold">₡{(report.salesSummary?.cashTotal ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <span>💳 Tarjetas (Datáfono):</span>
                  </span>
                  <span className="font-bold">₡{(report.salesSummary?.cardTotal ?? 0).toLocaleString()}</span>
                </div>

                {/* Desglose Multi-Datáfono (Lotes) si existen registros */}
                {report.cardSummary?.dataphonesBreakdown && report.cardSummary.dataphonesBreakdown.length > 0 && report.cardSummary.dataphonesBreakdown.some(d => (d.amount ?? 0) > 0) && (
                  <div className="pt-2 mt-1 border-t border-dotted border-stone-300 space-y-1 bg-stone-50/60 p-2 rounded-lg">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-stone-500">
                      Cierre de Lotes por Datáfono:
                    </div>
                    {report.cardSummary.dataphonesBreakdown.map((df, i) => (
                      <div key={df.id || i} className="flex justify-between text-[11px] text-stone-600">
                        <span className="truncate pr-2">• {df.name || `Datáfono ${i + 1}`}:</span>
                        <span className="font-mono font-bold">₡{(df.amount ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-[11px] pt-1 border-t border-stone-200 font-bold text-stone-800">
                      <span>Total Lotes Declarado:</span>
                      <span className="font-mono">₡{(report.cardSummary.counted ?? 0).toLocaleString()}</span>
                    </div>
                    {report.cardSummary.difference !== 0 && (
                      <div className={`flex justify-between text-[10px] font-bold ${
                        (report.cardSummary.difference ?? 0) < 0 ? 'text-rose-700' : 'text-amber-700'
                      }`}>
                        <span>Diferencia Lotes:</span>
                        <span className="font-mono">
                          {(report.cardSummary.difference ?? 0) > 0 ? '+' : ''}₡{(report.cardSummary.difference ?? 0).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <span>📱 SINPE Móvil:</span>
                  </span>
                  <span className="font-bold">₡{(report.salesSummary?.sinpeTotal ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Cash Flow & Drawer Audit */}
              <div className="py-3 border-b-2 border-dashed border-stone-300 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Auditoría de Gaveta de Efectivo
                </div>
                <div className="flex justify-between">
                  <span>(+) Fondo Inicial de Caja:</span>
                  <span>₡{(report.cashFlowSummary?.initialFloat ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>(+) Ventas en Efectivo:</span>
                  <span>₡{(report.cashFlowSummary?.cashSales ?? 0).toLocaleString()}</span>
                </div>
                {(report.cashFlowSummary?.inflows ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>(+) Ingresos Adicionales:</span>
                    <span>₡{(report.cashFlowSummary?.inflows ?? 0).toLocaleString()}</span>
                  </div>
                )}
                {(report.cashFlowSummary?.outflows ?? 0) > 0 && (
                  <div className="flex justify-between text-rose-700 font-bold">
                    <span>(-) Egresos / Retiros:</span>
                    <span>-₡{(report.cashFlowSummary?.outflows ?? 0).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-stone-200 font-bold">
                  <span>(=) Efectivo Esperado en Gaveta:</span>
                  <span>₡{(report.cashFlowSummary?.expectedCash ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-black text-sm">
                  <span>(✓) Efectivo Real Contado:</span>
                  <span>₡{(report.cashFlowSummary?.countedCash ?? 0).toLocaleString()}</span>
                </div>

                {/* Discrepancy Status */}
                <div className={`p-2 rounded-xl text-center font-bold text-xs mt-2 ${
                  isExact 
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                    : isShortage
                    ? 'bg-rose-50 text-rose-900 border border-rose-300'
                    : 'bg-amber-50 text-amber-900 border border-amber-300'
                }`}>
                  {isExact && '✓ CUADRE EXACTO (Diferencia: ₡0)'}
                  {isShortage && `⚠ FALTANTE DE CAJA: -₡${Math.abs(report.cashFlowSummary?.difference ?? 0).toLocaleString()}`}
                  {isSurplus && `ℹ SOBRANTE DE CAJA: +₡${(report.cashFlowSummary?.difference ?? 0).toLocaleString()}`}
                </div>
              </div>

              {/* Registered Movements during shift if any */}
              {report.movements && report.movements.length > 0 && (
                <div className="py-2.5 border-b border-dashed border-stone-300 space-y-1 text-[10px]">
                  <div className="font-bold text-stone-500 uppercase">Detalle de Egresos e Ingresos:</div>
                  {report.movements.map((mov) => (
                    <div key={mov.id} className="flex justify-between">
                      <span>{mov.type === 'OUTFLOW' ? '🔴 Egreso' : '🟢 Ingreso'}: {mov.reason}</span>
                      <span className="font-bold">₡{mov.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Signature Area */}
              <div className="pt-6 pb-2 grid grid-cols-2 gap-4 text-center text-[10px] text-stone-500">
                <div>
                  <div className="border-b border-stone-400 pb-8 mb-1"></div>
                  <span>Firma Cajero(a)</span>
                </div>
                <div>
                  <div className="border-b border-stone-400 pb-8 mb-1"></div>
                  <span>Firma Gerencia / Admin</span>
                </div>
              </div>

              <div className="text-center pt-3 text-[9px] text-stone-400">
                SaborAI POS • Sistema de Gastronomía e Inteligencia Operativa
              </div>

              {/* Thermal Cutter Feed Guide */}
              <div className="pt-3 pb-6 text-center select-none">
                <div className="font-mono text-[9px] text-stone-400 border-b border-dashed border-stone-300 pb-1">
                  - - - - CORTE DE PAPEL - - - -
                </div>
                <div className="h-6 print:h-12" />
              </div>
            </div>
          ) : null}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50 flex flex-wrap items-center justify-between gap-2 no-print">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Cerrar
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadTxt}
              className="px-3.5 py-2 bg-white hover:bg-stone-100 text-stone-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-stone-200 shadow-2xs"
              title="Descargar copia del corte en formato texto / ESC-POS"
            >
              <Download className="w-4 h-4 text-stone-600" />
              <span className="hidden sm:inline">Guardar TXT</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer active:scale-95 ring-2 ring-stone-900/20"
              title="Imprimir en impresora térmica (80mm / 58mm)"
            >
              <Printer className="w-4 h-4 text-[#a9b994]" />
              <span>Imprimir en Térmica ({paperWidth})</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
