import React, { useState } from 'react';
import { PrinterDevice } from '../types';
import { initialPrinters } from '../data/mockData';
import { 
  Printer, 
  Wifi, 
  Bluetooth, 
  Usb, 
  Plus, 
  Check, 
  Sliders, 
  Trash2,
  RefreshCw,
  FileCheck
} from 'lucide-react';

export const PrinterSettings: React.FC = () => {
  const [printers, setPrinters] = useState<PrinterDevice[]>(initialPrinters);
  const [testPrintSuccess, setTestPrintSuccess] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const [newPrinter, setNewPrinter] = useState<Partial<PrinterDevice>>({
    name: '',
    connectionType: 'IP',
    ipAddress: '192.168.1.180',
    port: 9100,
    paperWidth: '80mm',
    autoCutter: true,
    printLogo: true,
    assignedStation: 'COCINA',
    status: 'ONLINE'
  });

  const handleTestPrint = (printerId: string) => {
    setTestPrintSuccess(printerId);
    setTimeout(() => setTestPrintSuccess(null), 2500);
  };

  const handleAddPrinter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrinter.name) return;
    const added: PrinterDevice = {
      id: `prn_${Date.now()}`,
      name: newPrinter.name,
      connectionType: newPrinter.connectionType || 'IP',
      ipAddress: newPrinter.ipAddress,
      port: newPrinter.port || 9100,
      paperWidth: newPrinter.paperWidth || '80mm',
      autoCutter: newPrinter.autoCutter ?? true,
      printLogo: newPrinter.printLogo ?? true,
      assignedStation: newPrinter.assignedStation || 'COCINA',
      status: 'ONLINE'
    };
    setPrinters([...printers, added]);
    setShowAddModal(false);
    setNewPrinter({
      name: '',
      connectionType: 'IP',
      ipAddress: '192.168.1.180',
      port: 9100,
      paperWidth: '80mm',
      autoCutter: true,
      printLogo: true,
      assignedStation: 'COCINA',
      status: 'ONLINE'
    });
  };

  const handleDeletePrinter = (id: string) => {
    setPrinters(printers.filter(p => p.id !== id));
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#6b686d]/15">
        <div>
          <h2 className="text-2xl font-black text-[#3b3733]">Configuración Avanzada de Impresoras POS</h2>
          <p className="text-xs text-[#6b686d]">
            Administra comanderas de red (IP/Ethernet), Bluetooth inalámbrico, WebUSB y enrutamiento por estación.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 bg-[#3b3733] text-[#fcfeff] rounded-2xl text-xs font-bold hover:bg-[#272320] transition-all flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4 text-[#a9b994]" />
          <span>Agregar Nueva Impresora</span>
        </button>
      </div>

      {/* Printer Devices Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {printers.map((printer) => (
          <div
            key={printer.id}
            className="p-6 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 shadow-sm flex flex-col justify-between space-y-4 hover:border-[#a9b994] transition-all"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="p-3 rounded-2xl bg-[#a9b994]/20 text-[#3b3733]">
                  {printer.connectionType === 'IP' && <Wifi className="w-6 h-6 text-[#3b3733]" />}
                  {printer.connectionType === 'BLUETOOTH' && <Bluetooth className="w-6 h-6 text-[#3b3733]" />}
                  {printer.connectionType === 'USB' && <Usb className="w-6 h-6 text-[#3b3733]" />}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#a9b994] animate-pulse" />
                  <span className="text-[10px] font-bold uppercase text-[#a9b994]">{printer.status}</span>
                </div>
              </div>

              <h3 className="font-bold text-base text-[#3b3733]">{printer.name}</h3>
              <p className="text-xs text-[#6b686d] mt-0.5">
                {printer.connectionType === 'IP' ? `IP: ${printer.ipAddress}:${printer.port}` : `Conexión: ${printer.connectionType}`}
              </p>

              {/* Hardware specifications */}
              <div className="mt-4 pt-3 border-t border-[#6b686d]/10 grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-xl bg-gray-50">
                  <span className="block text-[10px] font-bold text-[#6b686d] uppercase">Papel:</span>
                  <span className="font-bold text-[#3b3733]">{printer.paperWidth}</span>
                </div>
                <div className="p-2 rounded-xl bg-gray-50">
                  <span className="block text-[10px] font-bold text-[#6b686d] uppercase">Estación:</span>
                  <span className="font-bold text-[#3b3733]">{printer.assignedStation}</span>
                </div>
                <div className="p-2 rounded-xl bg-gray-50">
                  <span className="block text-[10px] font-bold text-[#6b686d] uppercase">Autocutter:</span>
                  <span className="font-bold text-[#3b3733]">{printer.autoCutter ? 'Habilitado' : 'Manual'}</span>
                </div>
                <div className="p-2 rounded-xl bg-gray-50">
                  <span className="block text-[10px] font-bold text-[#6b686d] uppercase">Logo Gráfico:</span>
                  <span className="font-bold text-[#3b3733]">{printer.printLogo ? 'Saborai Logo' : 'Desactivado'}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => handleTestPrint(printer.id)}
                className="flex-1 py-2.5 bg-[#3b3733] text-[#fcfeff] rounded-xl text-xs font-bold hover:bg-[#25221f] transition-all flex items-center justify-center gap-1.5"
              >
                {testPrintSuccess === printer.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#a9b994]" />
                    <span>¡Enviado a Impresora!</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-3.5 h-3.5 text-[#a9b994]" />
                    <span>Prueba de Impresión</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleDeletePrinter(printer.id)}
                className="p-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50"
                title="Eliminar Impresora"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

          </div>
        ))}
      </div>

      {/* Add Printer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3b3733]/50 backdrop-blur-sm">
          <div className="bg-[#fcfeff] border border-[#6b686d]/20 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative space-y-4">
            <h3 className="text-xl font-black text-[#3b3733]">Registrar Nueva Impresora</h3>
            
            <form onSubmit={handleAddPrinter} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1">Nombre Identificador</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Comandera Parrilla Exterior"
                  value={newPrinter.name}
                  onChange={(e) => setNewPrinter({ ...newPrinter, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733] focus:border-[#a9b994] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1">Tipo Conexión</label>
                  <select
                    value={newPrinter.connectionType}
                    onChange={(e) => setNewPrinter({ ...newPrinter, connectionType: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733] bg-white"
                  >
                    <option value="IP">Red Ethernet / IP</option>
                    <option value="BLUETOOTH">Bluetooth Inalámbrico</option>
                    <option value="USB">WebUSB / Spooler</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1">Estación Destino</label>
                  <select
                    value={newPrinter.assignedStation}
                    onChange={(e) => setNewPrinter({ ...newPrinter, assignedStation: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733] bg-white"
                  >
                    <option value="COCINA">Cocina Caliente</option>
                    <option value="BAR">Bar & Bebidas</option>
                    <option value="PRECUENTA">Pre-Cuenta Salón</option>
                    <option value="FACTURACION">Caja Facturación</option>
                  </select>
                </div>
              </div>

              {newPrinter.connectionType === 'IP' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1">Dirección IP</label>
                    <input
                      type="text"
                      value={newPrinter.ipAddress}
                      onChange={(e) => setNewPrinter({ ...newPrinter, ipAddress: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1">Puerto</label>
                    <input
                      type="number"
                      value={newPrinter.port}
                      onChange={(e) => setNewPrinter({ ...newPrinter, port: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733]"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="cutter"
                    checked={newPrinter.autoCutter}
                    onChange={(e) => setNewPrinter({ ...newPrinter, autoCutter: e.target.checked })}
                    className="rounded text-[#3b3733]"
                  />
                  <label htmlFor="cutter" className="text-xs text-[#3b3733] font-medium">Corte Automático (Autocutter)</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="logo"
                    checked={newPrinter.printLogo}
                    onChange={(e) => setNewPrinter({ ...newPrinter, printLogo: e.target.checked })}
                    className="rounded text-[#3b3733]"
                  />
                  <label htmlFor="logo" className="text-xs text-[#3b3733] font-medium">Imprimir Logo</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#6b686d]/15">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-bold text-[#6b686d]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#3b3733] text-[#fcfeff] rounded-xl text-xs font-bold hover:bg-[#25221f]"
                >
                  Guardar Impresora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
