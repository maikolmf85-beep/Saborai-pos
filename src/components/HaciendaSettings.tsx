import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Key, 
  FileCheck, 
  UploadCloud, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  EyeOff, 
  Lock, 
  Building2, 
  FileText, 
  Check, 
  Info,
  Server
} from 'lucide-react';
import { TenantInfo, HaciendaConfig } from '../types';
import { haciendaService } from '../services/haciendaService';

interface HaciendaSettingsProps {
  tenant: TenantInfo;
  onUpdateTenant?: (updated: TenantInfo) => void;
}

export const HaciendaSettings: React.FC<HaciendaSettingsProps> = ({ tenant, onUpdateTenant }) => {
  // Load initial config from service or tenant
  const existingConfig = haciendaService.getConfig() || tenant.haciendaConfig;

  const [environment, setEnvironment] = useState<'sandbox' | 'production'>(existingConfig?.environment || 'sandbox');
  const [atvUsername, setAtvUsername] = useState(existingConfig?.atvUsername || '');
  const [atvPassword, setAtvPassword] = useState(existingConfig?.atvPassword || '');
  const [showPassword, setShowPassword] = useState(false);
  const [pinP12, setPinP12] = useState(existingConfig?.pinP12 || '');
  const [showPin, setShowPin] = useState(false);
  
  const [p12FileName, setP12FileName] = useState(existingConfig?.p12FileName || '');
  const [p12Base64, setP12Base64] = useState(existingConfig?.p12Base64 || '');
  
  const [tipoIdentificacion, setTipoIdentificacion] = useState<'01' | '02' | '03' | '04'>(existingConfig?.tipoIdentificacion || '02');
  const [codigoActividad, setCodigoActividad] = useState(existingConfig?.codigoActividad || '561001');
  const [sucursal, setSucursal] = useState(existingConfig?.sucursal || '001');
  const [terminal, setTerminal] = useState(existingConfig?.terminal || '00001');

  // Test state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync if tenant changes
  useEffect(() => {
    const cfg = haciendaService.getConfig() || tenant.haciendaConfig;
    if (cfg) {
      setEnvironment(cfg.environment || 'sandbox');
      setAtvUsername(cfg.atvUsername || '');
      setAtvPassword(cfg.atvPassword || '');
      setPinP12(cfg.pinP12 || '');
      setP12FileName(cfg.p12FileName || '');
      setP12Base64(cfg.p12Base64 || '');
      setTipoIdentificacion(cfg.tipoIdentificacion || '02');
      setCodigoActividad(cfg.codigoActividad || '561001');
      setSucursal(cfg.sucursal || '001');
      setTerminal(cfg.terminal || '00001');
    }
  }, [tenant]);

  // Handle .p12 file upload
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
        // Remove data URL prefix (e.g., "data:application/x-pkcs12;base64,")
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        setP12Base64(base64Data);
        setP12FileName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTestConnection = async () => {
    if (!atvUsername.trim() || !atvPassword.trim()) {
      alert('Debes ingresar el usuario y contraseña de ATV para realizar la prueba.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const testConfig: HaciendaConfig = {
      environment,
      atvUsername: atvUsername.trim(),
      atvPassword: atvPassword.trim(),
      pinP12: pinP12.trim(),
      p12FileName,
      p12Base64,
      tipoIdentificacion,
      codigoActividad,
      sucursal,
      terminal
    };

    const res = await haciendaService.testConnection(testConfig);
    setIsTesting(false);
    setTestResult(res);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();

    const configToSave: HaciendaConfig = {
      environment,
      atvUsername: atvUsername.trim(),
      atvPassword: atvPassword.trim(),
      pinP12: pinP12.trim(),
      p12FileName,
      p12Base64,
      tipoIdentificacion,
      codigoActividad,
      sucursal,
      terminal,
      isValidated: testResult?.success ?? existingConfig?.isValidated ?? false,
      certExpiresOn: testResult?.details?.expiresOn || existingConfig?.certExpiresOn,
      lastTestedAt: testResult?.success ? new Date().toISOString() : existingConfig?.lastTestedAt
    };

    haciendaService.saveConfig(configToSave);

    if (onUpdateTenant) {
      onUpdateTenant({
        ...tenant,
        haciendaConfig: configToSave
      });
    }

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <form onSubmit={handleSaveConfig} className="space-y-6">
        
        {/* Banner Informativo */}
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden border border-stone-700">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Facturación Electrónica Hacienda CR (v4.3)
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    environment === 'production' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {environment === 'production' ? 'Producción Oficial' : 'Sandbox Pruebas'}
                  </span>
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  Conexión directa con la Dirección General de Tributación (ATV) y firma digital XAdES-EPES.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-300 font-medium">Entorno:</span>
              <div className="inline-flex rounded-xl bg-stone-950 p-1 border border-stone-800">
                <button
                  type="button"
                  onClick={() => setEnvironment('sandbox')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    environment === 'sandbox'
                      ? 'bg-amber-500 text-stone-950 shadow-sm'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Pruebas (Staging)
                </button>
                <button
                  type="button"
                  onClick={() => setEnvironment('production')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    environment === 'production'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  Producción Real
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Formulario Principal en 2 Columnas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Columna Izquierda: Credenciales ATV */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
              <Key className="w-5 h-5 text-stone-700" />
              <h4 className="font-bold text-stone-900 text-sm">Credenciales ATV (IDP Hacienda)</h4>
            </div>

            <p className="text-xs text-stone-500">
              Generadas en el portal ATV dentro de <em>Comprobantes Electrónicos &gt; Llave Criptográfica y Generar Contraseña</em>.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-700">Usuario de Comprobantes Electrónicos (ATV)</label>
              <input
                type="text"
                value={atvUsername}
                onChange={(e) => setAtvUsername(e.target.value)}
                placeholder={environment === 'sandbox' ? 'cpf-01-0000-0000@stag.comprobanteselectronicos.go.cr' : 'cpf-01-0000-0000@comprobanteselectronicos.go.cr'}
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
                  onChange={(e) => setAtvPassword(e.target.value)}
                  placeholder="••••••••••••••••"
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
              <span className="text-[11px] text-stone-400">Contraseña generada en ATV (no la clave de entrar al sitio web).</span>
            </div>

            {/* Actividad Económica & Datos Tributarios */}
            <div className="pt-3 border-t border-stone-100 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-700">Tipo de Cédula</label>
                <select
                  value={tipoIdentificacion}
                  onChange={(e) => setTipoIdentificacion(e.target.value as any)}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900"
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
                  placeholder="561001"
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-700">Sucursal (3 dgt)</label>
                <input
                  type="text"
                  maxLength={3}
                  value={sucursal}
                  onChange={(e) => setSucursal(e.target.value)}
                  placeholder="001"
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-700">Punto de Venta (5 dgt)</label>
                <input
                  type="text"
                  maxLength={5}
                  value={terminal}
                  onChange={(e) => setTerminal(e.target.value)}
                  placeholder="00001"
                  className="w-full mt-1 px-3 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900 font-mono"
                />
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
                <label className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  p12Base64 
                    ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/70' 
                    : 'border-stone-300 hover:border-stone-400 bg-stone-50/50 hover:bg-stone-50'
                }`}>
                  <input
                    type="file"
                    accept=".p12,.pfx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {p12Base64 ? (
                    <div className="text-center">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                        <FileCheck className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-stone-900 block truncate max-w-[240px]">
                        {p12FileName || 'Llave Criptográfica Cargada'}
                      </span>
                      <span className="text-[11px] text-emerald-600 font-medium">✓ Certificado listo en memoria</span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-10 h-10 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center mx-auto mb-2">
                        <UploadCloud className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-stone-800 block">Subir Llave Criptográfica</span>
                      <span className="text-[11px] text-stone-400">Arrastra aquí tu archivo .p12 o haz clic para explorar</span>
                    </div>
                  )}
                </label>
              </div>

              {/* PIN de la llave */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700">PIN de 4 dígitos del Certificado</label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    maxLength={8}
                    value={pinP12}
                    onChange={(e) => setPinP12(e.target.value)}
                    placeholder="1234"
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
                <span className="text-[11px] text-stone-400">PIN de 4 dígitos definido al descargar la llave en ATV.</span>
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="pt-4 border-t border-stone-100">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !atvUsername || !atvPassword}
                className="w-full py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-800 text-xs font-bold flex items-center justify-center gap-2 transition-all border border-stone-300"
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
        <div className="flex items-center justify-between pt-4 border-t border-stone-200">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Info className="w-4 h-4 text-stone-400" />
            <span>Los datos se cifran y utilizan exclusivamente para firmar y remitir sus comprobantes.</span>
          </div>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="text-xs text-emerald-600 font-bold flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-4 h-4" />
                Configuración guardada correctamente
              </span>
            )}

            <button
              type="submit"
              className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-2"
            >
              <Check className="w-4 h-4 text-amber-400" />
              <span>Guardar Configuración de Hacienda</span>
            </button>
          </div>
        </div>

      </form>
    </div>
  );
};
