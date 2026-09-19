import React, { useState, useEffect } from 'react';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  CheckCircle2, 
  X, 
  Clock, 
  Zap,
  HardDrive
} from 'lucide-react';
import { localDB, OfflineSyncQueueItem } from '../services/db';

interface OfflineSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  pendingCount: number;
  onSyncComplete: (syncedCount: number) => void;
  onToggleSimulatedOffline: () => void;
}

export const OfflineSyncModal: React.FC<OfflineSyncModalProps> = ({
  isOpen,
  onClose,
  isOnline,
  pendingCount,
  onSyncComplete,
  onToggleSimulatedOffline
}) => {
  const [items, setItems] = useState<OfflineSyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      localDB.getPendingItems().then(setItems);
    }
  }, [isOpen, pendingCount]);

  if (!isOpen) return null;

  const handleSyncNow = async () => {
    if (!isOnline) {
      alert('Actualmente no hay conexión a Internet. Conéctate a la red o desactiva la simulación para sincronizar con la nube.');
      return;
    }

    setIsSyncing(true);
    const { syncedCount } = await localDB.syncAllPending();
    setIsSyncing(false);
    setItems([]);
    setSyncSuccessMsg(`¡${syncedCount} operaciones sincronizadas exitosamente con la nube! ✓`);
    onSyncComplete(syncedCount);
    setTimeout(() => setSyncSuccessMsg(null), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-stone-200 rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold ${
              isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900">
                {isOnline ? 'Conexión Activa (Sincronizado)' : 'Modo Offline (Operación Local)'}
              </h3>
              <p className="text-xs text-stone-500">
                {isOnline 
                  ? 'El sistema está conectado con la nube de SaborAI en tiempo real.' 
                  : 'Sin conexión a Internet. Las operaciones se guardan en IndexedDB local.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Card */}
        <div className={`p-4 rounded-2xl border text-xs space-y-2 ${
          isOnline 
            ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950' 
            : 'bg-amber-50/60 border-amber-200 text-amber-950'
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-bold flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-stone-600" />
              <span>Memoria Local Segura (IndexedDB):</span>
            </span>
            <span className="font-black px-2 py-0.5 rounded-full bg-white text-stone-900 shadow-2xs">
              {pendingCount} pendientes
            </span>
          </div>

          <p className="text-[11px] leading-relaxed opacity-90">
            {isOnline
              ? 'Todas las comandas, mesas y facturas están sincronizadas. Si se interrumpe el Internet en el restaurante, SaborAI continúa operando sin parar.'
              : 'El restaurante sigue operando normalmente: puedes tomar comandas, mover mesas y cobrar. Las facturas se emiten en contingencia local y se enviarán automáticamente a Hacienda cuando vuelva la red.'}
          </p>
        </div>

        {/* Sync Success Banner */}
        {syncSuccessMsg && (
          <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>{syncSuccessMsg}</span>
          </div>
        )}

        {/* Queue List */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold text-stone-400 uppercase block">
            Cola de Sincronización Local:
          </span>

          <div className="max-h-48 overflow-y-auto divide-y divide-stone-100 bg-stone-50 rounded-2xl border border-stone-200 p-2">
            {items.length === 0 ? (
              <div className="py-6 text-center text-xs text-stone-400">
                No hay operaciones pendientes de sincronización.
              </div>
            ) : (
              items.map((it) => (
                <div key={it.id} className="py-2 px-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-stone-800 block truncate max-w-[280px]">
                      {it.description}
                    </span>
                    <span className="text-[10px] text-stone-400 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{new Date(it.timestamp).toLocaleTimeString('es-CR')}</span>
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold shrink-0">
                    Pendiente
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-2">
          {/* Button to simulate offline/online toggle for testing */}
          <button
            type="button"
            onClick={onToggleSimulatedOffline}
            className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            title="Permite probar cómo responde el POS cuando no hay conexión"
          >
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            <span>{isOnline ? 'Simular Sin Internet' : 'Restablecer Internet'}</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing || pendingCount === 0 || !isOnline}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#a9b994] ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
