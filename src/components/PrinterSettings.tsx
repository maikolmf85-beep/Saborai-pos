import React, { useState, useEffect } from 'react';
import { 
  PrinterConfig, 
  PrinterConnectionType, 
  PrinterRole, 
  PrintReceiptData 
} from '../types/printer';
import { printerService } from '../services/printerService';
import { 
  Printer, 
  Wifi, 
  Bluetooth, 
  Usb, 
  Plus, 
  Check, 
  Trash2,
  FileCheck,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Sliders,
  Sparkles
} from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

export const PrinterSettings: React.FC = () => {
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<PrinterConfig | null>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Formulario temporal
  const [formData, setFormData] = useState<Partial<PrinterConfig>>({
    name: '',
    role: 'caja',
    connectionType: 'network',
    ipAddress: '192.168.1.200',
    port: 9100,
    paperWidth: '80mm',
    enabled: true,
    autoCutter: true,
    openDrawer: true,
    beepOnPrint: false
  });

  useEffect(() => {
    loadPrinters();
  }, []);

  const loadPrinters = () => {
    setPrinters(printerService.loadPrinters());
  };

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const handleOpenAdd = () => {
    setEditingPrinter(null);
    setFormData({
      id: `prn_${Date.now()}`,
      name: '',
      role: 'caja',
      connectionType: 'network',
      ipAddress: '192.168.1.200',
      port: 9100,
      paperWidth: '80mm',
      enabled: true,
      autoCutter: true,
      openDrawer: true,
      beepOnPrint: false
    });
    setShowModal(true);
  };

  const handleOpenEdit = (printer: PrinterConfig) => {
    setEditingPrinter(printer);
    setFormData({ ...printer });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    const prn = printers.find(p => p.id === id);
    const prnName = prn?.name || 'esta impresora';

    setConfirmConfig({
      isOpen: true,
      title: '¿Eliminar configuración de impresora?',
      message: `¿Deseas eliminar la impresora "${prnName}"? Dejará de recibir comandas y comprobantes automáticos.`,
      confirmLabel: 'Sí, eliminar',
      type: 'danger',
      onConfirm: () => {
        printerService.deletePrinter(id);
        loadPrinters();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleToggleEnabled = (printer: PrinterConfig) => {
    const updated = { ...printer, enabled: !printer.enabled };
    printerService.savePrinter(updated);
    loadPrinters();
  };

  const handlePairUsb = async (printerId: string) => {
    const res = await printerService.requestUsbDevice(printerId);
    if (res.success) {
      alert(`✅ Impresora USB emparejada correctamente (VendorID: ${res.vendorId}).`);
      loadPrinters();
    } else {
      alert(`⚠️ ${res.error}`);
    }
  };

  const handlePairBluetooth = async (printerId: string) => {
    const res = await printerService.requestBluetoothDevice(printerId);
    if (res.success) {
      alert(`✅ Impresora Bluetooth emparejada correctamente: ${res.name || 'Dispositivo'}.`);
      loadPrinters();
    } else {
      alert(`⚠️ ${res.error}`);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const newPrinter: PrinterConfig = {
      id: formData.id || `prn_${Date.now()}`,
      name: formData.name,
      role: (formData.role as PrinterRole) || 'caja',
      connectionType: (formData.connectionType as PrinterConnectionType) || 'network',
      ipAddress: formData.ipAddress,
      port: formData.port ? Number(formData.port) : 9100,
      vendorId: formData.vendorId,
      productId: formData.productId,
      macAddress: formData.macAddress,
      paperWidth: formData.paperWidth || '80mm',
      enabled: formData.enabled ?? true,
      autoCutter: formData.autoCutter ?? true,
      openDrawer: formData.openDrawer ?? false,
      beepOnPrint: formData.beepOnPrint ?? false
    };

    printerService.savePrinter(newPrinter);
    setShowModal(false);
    loadPrinters();
  };

  const handleTestPrint = async (printer: PrinterConfig) => {
    setTestingId(printer.id);
    setTestResult(null);

    const sampleReceipt: PrintReceiptData = {
      title: 'SABORAI RESTAURANTE POS',
      subtitle: `PRUEBA DE IMPRESORA (${printer.name})`,
      orderNumber: 'TEST-001',
      tableName: 'Barra 01',
      waiterName: 'Administrador',
      date: new Date().toLocaleString(),
      items: [
        { name: 'Hamburguesa SaborAI Especial', quantity: 1, price: 6500, subtotal: 6500 },
        { name: 'Cerveza Imperial Draft', quantity: 2, price: 2000, subtotal: 4000 }
      ],
      subtotal: 10500,
      serviceCharge: 1050,
      tax: 1365,
      total: 12915,
      footerNotes: [
        `Impresora: ${printer.name} (${printer.connectionType.toUpperCase()})`,
        'Impresion silenciosa sin ventanas de dialogo',
        '¡SaborAI POS Hardware Listo!'
      ]
    };

    try {
      const res = await printerService.printToConfig(printer, sampleReceipt);
      setTestResult({
        id: printer.id,
        success: res.success,
        message: res.success
          ? res.confirmed
            ? `¡Ticket de prueba confirmado por la impresora vía ${res.methodUsed?.toUpperCase()}!`
            : (res.warning || `Solicitud aceptada vía ${res.methodUsed?.toUpperCase()}, pero la impresión física aún no está confirmada. Verifica el ticket.`)
          : (res.error || 'Error al enviar a la impresora')
      });
    } catch (err: any) {
      setTestResult({
        id: printer.id,
        success: false,
        message: err.message || 'Error durante la prueba de impresión'
      });
    } finally {
      setTestingId(null);
      setTimeout(() => setTestResult(null), 4000);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-800/80">
        <div>
          <h2 className="text-2xl font-black text-stone-100 flex items-center gap-2">
            <Printer className="w-6 h-6 text-[#a9b994]" />
            <span>Administración Unificada de Impresoras</span>
          </h2>
          <p className="text-xs text-stone-400 mt-1">
            Configuración y enrutamiento por roles (Caja, Cocina, Bar) mediante Red (IP), USB y Bluetooth con impresión silenciosa.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-stone-100 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm border border-stone-700 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#a9b994]" />
          <span>Agregar Impresora</span>
        </button>
      </div>

      {/* Grid de impresoras configuradas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {printers.map((printer) => {
          const isTesting = testingId === printer.id;
          const result = testResult?.id === printer.id ? testResult : null;

          return (
            <div
              key={printer.id}
              className={`p-6 rounded-3xl bg-stone-900/90 border transition-all flex flex-col justify-between space-y-4 shadow-xl backdrop-blur-sm ${
                printer.enabled 
                  ? 'border-stone-800 hover:border-[#a9b994]/60' 
                  : 'border-stone-800/50 opacity-60'
              }`}
            >
              <div>
                {/* Cabecera de la tarjeta */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 text-[#a9b994] flex items-center justify-center">
                    {printer.connectionType === 'network' && <Wifi className="w-5 h-5 text-[#a9b994]" />}
                    {printer.connectionType === 'bluetooth' && <Bluetooth className="w-5 h-5 text-blue-400" />}
                    {printer.connectionType === 'usb' && <Usb className="w-5 h-5 text-amber-400" />}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-stone-800 text-stone-300 border border-stone-700">
                      Rol: {printer.role.toUpperCase()}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(printer)}
                      className="cursor-pointer text-stone-400 hover:text-stone-200 transition-colors"
                      title={printer.enabled ? 'Deshabilitar impresora' : 'Habilitar impresora'}
                    >
                      {printer.enabled ? (
                        <ToggleRight className="w-7 h-7 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-stone-600" />
                      )}
                    </button>
                  </div>
                </div>

                <h3 className="font-bold text-base text-stone-100">{printer.name}</h3>
                
                <p className="text-xs text-stone-400 mt-1 font-mono">
                  {printer.connectionType === 'network' && `LAN: ${printer.ipAddress || '192.168.1.200'}:${printer.port || 9100}`}
                  {printer.connectionType === 'usb' && (printer.vendorId ? `USB Conectado (VID: ${printer.vendorId})` : 'WebUSB listo para emparejar')}
                  {printer.connectionType === 'bluetooth' && 'Web Bluetooth BLE'}
                </p>

                {/* Especificaciones */}
                <div className="mt-4 pt-3 border-t border-stone-800/80 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-xl bg-stone-950/60 border border-stone-800/60">
                    <span className="block text-[10px] font-bold text-stone-400 uppercase">Ancho Papel:</span>
                    <span className="font-bold text-stone-200">{printer.paperWidth}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-950/60 border border-stone-800/60">
                    <span className="block text-[10px] font-bold text-stone-400 uppercase">Corte:</span>
                    <span className="font-bold text-stone-200">{printer.autoCutter ? 'Automático' : 'Manual'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-950/60 border border-stone-800/60">
                    <span className="block text-[10px] font-bold text-stone-400 uppercase">Gaveta:</span>
                    <span className="font-bold text-stone-200">{printer.openDrawer ? 'Abre Gaveta' : 'Sin Gaveta'}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-950/60 border border-stone-800/60">
                    <span className="block text-[10px] font-bold text-stone-400 uppercase">Aviso Sonoro:</span>
                    <span className="font-bold text-stone-200">{printer.beepOnPrint ? 'Bip Activo' : 'Silencioso'}</span>
                  </div>
                </div>

                {/* Estado o emparejamiento especial */}
                {printer.connectionType === 'usb' && !printer.vendorId && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => handlePairUsb(printer.id)}
                      className="w-full py-1.5 px-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-amber-500/20 transition-all cursor-pointer"
                    >
                      <Usb className="w-3.5 h-3.5" />
                      <span>Emparejar WebUSB</span>
                    </button>
                  </div>
                )}

                {printer.connectionType === 'bluetooth' && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => handlePairBluetooth(printer.id)}
                      className="w-full py-1.5 px-3 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-blue-500/20 transition-all cursor-pointer"
                    >
                      <Bluetooth className="w-3.5 h-3.5" />
                      <span>Emparejar Dispositivo Bluetooth</span>
                    </button>
                  </div>
                )}

                {/* Resultado de la prueba */}
                {result && (
                  <div className={`mt-3 p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
                    result.success 
                      ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' 
                      : 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                  }`}>
                    {result.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{result.message}</span>
                  </div>
                )}
              </div>

              {/* Botones de acción */}
              <div className="pt-2 flex items-center gap-2 border-t border-stone-800/80">
                <button
                  type="button"
                  onClick={() => handleTestPrint(printer)}
                  disabled={isTesting || !printer.enabled}
                  className="flex-1 py-2.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-100 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-stone-700"
                >
                  {isTesting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-[#a9b994] animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <FileCheck className="w-3.5 h-3.5 text-[#a9b994]" />
                      <span>Prueba Silenciosa</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenEdit(printer)}
                  className="p-2.5 rounded-xl border border-stone-700 bg-stone-800 text-stone-300 hover:text-white cursor-pointer"
                  title="Editar Configuración"
                >
                  <Sliders className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(printer.id)}
                  className="p-2.5 rounded-xl border border-rose-900/40 bg-rose-950/20 text-rose-400 hover:bg-rose-950/50 cursor-pointer"
                  title="Eliminar Impresora"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* Modal para Crear / Editar Impresora */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/75 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-stone-900 border border-stone-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative space-y-5 text-stone-100">
            <h3 className="text-xl font-black text-stone-100 flex items-center gap-2">
              <Printer className="w-5 h-5 text-[#a9b994]" />
              <span>{editingPrinter ? 'Editar Impresora' : 'Registrar Nueva Impresora'}</span>
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-300 uppercase mb-1">Nombre Identificador</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Comandera Cocina Caliente"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-700 bg-stone-950 text-xs text-stone-100 focus:border-[#a9b994] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-stone-300 uppercase mb-1">Rol / Estación</label>
                  <select
                    value={formData.role || 'caja'}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as PrinterRole })}
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-700 bg-stone-950 text-xs text-stone-100 focus:border-[#a9b994] focus:outline-none"
                  >
                    <option value="caja">Caja (Facturas & Comprobantes)</option>
                    <option value="cocina">Cocina (Comandas Calientes)</option>
                    <option value="bar">Bar (Bebidas y Cócteles)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-300 uppercase mb-1">Tipo de Conexión</label>
                  <select
                    value={formData.connectionType || 'network'}
                    onChange={(e) => setFormData({ ...formData, connectionType: e.target.value as PrinterConnectionType })}
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-700 bg-stone-950 text-xs text-stone-100 focus:border-[#a9b994] focus:outline-none"
                  >
                    <option value="network">Red (Ethernet / Wi-Fi IP)</option>
                    <option value="usb">USB (WebUSB Directo)</option>
                    <option value="bluetooth">Bluetooth Inalámbrico</option>
                  </select>
                </div>
              </div>

              {/* Opciones condicionales de red */}
              {formData.connectionType === 'network' && (
                <div className="grid grid-cols-3 gap-3 p-3 rounded-2xl bg-stone-950/80 border border-stone-800">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Dirección IP</label>
                    <input
                      type="text"
                      placeholder="192.168.1.200"
                      value={formData.ipAddress || ''}
                      onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 focus:border-[#a9b994] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Puerto (ePOS)</label>
                    <input
                      type="number"
                      placeholder="9100"
                      value={formData.port || 9100}
                      onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-700 bg-stone-900 text-xs text-stone-100 focus:border-[#a9b994] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Ancho del papel */}
              <div>
                <label className="block text-xs font-bold text-stone-300 uppercase mb-1">Ancho del Papel Térmico</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, paperWidth: '80mm' })}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                      formData.paperWidth === '80mm'
                        ? 'border-[#a9b994] bg-[#a9b994]/20 text-[#a9b994]'
                        : 'border-stone-800 bg-stone-950 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    80mm (Estándar Térmico)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, paperWidth: '58mm' })}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                      formData.paperWidth === '58mm'
                        ? 'border-[#a9b994] bg-[#a9b994]/20 text-[#a9b994]'
                        : 'border-stone-800 bg-stone-950 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    58mm (Portátil / Estrecho)
                  </button>
                </div>
              </div>

              {/* Opciones de hardware */}
              <div className="space-y-2 pt-2 border-t border-stone-800">
                <label className="flex items-center gap-2.5 text-xs text-stone-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.autoCutter ?? true}
                    onChange={(e) => setFormData({ ...formData, autoCutter: e.target.checked })}
                    className="rounded border-stone-700 text-[#a9b994] focus:ring-0"
                  />
                  <span>Activar corte automático de papel (Autocutter)</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-stone-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.openDrawer ?? false}
                    onChange={(e) => setFormData({ ...formData, openDrawer: e.target.checked })}
                    className="rounded border-stone-700 text-[#a9b994] focus:ring-0"
                  />
                  <span>Disparar apertura de gaveta de dinero al imprimir</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-stone-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.beepOnPrint ?? false}
                    onChange={(e) => setFormData({ ...formData, beepOnPrint: e.target.checked })}
                    className="rounded border-stone-700 text-[#a9b994] focus:ring-0"
                  />
                  <span>Emitir pitido de aviso sonoro al imprimir (Ideal cocina)</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 text-xs font-bold text-stone-400 hover:text-stone-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#a9b994] hover:bg-[#97a783] text-stone-950 rounded-xl text-xs font-black shadow-md cursor-pointer transition-all"
                >
                  Guardar Impresora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación elegante */}
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        cancelLabel={confirmConfig.cancelLabel}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

    </div>
  );
};

export default PrinterSettings;
