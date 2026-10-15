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
  ChevronRight,
  TrendingUp,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { 
  nyzaLearningService, 
  NyzaHeuristic, 
  DailyLearningCycle, 
  HeuristicCategory, 
  AutoTuningSettings 
} from '../services/nyzaLearningService';
import { TenantInfo, UserProfile } from '../types';

interface NyzaLearningHubProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
  currentUser?: UserProfile;
  onOpenCopilot?: () => void;
}

export const NyzaLearningHub: React.FC<NyzaLearningHubProps> = ({
  isOpen,
  onClose,
  tenant,
  currentUser,
  onOpenCopilot
}) => {
  const [activeTab, setActiveTab] = useState<'heuristics' | 'history' | 'global' | 'teach' | 'settings'>('heuristics');
  const [heuristics, setHeuristics] = useState<NyzaHeuristic[]>([]);
  const [dailyCycles, setDailyCycles] = useState<DailyLearningCycle[]>([]);
  const [autoTuning, setAutoTuning] = useState<AutoTuningSettings>(nyzaLearningService.getAutoTuningSettings());
  const [currentIQ, setCurrentIQ] = useState<number>(nyzaLearningService.getCurrentIQ());
  const [selectedCategory, setSelectedCategory] = useState<HeuristicCategory | 'ALL'>('ALL');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  // Formulario para enseñar a Nyza
  const [teachCategory, setTeachCategory] = useState<HeuristicCategory>('KITCHEN_SPEED');
  const [teachTitle, setTeachTitle] = useState('');
  const [teachRule, setTeachRule] = useState('');
  const [teachImpact, setTeachImpact] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM'>('HIGH');
  const [teachSuccess, setTeachSuccess] = useState(false);

  // Recargar datos desde el servicio
  const refreshData = () => {
    setHeuristics(nyzaLearningService.getHeuristics());
    setDailyCycles(nyzaLearningService.getDailyCycles());
    setAutoTuning(nyzaLearningService.getAutoTuningSettings());
    setCurrentIQ(nyzaLearningService.getCurrentIQ());
  };

  useEffect(() => {
    if (isOpen) {
      refreshData();
      const unsubscribe = nyzaLearningService.subscribe(() => {
        refreshData();
      });
      return () => unsubscribe();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const globalBenchmark = nyzaLearningService.getGlobalFleetBenchmark();
  const learningStreak = nyzaLearningService.getLearningStreakDays();

  // Ejecutar ciclo manual de aprendizaje
  const handleForceDailyCycle = () => {
    setIsScanning(true);
    setScanMessage('Analizando telemetría de red LAN, colas fiscales y tiempos KDS...');

    setTimeout(() => {
      setScanMessage('Consolidando patrones y cruzando con la red global de Costa Rica...');
    }, 1200);

    setTimeout(() => {
      setScanMessage('Sintetizando nuevas heurísticas y desplegando auto-optimizaciones...');
    }, 2400);

    setTimeout(() => {
      const cycle = nyzaLearningService.runDailyLearningCycle(true);
      setIsScanning(false);
      setScanMessage('');
      refreshData();
    }, 3600);
  };

  // Enseñar nueva regla a Nyza
  const handleTeachSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teachTitle.trim() || !teachRule.trim()) return;

    nyzaLearningService.teachNyza(teachCategory, teachTitle.trim(), teachRule.trim(), teachImpact);
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
        return { label: 'Resiliencia Hardware', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: <Printer className="w-3.5 h-3.5" /> };
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
                  <span>Nyza Core Intelligence</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#a9b994] text-stone-950 font-black uppercase tracking-wider">
                    IA Evolutiva
                  </span>
                </h2>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Aprendizaje autónomo diario & red colectiva global • {tenant.name}
              </p>
            </div>
          </div>

          {/* Métricas destacadas y botón forzar ciclo */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-stone-900 border border-stone-800">
              <Zap className="w-4 h-4 text-amber-400" />
              <div className="text-left">
                <span className="text-[10px] text-stone-400 block uppercase font-bold leading-tight">IQ Operativo</span>
                <span className="text-xs font-black text-white">{currentIQ} pts</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-stone-900 border border-stone-800">
              <TrendingUp className="w-4 h-4 text-[#a9b994]" />
              <div className="text-left">
                <span className="text-[10px] text-stone-400 block uppercase font-bold leading-tight">Racha de Aprendizaje</span>
                <span className="text-xs font-black text-white">{learningStreak} días</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-stone-900 border border-stone-800">
              <Globe2 className="w-4 h-4 text-cyan-400" />
              <div className="text-left">
                <span className="text-[10px] text-stone-400 block uppercase font-bold leading-tight">Flota Nacional</span>
                <span className="text-xs font-black text-white">{globalBenchmark.activeFleetNodes} restaurantes</span>
              </div>
            </div>

            <button
              onClick={handleForceDailyCycle}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#a9b994] text-stone-950 hover:bg-[#b8c9a3] active:scale-95 transition-all font-bold text-xs shadow-[0_0_20px_rgba(169,185,148,0.3)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Sintetizando...' : 'Ejecutar Ciclo Diario'}</span>
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
            <span className="text-[10px] text-stone-400 font-mono">Procesando telemetría viva...</span>
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
            <span>Heurísticas Vivas ({heuristics.length})</span>
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
            <span>Bitácora Diaria ({dailyCycles.length} Ciclos)</span>
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
            <span>Red Global SaborAI</span>
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
            <span>Enseñar a Nyza (Human-in-the-Loop)</span>
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
            <span>Auto-Optimización</span>
          </button>
        </nav>

        {/* ========================================================= */}
        {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA SELECCIONADA            */}
        {/* ========================================================= */}
        <div className="flex-1 overflow-y-auto p-6 bg-stone-950/70">
          
          {/* 1. HEURÍSTICAS VIVAS */}
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
                            <span className="text-[10px] font-mono text-stone-400">
                              Confianza: <strong className="text-white">{h.confidence}%</strong>
                            </span>
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

                      {/* Pie con origen y validación de flota */}
                      <div className="pt-3 border-t border-stone-800/80 flex items-center justify-between text-[10px] text-stone-400">
                        <div className="flex items-center gap-1.5">
                          <Globe2 className="w-3.5 h-3.5 text-[#a9b994]" />
                          <span>Validada en <strong>{h.globalValidationCount}</strong> restaurantes SaborAI</span>
                        </div>

                        <div className="flex items-center gap-1 text-stone-400">
                          <Activity className="w-3 h-3 text-cyan-400" />
                          <span>Aplicada {h.appliedCount} veces</span>
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
                    <h4 className="text-xs font-bold text-white">Ciclo de Síntesis Diario Automático</h4>
                    <p className="text-[11px] text-stone-400">
                      Nyza procesa cada noche las métricas de operación y sintetiza mejoras preventivas.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-black text-[#a9b994] uppercase tracking-wider">
                  99.98% Resiliencia
                </span>
              </div>

              <div className="relative pl-6 border-l-2 border-stone-800 space-y-6">
                {dailyCycles.map((cycle, index) => (
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

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                            IQ {cycle.systemIQ}
                          </span>
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            Sincronizado con Red Global
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-stone-200 leading-relaxed mb-4">
                        {cycle.summary}
                      </p>

                      {/* Métricas del ciclo */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-stone-800/80">
                        <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60 text-center">
                          <span className="text-[10px] text-stone-400 block">Fallos Evitados</span>
                          <strong className="text-xs text-white">{cycle.metrics.printerFailuresPrevented} de red</strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60 text-center">
                          <span className="text-[10px] text-stone-400 block">Demoras DGT Evitadas</span>
                          <strong className="text-xs text-white">{cycle.metrics.dgtDelaysAvoidedSec}s amortiguados</strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60 text-center">
                          <span className="text-[10px] text-stone-400 block">Tiempo en Cocina</span>
                          <strong className="text-xs text-white">+{cycle.metrics.kitchenTimeSavedMin}m optimizados</strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800/60 text-center">
                          <span className="text-[10px] text-stone-400 block">RAM Purgada</span>
                          <strong className="text-xs text-white">+{cycle.metrics.memoryFreedMB} MB liberados</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. RED DE INTELIGENCIA COLECTIVA GLOBAL */}
          {activeTab === 'global' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="p-6 rounded-3xl bg-gradient-to-br from-stone-900 to-stone-950 border border-stone-800 relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#a9b994] px-2.5 py-1 rounded-full bg-[#a9b994]/15 border border-[#a9b994]/30 inline-block mb-2">
                      Federated Knowledge Mesh • Costa Rica
                    </span>
                    <h3 className="text-lg font-black text-white">
                      Inteligencia Colectiva de la Flota SaborAI
                    </h3>
                    <p className="text-xs text-stone-400 mt-1 max-w-lg leading-relaxed">
                      Nyza comparte y recibe heurísticas anónimas con 148 restaurantes en Costa Rica.
                      Cuando otra sucursal supera un problema de red, impresora o Hacienda DGT, tu sistema se protege automáticamente.
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center p-4 rounded-2xl bg-stone-950 border border-stone-800">
                      <Globe2 className="w-6 h-6 text-cyan-400 mx-auto mb-1 animate-pulse" />
                      <span className="text-sm font-black text-white">{globalBenchmark.activeFleetNodes}</span>
                      <span className="text-[10px] text-stone-400 block">Nodos Activos</span>
                    </div>

                    <div className="text-center p-4 rounded-2xl bg-stone-950 border border-stone-800">
                      <ShieldCheck className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                      <span className="text-sm font-black text-white">{globalBenchmark.nationalDgtStatus}</span>
                      <span className="text-[10px] text-stone-400 block">Hacienda DGT</span>
                    </div>
                  </div>
                </div>

                {/* Macro Tendencias Nacionales */}
                <div className="mt-6 pt-6 border-t border-stone-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-stone-950/70 border border-stone-800">
                    <span className="text-[10px] text-stone-400 uppercase font-bold block mb-1">Picos de Consumo Nacional</span>
                    <p className="text-xs text-white font-medium">{globalBenchmark.peakHoursNational}</p>
                    <span className="text-[10px] text-stone-400 mt-1 block">Nyza pre-calienta memoria y colas de impresión antes de estas horas.</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-stone-950/70 border border-stone-800">
                    <span className="text-[10px] text-stone-400 uppercase font-bold block mb-1">Método de Pago Dominante</span>
                    <p className="text-xs text-white font-medium">SINPE Móvil & Tarjeta (89% de transacciones)</p>
                    <span className="text-[10px] text-stone-400 mt-1 block">Flujo de cobro acelerado con validación inmediata en 1 toque.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. ENSEÑAR A NYZA (HUMAN-IN-THE-LOOP) */}
          {activeTab === 'teach' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-[#a9b994]" />
                  <span>Entrenador de Memoria e Instrucciones Especiales</span>
                </h3>
                <p className="text-xs text-stone-400">
                  Enseña a Nyza particularidades de tu restaurante o equipo. Nyza las recordará de por vida y las incorporará en su razonamiento diario.
                </p>
              </div>

              {teachSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>¡Heurística aprendida! Nyza la ha guardado en su índice neural permanente (+2 IQ).</span>
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
                    <option value="HARDWARE_RESILIENCE">Resiliencia Hardware & Impresoras</option>
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

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">Nivel de Impacto:</span>
                    {(['MEDIUM', 'HIGH', 'CRITICAL'] as const).map(lvl => (
                      <button
                        type="button"
                        key={lvl}
                        onClick={() => setTeachImpact(lvl)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                          teachImpact === lvl
                            ? 'bg-amber-400 text-stone-950 font-black'
                            : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>

                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[#a9b994] text-stone-950 font-bold text-xs hover:bg-[#b8c9a3] active:scale-95 transition-all shadow-md cursor-pointer flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Enseñar a Nyza</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 5. AUTO-OPTIMIZACIÓN */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="p-4 rounded-2xl bg-stone-900 border border-stone-800 mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                  <Sliders className="w-4 h-4 text-[#a9b994]" />
                  <span>Ajustes del Motor de Auto-Optimización Autónoma</span>
                </h3>
                <p className="text-xs text-stone-400">
                  Controla qué acciones puede aplicar Nyza de forma autónoma sin interrumpir el servicio de venta.
                </p>
              </div>

              {[
                {
                  id: 'autoReroutePrinters',
                  title: 'Auto-Conmutación de Impresoras Caídas',
                  desc: 'Si una impresora térmica de cocina se satura o se queda sin papel, redirigir automáticamente los tickets a la impresora de respaldo.',
                  val: autoTuning.autoReroutePrinters
                },
                {
                  id: 'autoDgtContingencyBuffer',
                  title: 'Pre-Buffer Predictivo de Contingencia DGT',
                  desc: 'Si Hacienda DGT sobrepasa 3000ms de latencia, guardar facturas en cola local y procesarlas en micro-lotes sin trabar la terminal.',
                  val: autoTuning.autoDgtContingencyBuffer
                },
                {
                  id: 'autoScheduledVacuum',
                  title: 'Micro-Vacuum Silencioso y Purga de RAM',
                  desc: 'Compactar almacenamiento IndexedDB y liberar memoria en horas valle (3:30 PM) de forma transparente.',
                  val: autoTuning.autoScheduledVacuum
                },
                {
                  id: 'autoKdsSpeedAlerts',
                  title: 'Detección Predictiva de Cuellos de Botella KDS',
                  desc: 'Alertar a saloneros y administradores cuando un platillo supera el umbral de preparación en fines de semana.',
                  val: autoTuning.autoKdsSpeedAlerts
                },
                {
                  id: 'autoFederatedLearningSync',
                  title: 'Sincronización con Red Global SaborAI',
                  desc: 'Descargar heurísticas validadas a nivel nacional y compartir métricas anónimas para fortalecer la red.',
                  val: autoTuning.autoFederatedLearningSync
                }
              ].map(opt => (
                <div
                  key={opt.id}
                  className="p-4 rounded-2xl bg-stone-900/60 border border-stone-800 flex items-center justify-between gap-4"
                >
                  <div>
                    <h4 className="text-xs font-bold text-white mb-0.5">{opt.title}</h4>
                    <p className="text-[11px] text-stone-400 leading-relaxed">{opt.desc}</p>
                  </div>

                  <button
                    onClick={() => {
                      nyzaLearningService.updateAutoTuningSettings({
                        [opt.id]: !opt.val
                      });
                      setAutoTuning(nyzaLearningService.getAutoTuningSettings());
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      opt.val ? 'bg-[#a9b994]' : 'bg-stone-800'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-stone-950 shadow ring-0 transition duration-200 ease-in-out ${
                        opt.val ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* ========================================================= */}
        {/* PIE DE PÁGINA DEL MODAL                                  */}
        {/* ========================================================= */}
        <footer className="px-6 py-4 border-t border-stone-800/80 bg-stone-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <ShieldCheck className="w-4 h-4 text-[#a9b994]" />
            <span>Nyza IA • Aprendizaje seguro y confidencial. Datos del restaurante 100% aislados.</span>
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
