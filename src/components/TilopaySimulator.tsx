import React, { useState } from 'react';
import { 
  CreditCard, 
  ShieldCheck, 
  Send, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Terminal, 
  Sparkles,
  RefreshCcw,
  Clock
} from 'lucide-react';
import { TenantInfo, SubscriptionStatus } from '../types';

interface TilopaySimulatorProps {
  tenant: TenantInfo;
  onUpdateTenantStatus: (status: SubscriptionStatus, graceEnds?: string) => void;
}

export const TilopaySimulator: React.FC<TilopaySimulatorProps> = ({
  tenant,
  onUpdateTenantStatus
}) => {
  const [selectedEvent, setSelectedEvent] = useState<'transaction.success' | 'transaction.failed' | 'subscription_cancelled'>('transaction.success');
  const [webhookLog, setWebhookLog] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const mockSecretKey = "tilo_sec_99a8b7c6d5e4f3a2b1";
  const hmacSignature = "sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const getPayload = () => {
    return {
      event: selectedEvent,
      timestamp: new Date().toISOString(),
      tenant_id: tenant.id,
      amount: tenant.monthlyFee,
      currency: tenant.currency,
      transaction_id: `tilo_tx_${Math.floor(100000 + Math.random() * 900000)}`,
      subscription: {
        plan: tenant.plan,
        period: "monthly",
        renew_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    };
  };

  const handleTriggerWebhook = () => {
    setIsProcessing(true);
    const payload = getPayload();

    setTimeout(() => {
      setIsProcessing(false);
      let logEntry = '';

      if (selectedEvent === 'transaction.success') {
        onUpdateTenantStatus('ACTIVE');
        logEntry = `[200 OK] Webhook HMAC SHA-256 verificado. Pago de ₡${tenant.monthlyFee.toLocaleString()} exitoso. Tenant ${tenant.name} renovado por +30 días (ACTIVE). Factura electrónica SaaS enviada.`;
      } else if (selectedEvent === 'transaction.failed') {
        const graceDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString();
        onUpdateTenantStatus('PAST_DUE', graceDate);
        logEntry = `[200 OK] Webhook procesado: Cobro fallido en tarjeta. Tenant colocado en 'PAST_DUE' con 7 días de periodo de gracia hasta ${graceDate}. Banner activado.`;
      } else {
        onUpdateTenantStatus('CANCELLED');
        logEntry = `[200 OK] Webhook procesado: Suscripción cancelada por el usuario. Tenant colocado en 'CANCELLED' y suspendido.`;
      }

      setWebhookLog(prev => [logEntry, ...prev]);
    }, 900);
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#6b686d]/15">
        <div>
          <h2 className="text-2xl font-black text-[#3b3733]">Integración Recurrente Tilopay Costa Rica</h2>
          <p className="text-xs text-[#6b686d]">
            Servidor Webhook (POST /api/v1/webhooks/tilopay) con validación estricta de firma HMAC SHA-256.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#6b686d]">Estado Actual Tenant:</span>
          <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
            tenant.status === 'ACTIVE' 
              ? 'bg-[#a9b994]/30 text-[#3b3733] border border-[#a9b994]/50'
              : tenant.status === 'PAST_DUE'
              ? 'bg-amber-100 text-amber-900 border border-amber-300'
              : 'bg-red-100 text-red-900 border border-red-300'
          }`}>
            {tenant.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Webhook Simulation Controls (6 cols) */}
        <div className="lg:col-span-6 space-y-5">
          <div className="bg-[#fcfeff] border border-[#6b686d]/20 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-[#3b3733] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#a9b994]" />
              <span>Simulador de Eventos de Cobro Tilopay</span>
            </h3>

            {/* Event Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#3b3733] uppercase">Seleccionar Evento</label>
              <div className="grid grid-cols-1 gap-2.5">
                
                <button
                  type="button"
                  onClick={() => setSelectedEvent('transaction.success')}
                  className={`p-3.5 rounded-2xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                    selectedEvent === 'transaction.success'
                      ? 'bg-[#a9b994]/20 border-[#a9b994] text-[#3b3733] ring-2 ring-[#a9b994]/40'
                      : 'bg-[#fcfeff] border-[#6b686d]/20 text-[#6b686d]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <div>
                      <span className="block font-bold">transaction.success</span>
                      <span className="text-[10px] font-normal text-[#6b686d]">Renueva +30 días, estado ACTIVE y factura automática</span>
                    </div>
                  </div>
                  <span className="text-xs font-black">₡{tenant.monthlyFee.toLocaleString()}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedEvent('transaction.failed')}
                  className={`p-3.5 rounded-2xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                    selectedEvent === 'transaction.failed'
                      ? 'bg-amber-500/15 border-amber-500 text-amber-900 ring-2 ring-amber-500/30'
                      : 'bg-[#fcfeff] border-[#6b686d]/20 text-[#6b686d]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <div>
                      <span className="block font-bold">transaction.failed</span>
                      <span className="text-[10px] font-normal text-[#6b686d]">Cambia a PAST_DUE, inicia 7 días de gracia y banner</span>
                    </div>
                  </div>
                  <span className="text-xs font-black">Reintento</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedEvent('subscription_cancelled')}
                  className={`p-3.5 rounded-2xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                    selectedEvent === 'subscription_cancelled'
                      ? 'bg-red-500/15 border-red-500 text-red-900 ring-2 ring-red-500/30'
                      : 'bg-[#fcfeff] border-[#6b686d]/20 text-[#6b686d]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <div>
                      <span className="block font-bold">subscription_cancelled</span>
                      <span className="text-[10px] font-normal text-[#6b686d]">Suspende el acceso y redirige a pantalla de pago</span>
                    </div>
                  </div>
                  <span className="text-xs font-black">Cancelación</span>
                </button>

              </div>
            </div>

            {/* Secret & Signature Security info */}
            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-[#6b686d]">Endpoint:</span>
                <span className="font-bold text-[#3b3733]">POST /api/v1/webhooks/tilopay</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b686d]">x-tilopay-signature:</span>
                <span className="text-[#a9b994] font-bold truncate max-w-[220px]">{hmacSignature}</span>
              </div>
            </div>

            <button
              disabled={isProcessing}
              onClick={handleTriggerWebhook}
              className="w-full py-3.5 bg-[#3b3733] text-[#fcfeff] rounded-2xl font-bold text-xs hover:bg-[#25221f] transition-all flex items-center justify-center gap-2 shadow-md shadow-[#3b3733]/20"
            >
              {isProcessing ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin text-[#a9b994]" />
                  <span>Validando firma HMAC SHA-256...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-[#a9b994]" />
                  <span>Disparar Webhook Tilopay al Servidor</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Live Payload & Webhook Console (6 cols) */}
        <div className="lg:col-span-6 space-y-5">
          <div className="bg-[#3b3733] text-[#fcfeff] rounded-3xl p-6 shadow-xl space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#fcfeff]/10">
              <span className="flex items-center gap-2 font-bold text-[#a9b994]">
                <Terminal className="w-4 h-4" />
                <span>Consola Webhook en Tiempo Real</span>
              </span>
              <span className="text-[10px] text-gray-400">Node.js Express Server</span>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] text-gray-300">// Payload JSON transmitido:</p>
              <pre className="p-3 bg-black/40 rounded-2xl overflow-x-auto text-[11px] text-[#a9b994]">
                {JSON.stringify(getPayload(), null, 2)}
              </pre>
            </div>

            <div className="pt-2 border-t border-[#fcfeff]/10">
              <p className="text-[11px] text-gray-300 mb-2">// Historial de ejecuciones:</p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1 text-[10px] text-gray-200">
                {webhookLog.length === 0 ? (
                  <p className="text-gray-500 italic">No hay registros de webhook aún. Dispara un evento a la izquierda.</p>
                ) : (
                  webhookLog.map((log, idx) => (
                    <div key={idx} className="p-2 rounded-xl bg-white/5 border border-white/10">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
