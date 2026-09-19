import React, { useState, useEffect } from 'react';
import { 
  X, 
  Database, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Key, 
  FileText, 
  Eye, 
  EyeOff, 
  Sparkles, 
  UserCheck, 
  Layers, 
  ArrowRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { notionService, NotionConfig, NotionSyncRecord } from '../services/notionService';
import { UserProfile, TenantInfo } from '../types';

interface NotionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserProfile | null;
  currentTenant?: TenantInfo | null;
}

export const NotionModal: React.FC<NotionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  currentTenant
}) => {
  const [config, setConfig] = useState<NotionConfig>(() => notionService.getConfig());
  const [records, setRecords] = useState<NotionSyncRecord[]>(() => notionService.getRecords());
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreatingDb, setIsCreatingDb] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(notionService.getConfig());
      setRecords(notionService.getRecords());
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveField = (field: keyof NotionConfig, value: any) => {
    const updated = { ...config, [field]: value };
    setConfig(updated);
    notionService.saveConfig({ [field]: value });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setFeedback(null);

    const res = await notionService.testConnection(config.apiKey);
    setIsTesting(false);

    if (res.success) {
      setFeedback({ type: 'success', message: `${res.message} Conectado como: ${res.botName || 'SaborAI POS'}` });
      setConfig(notionService.getConfig());
    } else {
      setFeedback({ type: 'error', message: res.message });
    }
  };

  const handleCreateDatabase = async () => {
    if (!config.parentPageId.trim()) {
      setFeedback({ type: 'error', message: 'Ingresa el ID o enlace de la página de Notion donde se creará la base de datos.' });
      return;
    }

    setIsCreatingDb(true);
    setFeedback(null);

    const res = await notionService.createUsersDatabase(config.parentPageId);
    setIsCreatingDb(false);

    if (res.success) {
      setFeedback({ 
        type: 'success', 
        message: `¡Base de datos creada exitosamente en Notion! ID: ${res.databaseId}` 
      });
      setConfig(notionService.getConfig());
    } else {
      setFeedback({ type: 'error', message: res.message });
    }
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    setFeedback(null);

    const res = await notionService.syncAllPendingUsers();
    setIsSyncingAll(false);
    setRecords(notionService.getRecords());

    if (res.syncedCount > 0) {
      setFeedback({ 
        type: 'success', 
        message: `Se sincronizaron ${res.syncedCount} usuario(s) a Notion correctamente.` 
      });
    } else if (res.errors > 0) {
      setFeedback({ 
        type: 'error', 
        message: `Ocurrieron ${res.errors} errores al sincronizar con Notion. Verifica tu conexión.` 
      });
    } else {
      setFeedback({ 
        type: 'info', 
        message: 'Todos los registros de usuarios ya están sincronizados en Notion.' 
      });
    }
  };

  const handleCreateTestUser = async () => {
    const testUser: UserProfile = currentUser || {
      id: `usr_manual_${Date.now()}`,
      name: 'María Fernanda Solano',
      email: 'mf.solano@restaurantesabor.cr',
      phone: '+506 8765-4321',
      restaurantName: 'Café & Bistro La Esquina',
      role: 'ADMIN'
    };

    const testTenant: TenantInfo = currentTenant || {
      id: `tenant_manual_${Date.now()}`,
      name: testUser.restaurantName,
      cedulaJuridica: '3-101-554433',
      email: testUser.email,
      phone: testUser.phone,
      location: 'Curridabat, San José',
      plan: 'pro',
      status: 'ACTIVE',
      currency: 'CRC',
      monthlyFee: 45000
    };

    const rec = await notionService.recordUserRegistration(testUser, testTenant);
    setRecords(notionService.getRecords());

    if (rec.synced) {
      setFeedback({ 
        type: 'success', 
        message: `Usuario "${testUser.name}" registrado e insertado en Notion ✅` 
      });
    } else {
      setFeedback({ 
        type: 'info', 
        message: `Usuario "${testUser.name}" guardado localmente. Pendiente de envío a Notion.` 
      });
    }
  };

  const pendingCount = records.filter(r => !r.synced).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-white flex items-center justify-center shadow-xs">
              <span className="font-serif font-black text-xl leading-none">N</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">Integración con Notion</h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                  config.databaseId 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : config.isConnected 
                    ? 'bg-blue-100 text-blue-800' 
                    : 'bg-stone-100 text-stone-600'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    config.databaseId ? 'bg-emerald-600 animate-pulse' : 'bg-stone-400'
                  }`} />
                  {config.databaseId ? 'Base de Datos Activa' : config.isConnected ? 'Conectado' : 'No Conectado'}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Registra y sincroniza automáticamente a cada persona registrada en una base de datos central en Notion.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Feedback message banner */}
          {feedback && (
            <div className={`p-4 rounded-2xl text-xs font-medium flex items-start justify-between gap-3 animate-in slide-in-from-top-2 duration-150 ${
              feedback.type === 'success' 
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : feedback.type === 'error'
                ? 'bg-rose-50 border border-rose-200 text-rose-900'
                : 'bg-blue-50 border border-blue-200 text-blue-900'
            }`}>
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : feedback.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
              <button onClick={() => setFeedback(null)} className="opacity-60 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Quick Step-by-Step Toggle Guide */}
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 text-amber-950">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span className="text-xs font-bold">¿Cómo conectar tu espacio de Notion en 3 pasos?</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                className="text-xs text-amber-800 font-bold underline hover:text-amber-950"
              >
                {showGuide ? 'Ocultar guía' : 'Ver instrucciones'}
              </button>
            </div>

            {showGuide && (
              <div className="mt-3 text-xs space-y-2 text-amber-900/90 pt-2 border-t border-amber-200">
                <p><strong>Paso 1:</strong> Ingresa a <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="underline font-bold text-amber-950">notion.so/my-integrations</a> y crea una integración interna llamada <em>"SaborAI POS"</em>. Copia el token que empieza con <code className="bg-amber-200/60 px-1 py-0.5 rounded text-[11px]">ntn_...</code> o <code className="bg-amber-200/60 px-1 py-0.5 rounded text-[11px]">secret_...</code>.</p>
                <p><strong>Paso 2:</strong> En tu Notion, ve a la página donde deseas guardar la base de datos, haz clic en el menú <strong>...</strong> (arriba a la derecha) ➔ <strong>Conectar a / Connect to</strong> y selecciona tu integración <em>SaborAI POS</em>.</p>
                <p><strong>Paso 3:</strong> Copia el enlace o ID de esa página y pégalo abajo, luego presiona <strong>"Crear Base de Datos en Notion"</strong>. ¡Todo quedará listo automáticamente!</p>
              </div>
            )}
          </div>

          {/* Configuration Form Card */}
          <div className="bg-stone-50 border border-stone-200/70 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-stone-500" />
                Credenciales de Conexión
              </h3>
              <span className="text-[11px] text-stone-400">
                Puedes escribir <code className="bg-stone-200 px-1 py-0.5 rounded font-mono text-[10px]">demo</code> para probar el sistema sin clave real
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* API Token Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-700 block">
                  Token de Integración (API Key)
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => handleSaveField('apiKey', e.target.value)}
                    placeholder="ntn_... o secret_... o 'demo'"
                    className="w-full bg-white border border-stone-300 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 placeholder:text-stone-400 font-mono focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Parent Page ID Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-700 block">
                  ID o Enlace de Página Padre en Notion
                </label>
                <input
                  type="text"
                  value={config.parentPageId}
                  onChange={(e) => handleSaveField('parentPageId', e.target.value)}
                  placeholder="https://notion.so/... o ID de 32 dígitos"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 placeholder:text-stone-400 font-mono focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900"
                />
              </div>
            </div>

            {/* Action buttons for config */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/60">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || !config.apiKey}
                  className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 text-xs font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  {isTesting ? 'Verificando...' : 'Probar Conexión'}
                </button>

                <button
                  type="button"
                  onClick={handleCreateDatabase}
                  disabled={isCreatingDb || !config.parentPageId}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition-colors shadow-xs disabled:opacity-50 flex items-center gap-2"
                >
                  <Database className={`w-3.5 h-3.5 text-[#a9b994] ${isCreatingDb ? 'animate-spin' : ''}`} />
                  {isCreatingDb ? 'Creando Base en Notion...' : '✨ Crear Base de Datos en Notion'}
                </button>
              </div>

              {config.databaseUrl && (
                <a
                  href={config.databaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-[#a9b994]/20 text-[#283618] hover:bg-[#a9b994]/30 border border-[#a9b994]/40 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en Notion ↗
                </a>
              )}
            </div>
          </div>

          {/* Database Info Card (if created) */}
          {config.databaseId && (
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-950">
                    Base de Datos Lista: "SaborAI - Registro de Usuarios & Restaurantes"
                  </span>
                </div>
                <p className="text-[11px] text-emerald-800 mt-0.5 font-mono">
                  ID: {config.databaseId} {config.lastSyncTime && `• Última sinc: ${new Date(config.lastSyncTime).toLocaleTimeString('es-CR')}`}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCreateTestUser}
                  className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-colors shadow-2xs"
                >
                  + Enviar Registro de Prueba
                </button>
              </div>
            </div>
          )}

          {/* Registered Users Table Header & Sync Actions */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-stone-600" />
                  Registro de Personas & Restaurantes ({records.length})
                </h3>
                <p className="text-[11px] text-stone-500">
                  Cada cuenta registrada en SaborAI se almacena aquí y se exporta a las columnas oficiales de Notion.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncAll}
                  disabled={isSyncingAll || records.length === 0}
                  className="px-3.5 py-1.5 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
                  {isSyncingAll ? 'Sincronizando...' : `Sincronizar a Notion (${pendingCount} pendientes)`}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100/75 border-b border-stone-200 text-stone-600 font-bold">
                    <tr>
                      <th className="px-4 py-2.5">Persona / Usuario</th>
                      <th className="px-4 py-2.5">Restaurante</th>
                      <th className="px-4 py-2.5">Contacto</th>
                      <th className="px-4 py-2.5">Plan / Rol</th>
                      <th className="px-4 py-2.5">Fecha</th>
                      <th className="px-4 py-2.5 text-right">Estado Notion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-stone-900">{rec.user.name}</div>
                          <div className="text-[10px] text-stone-400 font-mono">{rec.user.id}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-800">
                          {rec.user.restaurantName || rec.tenant.name}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-stone-700">{rec.user.email}</div>
                          <div className="text-[10px] text-stone-500">{rec.user.phone}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 bg-stone-100 text-stone-700 rounded-md font-bold text-[10px] uppercase">
                              {rec.tenant.plan || 'Pro'}
                            </span>
                            <span className="text-[10px] text-stone-400">
                              {rec.user.role || 'ADMIN'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-[11px] whitespace-nowrap">
                          {new Date(rec.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {rec.synced ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Sincronizado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800" title={rec.error}>
                              <RefreshCw className="w-3 h-3 text-amber-600" />
                              Pendiente
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {records.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-stone-400 text-xs">
                          No hay usuarios registrados aún. Cuando alguien cree su cuenta en el inicio de sesión, aparecerá aquí.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Database Columns Preview Spec */}
          <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200/60">
            <h4 className="text-[11px] font-bold text-stone-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-stone-400" />
              Columnas Automáticas en Notion
            </h4>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Nombre</strong> (title)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Restaurante</strong> (text)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Correo</strong> (email)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Teléfono</strong> (phone)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Rol</strong> (select)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Plan SaborAI</strong> (select)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Fecha Registro</strong> (date)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>ID Usuario</strong> (text)</span>
              <span className="px-2 py-1 bg-white border border-stone-200 rounded-lg text-stone-700"><strong>Estado</strong> (status)</span>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex items-center justify-between">
          <span className="text-[11px] text-stone-500">
            Conexión encriptada y segura con Notion API v2022-06-28.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-colors shadow-xs"
          >
            Listo / Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
