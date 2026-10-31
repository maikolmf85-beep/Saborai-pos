import React, { useState, useEffect } from 'react';
import { 
  X, 
  Sparkles, 
  Cpu, 
  Globe2, 
  BrainCircuit, 
  Activity, 
  Printer, 
  FileText, 
  UtensilsCrossed, 
  Coins, 
  HardDrive, 
  CheckCircle2, 
  RefreshCw, 
  PlusCircle, 
  Sliders, 
  Calendar, 
  ShieldCheck,
} from 'lucide-react';
import { 
  nyzaLearningService, 
  NyzaHeuristic, 
  DailyLearningCycle, 
  HeuristicCategory
} from '../services/nyzaLearningService';
import { TenantInfo } from '../types';

interface NyzaLearningHubProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
  onOpenCopilot?: () => void;
}

export const NyzaLearningHub: React.FC<NyzaLearningHubProps> = ({
  isOpen,
  onClose,
  tenant,
  onOpenCopilot
}) => {
  const [activeTab, setActiveTab] = useState<'heuristics' | 'history' | 'global' | 'teach' | 'settings'>('heuristics');
  const [heuristics, setHeuristics] = useState<NyzaHeuristic[]>([]);
  const [dailyCycles, setDailyCycles] = useState<DailyLearningCycle[]>([]);
  const [observationCount, setObservationCount] = useState<number>(nyzaLearningService.getObservationCount());
  const [selectedCategory, setSelectedCategory] = useState<HeuristicCategory | 'ALL'>('ALL');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  // Formulario para enseñar a Nyza
  const [teachCategory, setTeachCategory] = useState<HeuristicCategory>('KITCHEN_SPEED');
  const [teachTitle, setTeachTitle] = useState('');
  const [teachRule, setTeachRule] = useState('');
  const [teachSuccess, setTeachSuccess] = useState(false);

  // Recargar datos desde el servicio
  const refreshData = () => {
    setHeuristics(nyzaLearningService.getHeuristics());
    setDailyCycles(nyzaLearningService.getDailyCycles());
    setObservationCount(nyzaLearningService.getObservationCount());
  };

  useEffect(() => {
    if (isOpen) {
      nyzaLearningService.setTenantId(tenant.id);
      refreshData();
      const unsubscribe = nyzaLearningService.subscribe(() => {
        refreshData();
      });
      return () => unsubscribe();
    }
  }, [isOpen, tenant.id]);

  if (!isOpen) return null;

  // Generar un resumen manual de observaciones locales; no se entrena un modelo.
  const handleForceDailyCycle = () => {
    setIsScanning(true);
    setScanMessage('Contando observaciones locales disponibles en memoria...');
    setTimeout(() => {
      nyzaLearningService.runDailyLearningCycle(true);
      setIsScanning(false);
      setScanMessage('');
      refreshData();
    }, 250);
  };

  // Enseñar nueva regla a Nyza
  const handleTeachSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teachTitle.trim() || !teachRule.trim()) return;

    nyzaLearningService.teachNyza(teachCategory, teachTitle.trim(), teachRule.trim());
    setTeachTitle('');
    setTeachRule('');
    setTeachSuccess(true);
    setTimeout(() => setTeachSuccess(false), 3000);
    refreshData();
  };

  const filteredHeuristics = selectedCategory === 'ALL' 
    ? heuristics 
    : heuristics.filter(h => h.category === selectedCategory);

  const getCategoryBadge = (category: HeuristicCategory) => {
    switch (category) {
      case 'HARDWARE_RESILIENCE':
        return { label: 'Impresoras y red local', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: <Printer className="w-3.5 h-3.5" /> };
      case 'DGT_TAX_INTELLIGENCE':
        return { label: 'Tributación DGT', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: <FileText className="w-3.5 h-3.5" /> };
      case 'KITCHEN_SPEED':
        return { label: 'Velocidad Cocina', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: <UtensilsCrossed className="w-3.5 h-3.5" /> };
      case 'FINANCIAL_VELOCITY':
        return { label: 'Flujo Financiero', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: <Coins className="w-3.5 h-3.5" /> };
      case 'SYSTEM_HYGIENE':
        return { label: 'Higiene & Memoria', color: 'bg-teal-500/10 text-teal-400 border-teal-500/20', icon: <HardDrive className="w-3.5 h-3.5" /> };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[92vh] bg-stone-950 text-stone-100 rounded-3xl border border-stone-800 shadow-[0_20px_70px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden">
        
        {/* ========================================================= */}
        {/* ENCABEZADO PRINCIPAL: ESTADO NEURAL Y EVOLUCIÓN GLOBAL   */}
        {/* ========================================================= */}
        <header className="px-6 py-5 border-b border-stone-800/90 bg-gradient-to-r from-stone-950 via-stone-900 to-stone-950 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center justify-center w-13 h-13 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/40 shadow-[0_0_25px_rgba(169,185,148,0.25)]">
              <BrainCircuit className="w-7 h-7 text-[#a9b994] animate-pulse" />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-stone-950 shadow-sm" />
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Nyza • notas y observaciones locales</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#a9b994] text-stone-950 font-black uppercase tracking-wider">
                    Sin entrenamiento automático
                  </span>
                </h2>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Reglas guardadas en este navegador • {tenant.name}
              </p>
            </div>
          </div>

          {/* Conteos locales y resumen manual */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-stone-900 border border-stone-800">
              <Cpu className="w-4 h-4 text-[#a9b994]" />
              <div className="text-left">
                <span className="text-[10px] text-stone-400 block uppercase font-bold leading-tight">Reglas locales</span>
                <span className="text-xs font-black text-white">{heuristics.length}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-stone-900 border border-stone-800">
              <Activity className="w-4 h-4 text-[#a9b994]" />
              <div className="text-left">
                <span className="text-[10px] text-stone-400 block uppercase font-bold leading-tight">Observaciones en memoria</span>
                <span className="text-xs font-black text-white">{observationCount}</span>
              </div>
            </div>

            <button
              onClick={handleForceDailyCycle}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#a9b994] text-stone-950 hover:bg-[#b8c9a3] active:scale-95 transition-all font-bold text-xs shadow-[0_0_20px_rgba(169,185,148,0.3)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Contando...' : 'Crear resumen local'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
              title="Cerrar Panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* ========================================================= */}
        {/* BANNER DE ESCANEO / SÍNTESIS EN VIVO                      */}
        {/* ========================================================= */}
        {isScanning && (
          <div className="bg-gradient-to-r from-[#a9b994]/20 via-emerald-500/15 to-[#a9b994]/20 border-b border-[#a9b994]/40 px-6 py-2.5 flex items-center justify-between animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3 text-xs text-[#a9b994] font-medium">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              <span>{scanMessage}</span>
            </div>
            <span className="text-[10px] text-stone-400 font-mono">No modifica el modelo ni envía datos.</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* NAVEGACIÓN POR PESTAÑAS DEL CENTRO DE MANDO               */}
        {/* ========================================================= */}
        <nav className="flex items-center gap-1 px-6 border-b border-stone-800 bg-stone-900/50 shrink-0 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('heuristics')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'heuristics'
                ? 'border-[#a9b994] text-[#a9b994]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Reglas locales ({heuristics.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'history'
                ? 'border-[#a9b994] text-[#a9b994]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Resúmenes locales ({dailyCycles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('global')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'global'
                ? 'border-[#a9b994] text-[#a9b994]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Globe2 className="w-4 h-4" />
            <span>Conexión global</span>
          </button>

          <button
            onClick={() => setActiveTab('teach')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'teach'
                ? 'border-[#a9b994] text-[#a9b994]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Guardar nota</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'settings'
                ? 'border-[#a9b994] text-[#a9b994]'
                : 'border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Capacidades</span>
          </button>
        </nav>

        {/* ========================================================= */}
        {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA SELECCIONADA            */}
        {/* ========================================================= */}
        <div className="flex-1 overflow-y-auto p-6 bg-stone-950/70">
          
          {/* 1. REGLAS LOCALES */}
          {activeTab === 'heuristics' && (
            <div className="space-y-6">
              
              {/* Filtro por Categorías */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400 font-bold mr-1">Filtrar por pilar:</span>
                {[
                  { id: 'ALL', label: 'Todas las Heurísticas' },
                  { id: 'HARDWARE_RESILIENCE', label: 'Impresoras & LAN' },
                  { id: 'DGT_TAX_INTELLIGENCE', label: 'Tributación DGT' },
                  { id: 'KITCHEN_SPEED', label: 'Velocidad Cocina' },
                  { id: 'FINANCIAL_VELOCITY', label: 'Flujo SINPE/Caja' },
                  { id: 'SYSTEM_HYGIENE', label: 'Memoria & DB' }
                ].map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id as any)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      selectedCategory === cat.id
                        ? 'bg-[#a9b994] text-stone-950 shadow-sm'
                        : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Lista de Heurísticas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredHeuristics.map(h => {
                  const badge = getCategoryBadge(h.category);
                  const isActive = h.status === 'ACTIVE';

                  return (
                    <div
                      key={h.id}
                      className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between ${
                        isActive
                          ? 'bg-stone-900/70 border-stone-800 hover:border-stone-700 shadow-md'
                          : 'bg-stone-950/50 border-stone-900 opacity-60'
                      }`}
                    >
                      <div>
                        {/* Cabecera de la tarjeta */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge.color}`}>
                            {badge.icon}
                            <span>{badge.label}</span>
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => nyzaLearningService.toggleHeuristicStatus(h.id)}
                              className={`text-[10px] px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                                isActive 
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                  : 'bg-stone-800 text-stone-400'
                              }`}
                            >
                              {isActive ? 'Activa' : 'Pausada'}
                            </button>
                          </div>
                        </div>

                        {/* Título y descripción */}
                        <h4 className="text-sm font-bold text-white mb-1.5 leading-snug">
                          {h.title}
                        </h4>
                        <p className="text-xs text-stone-300 leading-relaxed mb-3">
                          {h.description}
                        </p>
                      </div>

                      {/* Origen local de la nota */}
                      <div className="pt-3 border-t border-stone-800/80 flex items-center justify-between text-[10px] text-stone-400">
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#a9b994]" />
                          <span>Nota local guardada {new Date(h.createdAt).toLocaleDateString('es-CR')}</span>
                        </div>

                        <div className="flex items-center gap-1 text-stone-400">
                          <Activity className="w-3 h-3 text-cyan-400" />
                          <span>No se aplica automáticamente</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}

          {/* 2. BITÁCORA DE APRENDIZAJE DIARIO */}
          {activeTab === 'history' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="p-4 rounded-2xl bg-[#a9b994]/10 border border-[#a9b994]/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-5 h-5 text-[#a9b994]" />
                  <div>
                    <h4 className="text-xs font-bold text-white">Resúmenes locales manuales</h4>
                    <p className="text-[11px] text-stone-400">
                      Solo cuentan eventos disponibles en memoria; no hay ciclos nocturnos ni entrenamiento automático.
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative pl-6 border-l-2 border-stone-800 space-y-6">
                {dailyCycles.length === 0 && (
                  <p className="py-4 text-xs text-stone-400">Aún no hay resúmenes locales. Los registros antiguos de muestra ya no se presentan como mediciones.</p>
                )}
                {dailyCycles.map(cycle => (
                  <div key={cycle.id} className="relative">
                    {/* Punto en la línea de tiempo */}
                    <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-[#a9b994] border-4 border-stone-950 shadow-sm" />

                    <div className="p-5 rounded-2xl bg-stone-900 border border-stone-800 shadow-md">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-white px-2 py-0.5 rounded-md bg-stone-800">
                            {cycle.date}
                          </span>
                          <span className="text-[11px] text-stone-400">
                            {cycle.observationsCount} eventos analizados
                          </span>
                        </div>

                        <span className="text-[10px] text-stone-400">Solo en este navegador</span>
                      </div>

                      <p className="text-xs text-stone-200 leading-relaxed mb-4">
                        {cycle.summary}
                      </p>

                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. ESTADO DE CONEXIÓN GLOBAL */}
          {activeTab === 'global' && (
            <div className="mx-auto max-w-3xl rounded-3xl border border-stone-800 bg-stone-900/70 p-6">
              <div className="mb-3 flex items-center gap-2 text-[#a9b994]">
                <Globe2 className="h-5 w-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Red global no configurada</span>
              </div>
              <h3 className="text-lg font-black text-white">Nyza no está conectada a una flota compartida</h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-400">
                Esta versión no envía ni recibe heurísticas de otros restaurantes. No hay datos verificados de nodos, tendencias nacionales, pagos dominantes ni estado de Hacienda en esta pantalla.
              </p>
            </div>
          )}

          {/* 4. ENSEÑAR A NYZA (HUMAN-IN-THE-LOOP) */}
          {activeTab === 'teach' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-[#a9b994]" />
                  <span>Guardar una nota local</span>
                </h3>
                <p className="text-xs text-stone-400">
                  Guarda una guía en este navegador para consultarla después. No entrena el modelo ni se sincroniza con otros dispositivos.
                </p>
              </div>

              {teachSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Nota guardada localmente. Esto no cambia el modelo ni aumenta un puntaje de IA.</span>
                </div>
              )}

              <form onSubmit={handleTeachSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-300 mb-1.5">
                    Pilar Operativo
                  </label>
                  <select
                    value={teachCategory}
                    onChange={(e) => setTeachCategory(e.target.value as HeuristicCategory)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs text-white focus:border-[#a9b994] focus:outline-none"
                  >
                    <option value="KITCHEN_SPEED">Velocidad Cocina & KDS</option>
                    <option value="HARDWARE_RESILIENCE">Impresoras y red local</option>
                    <option value="DGT_TAX_INTELLIGENCE">Tributación DGT & Facturas</option>
                    <option value="FINANCIAL_VELOCITY">Flujo Financiero & Caja</option>
                    <option value="SYSTEM_HYGIENE">Higiene & Rendimiento del Sistema</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-300 mb-1.5">
                    Título de la Regla o Hábito
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Domingos de Brunch: alta demanda de café chorreado"
                    value={teachTitle}
                    onChange={(e) => setTeachTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs text-white focus:border-[#a9b994] focus:outline-none placeholder:text-stone-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-300 mb-1.5">
                    Descripción / Instrucción Específica para Nyza
                  </label>
                  <textarea
                    required
                    rows={4}
                    placeholder="Ej: Los domingos de 9am a 12pm el bar se satura con pedidos de café. Si detectas retrasos en comandas, sugiere dividir la preparación entre las 2 máquinas de espresso y advertir al mesero."
                    value={teachRule}
                    onChange={(e) => setTeachRule(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs text-white focus:border-[#a9b994] focus:outline-none placeholder:text-stone-500 leading-relaxed"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[#a9b994] text-stone-950 font-bold text-xs hover:bg-[#b8c9a3] active:scale-95 transition-all shadow-md cursor-pointer flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Guardar nota local</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 5. CAPACIDADES NO IMPLEMENTADAS */}
          {activeTab === 'settings' && (
            <div className="mx-auto max-w-2xl rounded-2xl border border-stone-800 bg-stone-900/70 p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
                <Sliders className="h-4 w-4 text-[#a9b994]" />
                Capacidades automáticas no conectadas
              </h3>
              <p className="text-xs leading-relaxed text-stone-400">
                Los controles anteriores solo guardaban preferencias y no activaban procesos. Para evitar una falsa sensación de protección, se quitaron. Esta versión no redirige impresoras de forma autónoma, no procesa contingencias fiscales, no compacta bases de datos, no libera la RAM del sistema y no sincroniza una red global.
              </p>
            </div>
          )}

        </div>

        {/* ========================================================= */}
        {/* PIE DE PÁGINA DEL MODAL                                  */}
        {/* ========================================================= */}
        <footer className="px-6 py-4 border-t border-stone-800/80 bg-stone-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <ShieldCheck className="w-4 h-4 text-[#a9b994]" />
            <span>Las notas se guardan localmente. Evita incluir credenciales o datos personales; las conversaciones pueden enviarse al proveedor de IA configurado.</span>
          </div>

          <div className="flex items-center gap-3">
            {onOpenCopilot && (
              <button
                onClick={() => {
                  onClose();
                  onOpenCopilot();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-stone-900 text-stone-300 hover:text-white border border-stone-800 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>Hablar con Nyza</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-stone-800 text-white hover:bg-stone-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};

export default NyzaLearningHub;
