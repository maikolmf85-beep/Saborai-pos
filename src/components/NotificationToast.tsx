import React from 'react';
import { 
  Bell, 
  ChefHat, 
  Wine, 
  CheckCircle2, 
  X, 
  Volume2, 
  VolumeX,
  Sparkles
} from 'lucide-react';

export interface PosNotification {
  id: string;
  type: 'NEW_ORDER' | 'ORDER_READY' | 'TABLE_UPDATE' | 'HACIENDA_UPDATE';
  title: string;
  message: string;
  station?: 'Cocina' | 'Bar' | 'General';
  tableNumber?: number;
  server?: string;
  timestamp: Date;
}

interface NotificationToastProps {
  notifications: PosNotification[];
  onDismiss: (id: string) => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const NotificationToastContainer: React.FC<NotificationToastProps> = ({
  notifications,
  onDismiss,
  isMuted,
  onToggleMute
}) => {
  if (notifications.length === 0) return null;

  return (
    <aside aria-label="Notificaciones del sistema" className="fixed top-20 right-4 sm:right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {notifications.map((notif) => {
        const isReady = notif.type === 'ORDER_READY';

        return (
          <div
            key={notif.id}
            role="status"
            className={`pointer-events-auto p-4 rounded-2xl shadow-xl border backdrop-blur-md transition-all duration-200 animate-in slide-in-from-top-4 flex items-start justify-between gap-3 ${
              isReady
                ? 'bg-amber-50/95 border-amber-300 text-amber-950'
                : 'bg-stone-900/95 border-stone-800 text-white'
            }`}
          >
            {/* Icon */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isReady
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-white/15 text-[#a9b994]'
            }`}>
              {isReady ? (
                <Bell className="w-5 h-5 animate-bounce" />
              ) : notif.station === 'Bar' ? (
                <Wine className="w-5 h-5 text-[#a9b994]" />
              ) : (
                <ChefHat className="w-5 h-5 text-[#a9b994]" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-bold leading-tight ${isReady ? 'text-amber-950' : 'text-white'}`}>
                  {notif.title}
                </span>
                <span className="text-[10px] opacity-70">
                  {notif.timestamp.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p className={`text-[11px] mt-0.5 leading-normal ${isReady ? 'text-amber-900' : 'text-stone-300'}`}>
                {notif.message}
              </p>

              {isReady && notif.server && (
                <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-800">
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  <span>Salonero asignado: {notif.server}</span>
                </div>
              )}
            </div>

            {/* Actions: Mute indicator & Close */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onToggleMute}
                className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                title={isMuted ? 'Sonidos silenciados (Clic para activar)' : 'Sonidos activos (Clic para silenciar)'}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => onDismiss(notif.id)}
                className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                title="Cerrar notificación"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
};
