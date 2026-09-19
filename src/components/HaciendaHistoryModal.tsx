import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Search, 
  X, 
  Download, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  RefreshCw,
  Building2
} from 'lucide-react';
import { ElectronicInvoiceCR, TenantInfo } from '../types';
import { haciendaService } from '../services/haciendaService';
import { downloadXmlFile } from '../services/haciendaXml';

interface HaciendaHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
}

export const HaciendaHistoryModal: React.FC<HaciendaHistoryModalProps> = ({ isOpen, onClose, tenant }) => {
  const [invoices, setInvoices] = useState<ElectronicInvoiceCR[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  useEffect(() => {
    if (isOpen) {
      const unsubscribe = haciendaService.subscribe(setInvoices);
      return unsubscribe;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredInvoices = invoices.filter(inv => 
    inv.clave50Digitos.includes(searchTerm) || 
    (inv.receptor.nombre || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACEPTADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> ACEPTADO
          </span>
        );
      case 'RECHAZADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
            <XCircle className="w-3 h-3" /> RECHAZADO
          </span>
        );
      case 'PROCESANDO':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 animate-spin" /> PROCESANDO
          </span>
        );
    }
  };

  const handleResend = (clave: string) => {
    haciendaService.resendInvoice(clave);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-stone-200 rounded-3xl w-full max-w-5xl shadow-2xl relative flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-sm">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-stone-900 tracking-tight">Historial DGT Hacienda</h2>
              <p className="text-xs text-stone-500">Documentos electrónicos emitidos a Hacienda CR v4.3</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="p-4 sm:px-6 bg-stone-50 border-b border-stone-200 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Buscar por Clave 50 dígitos o nombre del cliente..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-300 rounded-xl text-sm focus:ring-2 focus:ring-[#588157] focus:border-[#588157] transition-all"
            />
          </div>
        </div>

        {/* Invoices List */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {invoices.length === 0 ? (
            <div className="text-center py-16 text-stone-500 flex flex-col items-center">
              <FileText className="w-12 h-12 text-stone-300 mb-3" />
              <p className="text-sm">No se han emitido documentos electrónicos aún.</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-stone-500">
              <p className="text-sm">No hay resultados para tu búsqueda.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredInvoices.map(inv => (
                <div key={inv.clave50Digitos} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-stone-200 rounded-2xl hover:border-[#588157]/40 transition-colors gap-4">
                  <div className="space-y-1.5 flex-1 overflow-hidden">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-stone-900 truncate">
                        {inv.receptor.nombre || 'Cliente General'}
                      </span>
                      {getStatusBadge(inv.estadoHacienda)}
                    </div>
                    <div className="text-[10px] font-mono text-stone-500 truncate" title={inv.clave50Digitos}>
                      Clave: {inv.clave50Digitos}
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-stone-600 font-medium">
                      <span>₡{inv.totalComprobante.toLocaleString()}</span>
                      <span>•</span>
                      <span>{inv.fechaEmision.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {inv.xmlContent && (
                      <button
                        onClick={() => downloadXmlFile(inv.xmlContent!, `Factura_${inv.consecutivo}.xml`)}
                        className="p-2 text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-bold"
                        title="Descargar XML Original"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">XML</span>
                      </button>
                    )}
                    
                    {inv.estadoHacienda === 'RECHAZADO' && (
                      <button
                        onClick={() => handleResend(inv.clave50Digitos)}
                        className="px-3 py-2 bg-stone-900 text-white hover:bg-stone-800 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-bold shadow-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reenviar a DGT</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
