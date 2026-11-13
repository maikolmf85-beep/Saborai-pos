import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Key, 
  FileCheck, 
  UploadCloud, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  EyeOff, 
  Lock, 
  Check, 
  Info,
  Server,
  CalendarCheck,
  Trash2,
  FileCode,
  Sparkles
} from 'lucide-react';
import { TenantInfo, HaciendaConfig, ElectronicInvoiceCR } from '../types';
import { haciendaService } from '../services/haciendaService';
import { cashShiftService } from '../services/cashShiftService';
import { generateHaciendaXmlV44, downloadXmlFile, buildClaveYConsecutivo, normalizeCedula } from '../services/haciendaXml';
import { HACIENDA_P12_PIN_FORMAT_ERROR, isValidHaciendaP12Pin } from '../utils/haciendaP12Pin';

interface HaciendaSettingsProps {
  tenant: TenantInfo;
  onUpdateTenant?: (updated: TenantInfo) => void;
}

export const HaciendaSettings: React.FC<HaciendaSettingsProps> = ({ tenant, onUpdateTenant }) => {
  const currentRegister = cashShiftService.getCurrentRegister();
  const defaultBranchCode = (currentRegister.branchCode || '001').replace(/\D/g, '').padStart(3, '0').slice(-3);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [branchesReady, setBranchesReady] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState('');

  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [atvUsername, setAtvUsername] = useState('');
  const [atvPassword, setAtvPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pinP12, setPinP12] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinValidationError, setPinValidationError] = useState<string | null>(null);
  const [atvUsernameConfigured, setAtvUsernameConfigured] = useState(false);
  const [atvPasswordConfigured, setAtvPasswordConfigured] = useState(false);
  const [certificateConfigured, setCertificateConfigured] = useState(false);
  
  const [p12FileName, setP12FileName] = useState('');
  const [p12Base64, setP12Base64] = useState('');
  
  const [tipoIdentificacion, setTipoIdentificacion] = useState<'01' | '02' | '03' | '04'>('02');
  const [cedulaEmisor, setCedulaEmisor] = useState(tenant.cedulaJuridica || '');
  const [codigoActividad, setCodigoActividad] = useState('');
  const [provincia, setProvincia] = useState('');
  const [canton, setCanton] = useState('');
  const [distrito, setDistrito] = useState('');
  const [otrasSenas, setOtrasSenas] = useState('');
  const [actividadesAtv, setActividadesAtv] = useState<{ codigo: string; descripcion: string; estado: string; tipo?: string }[]>([]);
  const [lookupMsg, setLookupMsg] = useState('');

  const handleLookupActividades = async (forcedId?: string) => {
    const rawId = forcedId || cedulaEmisor;
    const id = normalizeCedula(rawId);
    if (!id) { setLookupMsg('Escribe primero la cédula del emisor.'); return; }
    setLookupMsg('Consultando actividades registradas en el RUT de Hacienda...');
    try {
      const res = await fetch(`https://api.hacienda.go.cr/fe/ae?identificacion=${id}`);
      if (!res.ok) throw new Error('No encontrado');
      const data = await res.json();
      const acts = (data.actividades || []) as { codigo: string; descripcion: string; estado: string; tipo?: string }[];
      setActividadesAtv(acts);
      if (acts.length > 0) {
        const activeActs = acts.filter(a => a.estado === 'A');
        const match = activeActs.find(a => a.codigo === codigoActividad);
        if (!match && activeActs.length > 0) {
          const auto = activeActs.find(a => a.tipo === 'P') || activeActs[0];
          setCodigoActividad(auto.codigo);
          persistConfig({ codigoActividad: auto.codigo });
          setLookupMsg(`✅ Se autoseleccionó tu actividad principal en ATV: ${auto.codigo} (${auto.descripcion}).`);
        } else {
          setLookupMsg(`${data.nombre || ''} — ${acts.length} actividad(es) en ATV. Código activo: ${codigoActividad}`);
        }
      } else {
        setLookupMsg('El contribuyente no tiene actividades registradas en Hacienda.');
      }
    } catch {
      setActividadesAtv([]);
      setLookupMsg('No se pudo consultar Hacienda para esa cédula (verifique su número o conexión).');
    }
  };
  const [sucursal, setSucursal] = useState(defaultBranchCode);
  const terminal = currentRegister.terminalCode || '00001';
  const [proveedorSistemas, setProveedorSistemas] = useState('');
  const [isValidated, setIsValidated] = useState(false);
  const [certExpiresOn, setCertExpiresOn] = useState<string | undefined>(undefined);
  const [lastTestedAt, setLastTestedAt] = useState<string | undefined>(undefined);

  // Test state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [removeCertificate, setRemoveCertificate] = useState(false);

  // Construye el formulario; los secretos solo salen del navegador al guardar o probar.
  const persistConfig = (overrides?: Partial<HaciendaConfig>) => {
    return {
      environment,
      atvUsername: atvUsername.trim() || undefined,
      atvPassword: atvPassword || undefined,
      pinP12: pinP12 || undefined,
      p12FileName,
      p12Base64: p12Base64 || undefined,
      cedulaEmisor: cedulaEmisor.trim(),
      tipoIdentificacion,
      codigoActividad,
      provincia,
      canton,
      distrito,
      otrasSenas,
      sucursal,
      terminal,
      proveedorSistemas: proveedorSistemas.trim() || undefined,
      isValidated,
      certExpiresOn,
      lastTestedAt,
      ...overrides
    };
  };

  const applyConfig = (cfg: HaciendaConfig | null, branchCode: string) => {
    const selected = cfg;
    setEnvironment(selected?.environment || 'sandbox');
    setAtvUsername(selected?.atvUsername || '');
    setAtvPassword(selected?.atvPassword || '');
    setPinP12(selected?.pinP12 || '');
    setP12FileName(selected?.p12FileName || '');
    setP12Base64(selected?.p12Base64 || '');
    setAtvUsernameConfigured(Boolean(selected?.atvUsernameConfigured || selected?.atvUsername));
    setAtvPasswordConfigured(Boolean(selected?.atvPasswordConfigured || selected?.atvPassword));
    setCertificateConfigured(Boolean(selected?.certificateConfigured || (selected?.p12Base64 && selected?.pinP12)));
    const ced = selected?.cedulaEmisor || tenant.cedulaJuridica || '';
    if (ced) setCedulaEmisor(ced);
    setTipoIdentificacion(selected?.tipoIdentificacion || '02');
    setCodigoActividad(selected?.codigoActividad || '');
    setProvincia(selected?.provincia || '');
    setCanton(selected?.canton || '');
    setDistrito(selected?.distrito || '');
    setOtrasSenas(selected?.otrasSenas || '');
    setSucursal(branchCode);
    setProveedorSistemas(selected?.proveedorSistemas || '');
    setIsValidated(Boolean(selected?.isValidated));
    setCertExpiresOn(selected?.certExpiresOn);
    setLastTestedAt(selected?.lastTestedAt);
  };

  // Cargar sucursales reales del tenant y después su perfil fiscal aislado.
  useEffect(() => {
    let active = true;
    setBranchesReady(false);
    setBranchLoadError('');
    haciendaService.listBranches(tenant.id).then(list => {
      if (!active) return;
      setBranches(list);
      const target = list.find(branch => branch.code === defaultBranchCode)?.code || list[0]?.code || defaultBranchCode;
      setSucursal(target);
      setBranchesReady(true);
    }).catch(error => {
      if (!active) return;
      setBranches([]);
      setBranchesReady(true);
      setBranchLoadError(error?.message || 'No se pudieron cargar las sucursales.');
    });
    return () => { active = false; };
  }, [tenant.id, defaultBranchCode]);

  useEffect(() => {
    if (!branchesReady || !sucursal || !branches.some(branch => branch.code === sucursal)) return;
    let active = true;
    setBranchLoadError('');
    applyConfig(null, sucursal);
    haciendaService.loadConfigWithLegacyMigration(tenant.id, sucursal).then(result => {
      if (active) {
        setBranchLoadError(result.migrationError || '');
        applyConfig(result.config, sucursal);
      }
    }).catch(error => {
      if (!active) return;
      setBranchLoadError(error?.message || 'No se pudo cargar la configuración de esta sucursal.');
    });
    return () => { active = false; };
  }, [tenant.id, sucursal, branchesReady, branches]);

  // El certificado se conserva solo en memoria hasta que el administrador guarde.
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.p12') && !file.name.endsWith('.pfx')) {
      alert('Por favor selecciona un archivo con extensión .p12 o .pfx proporcionado por el Ministerio de Hacienda.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        const base64Data = result.includes(',') ? result.split(',')[1].replace(/\s+/g, '') : result.replace(/\s+/g, '');
        setP12Base64(base64Data);
        setP12FileName(file.name);
        setCertificateConfigured(false);
        setRemoveCertificate(false);
        persistConfig({
          p12Base64: base64Data,
          p12FileName: file.name
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    setP12Base64('');
    setP12FileName('');
    setCertificateConfigured(false);
    setRemoveCertificate(true);
    persistConfig({
      p12Base64: '',
      p12FileName: '',
      isValidated: false
    });
  };

  const handleEnvironmentChange = (newEnv: 'sandbox' | 'production') => {
    setEnvironment(newEnv);
    persistConfig({ environment: newEnv, isValidated: false });
    setIsValidated(false);
  };

  const handleTestConnection = async () => {
    if (!sucursal || !branches.some(branch => branch.code === sucursal)) {
      setTestResult({ success: false, message: 'Selecciona una sucursal activa sincronizada con el POS.' });
      return;
    }

    if ((pinP12.length > 0 && !isValidHaciendaP12Pin(pinP12)) || (p12Base64 && !isValidHaciendaP12Pin(pinP12))) {
      setPinValidationError(HACIENDA_P12_PIN_FORMAT_ERROR);
      setTestResult({ success: false, message: HACIENDA_P12_PIN_FORMAT_ERROR });
      return;
    }
    setPinValidationError(null);

    setIsTesting(true);
    setTestResult(null);
    setSaveError('');
    const res = await haciendaService.testConnection(tenant.id, sucursal, persistConfig(), { removeCertificate });
    setIsTesting(false);
    setTestResult(res);

    if (res.success) {
      const now = new Date().toISOString();
      const expires = res.details?.expiresOn || certExpiresOn;
      setIsValidated(true);
      setAtvUsernameConfigured(true);
      setAtvPasswordConfigured(true);
      setCertificateConfigured(true);
      setAtvUsername('');
      setAtvPassword('');
      setPinP12('');
      setP12Base64('');
      setRemoveCertificate(false);
      setCertExpiresOn(expires);
      setLastTestedAt(now);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((pinP12 && !isValidHaciendaP12Pin(pinP12)) || (p12Base64 && !isValidHaciendaP12Pin(pinP12))) {
      setPinValidationError(HACIENDA_P12_PIN_FORMAT_ERROR);
      return;
    }
    setPinValidationError(null);
    setIsSaving(true);
    setSaveError('');
    setTestResult(null);
    try {
      const saved = await haciendaService.saveConfig(tenant.id, sucursal, persistConfig(), { removeCertificate });
      setAtvUsernameConfigured(Boolean(saved.atvUsernameConfigured));
      setAtvPasswordConfigured(Boolean(saved.atvPasswordConfigured));
      setCertificateConfigured(Boolean(saved.certificateConfigured));
      setAtvUsername('');
      setAtvPassword('');
      setPinP12('');
      setP12Base64('');
      setRemoveCertificate(false);
      setIsValidated(Boolean(saved.isValidated));
      setCertExpiresOn(saved.certExpiresOn);
      if (onUpdateTenant) {
        const safeConfig: HaciendaConfig = {
          ...saved,
          atvUsername: undefined,
          atvPassword: undefined,
          pinP12: undefined,
          p12Base64: undefined
        };
        onUpdateTenant({ ...tenant, cedulaJuridica: cedulaEmisor.trim(), haciendaConfig: safeConfig });
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error: any) {
      setSaveError(error?.message || 'No se pudo guardar la configuración de esta sucursal.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <form onSubmit={handleSaveConfig} className="space-y-6">
        
        {/* Banner Informativo y Estado */}
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden border border-stone-700">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                isValidated 
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400' 
                  : 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
              }`}>
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Facturación Electrónica Hacienda CR (v4.4)
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    environment === 'production' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {environment === 'production' ? 'Producción Oficial' : 'Sandbox Pruebas'}
                  </span>
                </h3>
                <div className="flex items-center gap-3 text-xs mt-1 text-stone-300">
                  {isValidated ? (
                    <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Registrado y Verificado ante Hacienda ATV
                    </span>
                  ) : atvUsernameConfigured || atvUsername ? (
                    <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                      <Info className="w-3.5 h-3.5" />
                      Credenciales guardadas (Pendiente de prueba en vivo)
                    </span>
                  ) : (
                    <span className="text-stone-400">
                      Ingresa tus credenciales del portal ATV para emitir comprobantes legales.
                    </span>
                  )}
                  {certExpiresOn && (
                    <span className="text-stone-400 text-[11px] flex items-center gap-1">
                      <CalendarCheck className="w-3 h-3 text-stone-400" />
                      Llave expira: {certExpiresOn.split('T')[0]}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-300 font-medium">Entorno:</span>
              <div className="inline-flex rounded-xl bg-stone-950 p-1 border border-stone-800">
                <button
                  type="button"
                  onClick={() => handleEnvironmentChange('sandbox')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    environment === 'sandbox'
                      ? 'bg-amber-500 text-stone-950 shadow-sm font-bold'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Pruebas (Staging)
                </button>
                <button
                  type="button"
                  onClick={() => handleEnvironmentChange('production')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    environment === 'production'
                      ? 'bg-emerald-600 text-white shadow-sm font-bold'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Producción Real
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-stone-200">Sucursal con esta configuración de Hacienda</label>
              <select
                value={sucursal}
                onChange={(e) => { setSucursal(e.target.value); setIsValidated(false); setTestResult(null); }}
                disabled={!branchesReady || branches.length === 0}
                className="w-full mt-1 px-3 py-2.5 text-xs rounded-xl border border-stone-600 bg-stone-950 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
              >
                {branches.length === 0 && <option value={sucursal}>{branchesReady ? 'No hay sucursales disponibles' : 'Cargando sucursales…'}</option>}
                {branches.map(branch => <option key={branch.id} value={branch.code}>{branch.name} · {branch.code}</option>)}
              </select>
              <span className="text-[11px] text-stone-400 block mt-1">Cada cliente configura sus propias credenciales y cada sucursal conserva un perfil fiscal separado.</span>
            </div>
            <div className="text-[11px] text-stone-300 border border-stone-700 rounded-xl px-3 py-2.5">
              Terminal de esta caja: <strong className="font-mono text-white">{terminal}</strong>
            </div>
          </div>
          {(branchLoadError || (branchesReady && branches.length === 0)) && (
            <div className="mt-3 p-3 rounded-xl border border-amber-300/30 bg-amber-950/40 text-[11px] text-amber-100">
              {branchLoadError || 'No hay sucursales sincronizadas para este restaurante. Sincroniza la configuración de cajas y sucursales antes de guardar Hacienda.'}
            </div>
          )}

          {/* Barra de Cumplimiento 100% Hacienda v4.4 */}
          {(() => {
            const hasEmisor = !!cedulaEmisor.replace(/\D/g, '');
            const hasAct = /^\d{6}$/.test(codigoActividad.trim());
            const hasUbi = !!(provincia && canton && distrito && otrasSenas.trim());
            const hasCred = !!((atvUsername.trim() || atvUsernameConfigured) && (atvPassword || atvPasswordConfigured));
            const hasCert = !!((p12Base64 && isValidHaciendaP12Pin(pinP12)) || certificateConfigured);
            const hasTerm = !!(branches.some(branch => branch.code === sucursal) && terminal);

            const checks = [
              { label: 'Cédula Emisor', ok: hasEmisor },
              { label: 'Actividad DGT (6 dgt)', ok: hasAct },
              { label: 'Ubicación ATV', ok: hasUbi },
              { label: 'Credenciales ATV', ok: hasCred },
              { label: 'Llave .p12 y PIN', ok: hasCert },
              { label: 'Sucursal y Terminal', ok: hasTerm },
              { label: 'Conexión Validada', ok: isValidated },
            ];

            const completed = checks.filter(c => c.ok).length;
            const pct = Math.round((completed / checks.length) * 100);

            const handleDownloadSampleXml = () => {
              const now = new Date();
              const { clave, consecutivo } = buildClaveYConsecutivo({
                cedula: cedulaEmisor || '3101123456',
                branchCode: sucursal || '001',
                terminalCode: terminal || '00001',
                tipo: 'FE',
                numero: 1,
                fecha: now
              });

              const sampleInvoice: ElectronicInvoiceCR = {
                clave50Digitos: clave,
                consecutivo: consecutivo,
                emisor: {
                  nombre: tenant.name,
                  cedulaJuridica: cedulaEmisor || '3101123456',
                  nombreComercial: tenant.name,
                  correo: tenant.email,
                  sucursal: sucursal || '001',
                  terminal: terminal || '00001'
                },
                receptor: {
                  nombre: 'Cliente de Prueba SaborAI',
                  tipoIdentificacion: '01-Fisica',
                  identificacion: '111111111',
                  correo: 'cliente@prueba.com'
                },
                fechaEmision: now.toISOString(),
                condicionVenta: '01-Efectivo',
                tipoDocumento: 'FE',
                moneda: 'CRC',
                tipoCambio: 1,
                items: [
                  {
                    name: 'Almuerzo Ejecutivo Restaurante',
                    price: 5000,
                    quantity: 1,
                    cabysCode: '6331000000000',
                    taxRate: 0.13,
                    category: 'Cocina'
                  }
                ],
                subtotal: 5000,
                iva13: 650,
                iva4: 0,
                iva2: 0,
                iva1: 0,
                servicio10: 500,
                totalComprobante: 6150,
                medioPago: '01-Efectivo',
                estadoHacienda: 'PROCESANDO'
              };

              const xml = generateHaciendaXmlV44(sampleInvoice, {
                ...tenant,
                cedulaJuridica: cedulaEmisor || '3101123456',
                haciendaConfig: { environment, tipoIdentificacion, codigoActividad, provincia, canton, distrito, otrasSenas, proveedorSistemas }
              }, { environment, tipoIdentificacion, cedulaEmisor, codigoActividad, provincia, canton, distrito, otrasSenas, proveedorSistemas });

              downloadXmlFile(xml, `FacturaElectronica_Prueba_v4.4_${consecutivo}.xml`);
            };

            return (
              <div className="mt-6 pt-5 border-t border-stone-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-300">
                        Estado de Cumplimiento Hacienda v4.4:
                      </span>
                      <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                        pct === 100 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                          : pct >= 70 
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}>
                        {pct}% {pct === 100 ? '✓ 100% OPERATIVO' : 'CONFIGURADO'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      {pct === 100 
                        ? 'Tu restaurante cuenta con todos los parámetros de la versión 4.4 de Hacienda Costa Rica.' 
                        : `${completed} de ${checks.length} requerimientos completados para facturar al 100%.`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadSampleXml}
                    className="px-3.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-stone-700"
                    title="Descargar archivo XML de prueba bajo el esquema oficial v4.4"
                  >
                    <FileCode className="w-3.5 h-3.5 text-amber-400" />
                    <span>Descargar XML de Prueba v4.4</span>
                  </button>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-stone-950 rounded-full h-2 overflow-hidden border border-stone-800">
                  <div 
                    className={`h-full transition-all duration-500 ${
                      pct === 100 ? 'bg-emerald-400' : pct >= 70 ? 'bg-amber-400' : 'bg-rose-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Checklist pill tags */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 mt-3">
                  {checks.map((chk, i) => (
                    <div 
                      key={i} 
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5 border ${
                        chk.ok 
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60' 
                          : 'bg-stone-950/60 text-stone-500 border-stone-800'
                      }`}
                    >
                      {chk.ok ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <div className="w-2 h-2 rounded-full bg-stone-600 shrink-0" />}
                      <span className="truncate">{chk.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Formulario Principal en 2 Columnas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Columna Izquierda: Credenciales ATV */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
              <Key className="w-5 h-5 text-stone-700" />
              <h4 className="font-bold text-stone-900 text-sm">Credenciales ATV (IDP Hacienda)</h4>
            </div>

            <p className="text-xs text-stone-500 mb-2">
              Generadas en el portal ATV dentro de <em>Comprobantes Electrónicos &gt; Llave Criptográfica y Generar Contraseña</em>.
            </p>

            {environment === 'sandbox' && (
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl mb-4 text-[11px] text-amber-900 leading-relaxed shadow-sm">
                <p className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-600"/> ¡Atención con el Entorno de Pruebas!</p>
                <ul className="list-disc pl-4 space-y-1 text-amber-800">
                  <li>Las credenciales de Producción <strong>no funcionan</strong> en Pruebas. Debes generar unas exclusivas en ATV bajo el menú de "Comprobantes Electrónicos" &gt; "Entorno de Pruebas".</li>
                  <li>El usuario de Pruebas debe terminar obligatoriamente en <strong className="break-all font-mono">@stag.comprobanteselectronicos.go.cr</strong>.</li>
                  <li>La contraseña es la que genera ATV, no tu contraseña de ingreso web.</li>
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700">Usuario de Comprobantes Electrónicos (ATV)</label>
              <input
                type="text"
                value={atvUsername}
                onChange={(e) => {
                  setAtvUsername(e.target.value);
                  setIsValidated(false);
                }}
                onBlur={() => persistConfig()}
                placeholder={atvUsernameConfigured ? 'Usuario guardado de forma segura; escribe aquí solo para reemplazarlo' : (environment === 'sandbox' ? 'cpf-01-0000-0000@stag.comprobanteselectronicos.go.cr' : 'cpf-01-0000-0000@comprobanteselectronicos.go.cr')}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
              />
              <span className="text-[11px] text-stone-400">Comienza usualmente con cpf-... o cpj-...</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700">Contraseña de Comprobantes Electrónicos (ATV)</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={atvPassword}
                  onChange={(e) => {
                    setAtvPassword(e.target.value);
                    setIsValidated(false);
                  }}
                  onBlur={() => persistConfig()}
                  placeholder={atvPasswordConfigured ? 'Contraseña guardada de forma segura; escribe aquí solo para reemplazarla' : 'Contraseña generada en ATV'}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
                <span className="text-[11px] text-stone-400">Contraseña generada en ATV. Al editar un perfil, deja el campo vacío para conservar la contraseña guardada.</span>
            </div>

            {/* Actividad Económica & Datos Tributarios */}
            <div className="pt-3 border-t border-stone-100 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-700">Tipo de Cédula</label>
                <select
                  value={tipoIdentificacion}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setTipoIdentificacion(val);
                    persistConfig({ tipoIdentificacion: val });
                  }}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 bg-white"
                >
                  <option value="01">01 - Física (9 dígitos)</option>
                  <option value="02">02 - Jurídica (10 dígitos)</option>
                  <option value="03">03 - DIMEX (11-12 dígitos)</option>
                  <option value="04">04 - NITE (10 dígitos)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-700">Cód. Actividad (DGT)</label>
                <input
                  type="text"
                  maxLength={6}
                  value={codigoActividad}
                  onChange={(e) => setCodigoActividad(e.target.value)}
                  onBlur={() => persistConfig()}
                  placeholder="561001"
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
              </div>

              <div className="col-span-2">
                <label className="text-xs font-semibold text-stone-700">Cédula del Emisor (la de tu certificado .p12)</label>
                <input
                  type="text"
                  value={cedulaEmisor}
                  onChange={(e) => setCedulaEmisor(e.target.value)}
                  onBlur={() => {
                    persistConfig();
                    if (normalizeCedula(cedulaEmisor).length >= 9 && actividadesAtv.length === 0) {
                      handleLookupActividades(cedulaEmisor);
                    }
                  }}
                  placeholder={tipoIdentificacion === '01' ? '4-0188-0588' : '3-101-123456'}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
                <span className="text-[11px] text-stone-400">Física: 9 dígitos (ej. 4-0188-0588). Jurídica: 10 dígitos (ej. 3-101-123456). Debe ser la misma del .p12 y del usuario ATV.</span>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => handleLookupActividades()}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-stone-900 text-white hover:bg-stone-700"
                  >
                    Consultar mis actividades en Hacienda
                  </button>
                  {lookupMsg && <p className="text-[11px] text-stone-600 mt-1">{lookupMsg}</p>}
                  <div className="flex flex-col gap-1 mt-1">
                    {actividadesAtv.map((a) => (
                      <button
                        key={a.codigo}
                        type="button"
                        onClick={() => { setCodigoActividad(a.codigo); persistConfig({ codigoActividad: a.codigo }); setLookupMsg(`Actividad ${a.codigo} seleccionada.`); }}
                        className={`text-left px-3 py-1.5 text-xs rounded-lg border ${codigoActividad === a.codigo ? 'border-emerald-500 bg-emerald-50' : 'border-stone-300 bg-white hover:bg-stone-50'}`}
                      >
                        <span className="font-mono font-semibold">{a.codigo}</span> — {a.descripcion} {a.estado !== 'A' ? '(inactiva)' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="col-span-2 grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-stone-700">Provincia (1 dígito)</label>
                  <input
                    type="text"
                    maxLength={1}
                    value={provincia}
                    onChange={(e) => setProvincia(e.target.value.replace(/\D/g, ''))}
                    onBlur={() => persistConfig()}
                    placeholder="1"
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-stone-700">Cantón (2 dígitos)</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={canton}
                    onChange={(e) => setCanton(e.target.value.replace(/\D/g, ''))}
                    onBlur={() => { const v = canton.padStart(2, '0'); setCanton(v); persistConfig({ canton: v }); }}
                    placeholder="01"
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-stone-700">Distrito (2 dígitos)</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={distrito}
                    onChange={(e) => setDistrito(e.target.value.replace(/\D/g, ''))}
                    onBlur={() => { const v = distrito.padStart(2, '0'); setDistrito(v); persistConfig({ distrito: v }); }}
                    placeholder="01"
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs font-semibold text-stone-700">Otras Señas</label>
                  <input
                    type="text"
                    value={otrasSenas}
                    onChange={(e) => setOtrasSenas(e.target.value)}
                    onBlur={() => persistConfig()}
                    placeholder="Dirección exacta registrada en ATV"
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  />
                  <span className="text-[11px] text-stone-400">Provincia, cantón y distrito deben ser exactamente los registrados en ATV (Ficha Tributaria). El Cód. Actividad debe ser uno de los dados de alta en ATV (CIIU v4, 6 dígitos; restaurantes: 561001).</span>
                </div>
              </div>
            </div>


            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-700">Proveedor de Sistemas (12 dígitos numéricos - v4.4)</label>
                <input
                  type="text"
                  maxLength={12}
                  value={proveedorSistemas}
                  onChange={(e) => setProveedorSistemas(e.target.value.replace(/\D/g, ''))}
                  onBlur={() => persistConfig()}
                  placeholder={cedulaEmisor.replace(/\D/g, '').padStart(12, '0') || '310100000000'}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
                <span className="text-[11px] text-stone-400">Si se deja vacío, se utilizará la cédula del emisor de este cliente; no se comparte un identificador de proveedor entre clientes.</span>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Llave Criptográfica (.p12) y PIN */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
                <Lock className="w-5 h-5 text-stone-700" />
                <h4 className="font-bold text-stone-900 text-sm">Firma Criptográfica (.p12) & PIN</h4>
              </div>

              <p className="text-xs text-stone-500">
                La llave digital permite firmar los archivos XML bajo el estándar <strong>XAdES-EPES</strong> obligatorio por la DGT.
              </p>

              {/* Upload Dropzone */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-stone-700">Archivo de Llave Criptográfica (.p12 / .pfx)</label>
                <label className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all relative ${
                  (p12Base64 || certificateConfigured)
                    ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/70' 
                    : 'border-stone-300 hover:border-stone-400 bg-stone-50/50 hover:bg-stone-50'
                }`}>
                  <input
                    type="file"
                    accept=".p12,.pfx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {(p12Base64 || certificateConfigured) ? (
                    <div className="text-center w-full">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                        <FileCheck className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-stone-900 block truncate max-w-[240px] mx-auto">
                        {p12FileName || 'Llave criptográfica guardada de forma segura'}
                      </span>
                      <span className="text-[11px] text-emerald-700 font-semibold block mt-0.5">
                        {p12Base64 ? '✓ Archivo seleccionado; se cifrará al guardar' : '✓ Certificado guardado cifrado en el servidor'}
                      </span>
                      
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          handleRemoveFile();
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-800 font-medium px-2 py-0.5 rounded-lg hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Eliminar y cambiar archivo
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-10 h-10 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center mx-auto mb-2">
                        <UploadCloud className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-stone-800 block">Subir Llave Criptográfica (.p12)</span>
                      <span className="text-[11px] text-stone-400">Arrastra aquí tu archivo o haz clic para explorar</span>
                    </div>
                  )}
                </label>
              </div>

              {/* PIN o contraseña de la llave */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700">PIN o contraseña de la llave (.p12)</label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    maxLength={256}
                    value={pinP12}
                    onChange={(e) => {
                      setPinP12(e.target.value);
                      setIsValidated(false);
                      setPinValidationError(null);
                    }}
                    onBlur={() => {
                      if (pinP12 && !isValidHaciendaP12Pin(pinP12)) setPinValidationError(HACIENDA_P12_PIN_FORMAT_ERROR);
                      else setPinValidationError(null);
                    }}
                    placeholder={certificateConfigured ? 'Llave guardada; escribe aquí solo para cambiar el PIN' : 'PIN o contraseña exacta de la llave'}
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <span className="text-[11px] text-stone-400">Debe ser exactamente de 4 o 14 dígitos numéricos; se conserva exactamente como la escribiste, sin recortarlo.</span>
                {pinValidationError && <span role="alert" className="block text-[11px] text-rose-600">{pinValidationError}</span>}
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="pt-4 border-t border-stone-100">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || isSaving || !branches.some(branch => branch.code === sucursal) || !((atvUsername && atvPassword) || (atvUsernameConfigured && atvPasswordConfigured)) || !((p12Base64 && pinP12) || (certificateConfigured && !removeCertificate))}
                className="w-full py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-800 text-xs font-bold flex items-center justify-center gap-2 transition-all border border-stone-300 shadow-xs"
              >
                {isTesting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-stone-600" />
                    <span>Validando con Hacienda y Llave...</span>
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4 text-stone-600" />
                    <span>Probar Conexión con ATV y Llave .p12</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Resultados del Test */}
        {testResult && (
          <div className={`p-4 rounded-2xl border text-xs transition-all ${
            testResult.success 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="font-bold text-sm">
                  {testResult.success ? 'Conexión y Certificado Validados Exitosamente' : 'Error en la Verificación'}
                </p>
                <p className="text-stone-700">{testResult.message}</p>
                {testResult.details && (
                  <pre className="mt-2 p-2 bg-white/70 rounded-lg text-[10px] font-mono overflow-x-auto border border-stone-200">
                    {JSON.stringify(testResult.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Botón Guardar Cambios */}
        {saveError && (
          <div role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">
            {saveError}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-stone-200">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Info className="w-4 h-4 text-stone-400 shrink-0" />
            <span>Las credenciales y el certificado se guardan cifrados en el servidor para este cliente y sucursal; no se vuelven a mostrar.</span>
          </div>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-xs text-emerald-600 font-bold flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-4 h-4" />
                Configuración guardada y registrada en el sistema
              </span>
            )}

            <button
              type="submit"
              disabled={isSaving || !branches.some(branch => branch.code === sucursal)}
              className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 disabled:text-white text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-amber-400" />}
              <span>{isSaving ? 'Guardando en servidor…' : 'Guardar Configuración de Hacienda'}</span>
            </button>
          </div>
        </div>

      </form>
    </div>
  );
};
