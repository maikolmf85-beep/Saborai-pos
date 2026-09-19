import React, { useState, useEffect } from 'react';
import { TenantInfo, UserProfile, MenuItem, TaxRegime } from '../types';
import { Sparkles, ArrowRight, CheckCircle2, Store, FileText, LayoutGrid, Users, UtensilsCrossed } from 'lucide-react';

interface NysaOnboardingProps {
  tenant: TenantInfo;
  currentUser: UserProfile;
  onComplete: (
    updatedTenant: TenantInfo, 
    newStaff: UserProfile[], 
    newMenu: MenuItem[]
  ) => void;
}

export const NysaOnboarding: React.FC<NysaOnboardingProps> = ({ tenant, currentUser, onComplete }) => {
  const [step, setStep] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Form states
  const [restaurantName, setRestaurantName] = useState(tenant.name || '');
  const [currency, setCurrency] = useState<'CRC' | 'USD'>(tenant.currency || 'CRC');
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(tenant.taxRegime || 'TRADITIONAL');
  
  const [zones, setZones] = useState<string[]>(['Principal', 'Terraza']);
  const [newZoneName, setNewZoneName] = useState('');
  
  const [staff, setStaff] = useState<Partial<UserProfile>[]>([
    { name: '', role: 'SALONERO', pin: '' }
  ]);
  
  const [menu, setMenu] = useState<Partial<MenuItem>[]>([
    { name: '', price: 0, category: 'Principal' }
  ]);

  const steps = [
    {
      title: 'Bienvenida',
      icon: <Sparkles className="w-6 h-6" />,
      message: `¡Hola ${currentUser.name}! Soy Nysa, tu Agente IA de Saborai. Estoy aquí para configurar tu punto de venta en menos de 3 minutos. ¿Empezamos?`,
    },
    {
      title: 'Información Básica',
      icon: <Store className="w-6 h-6" />,
      message: 'Primero lo primero. ¿Cómo se llama tu restaurante y qué moneda usarás principalmente?',
    },
    {
      title: 'Hacienda',
      icon: <FileText className="w-6 h-6" />,
      message: 'Saborai se encarga de tus facturas electrónicas. Solo dinos a qué régimen perteneces. (Podrás configurar el usuario y clave de ATV más tarde en Ajustes).',
    },
    {
      title: 'Salones',
      icon: <LayoutGrid className="w-6 h-6" />,
      message: '¿Qué áreas o salones tiene tu restaurante? Te he agregado un par por defecto, pero puedes personalizarlos.',
    },
    {
      title: 'Tu Equipo',
      icon: <Users className="w-6 h-6" />,
      message: 'Tú ya eres el Administrador principal. Vamos a crear a tu primer Salonero o Cajero para que puedan tomar pedidos.',
    },
    {
      title: 'Primer Platillo',
      icon: <UtensilsCrossed className="w-6 h-6" />,
      message: 'Vamos a subir tu primer platillo al menú para que veas lo fácil que es.',
    },
    {
      title: '¡Todo Listo!',
      icon: <CheckCircle2 className="w-6 h-6" />,
      message: '¡Excelente! Hemos configurado las bases. Ahora te llevaré al mapa de mesas donde podrás empezar a operar. Siempre estaré disponible en el botón de Saborai Copilot.',
    }
  ];

  // Typewriter effect
  useEffect(() => {
    setTypedText('');
    setIsTyping(true);
    let currentText = '';
    const targetText = steps[step].message;
    let i = 0;
    
    const interval = setInterval(() => {
      currentText += targetText.charAt(i);
      setTypedText(currentText);
      i++;
      if (i >= targetText.length) {
        setIsTyping(false);
        clearInterval(interval);
      }
    }, 25); // Speed of typing

    return () => clearInterval(interval);
  }, [step]);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    const updatedTenant: TenantInfo = {
      ...tenant,
      name: restaurantName,
      currency,
      taxRegime,
      zones: zones.length > 0 ? zones : ['Principal'],
      onboardingCompleted: true
    };

    const newStaff: UserProfile[] = staff
      .filter(s => s.name && s.pin)
      .map(s => ({
        id: `usr_${Date.now()}_${Math.random()}`,
        name: s.name!,
        email: '',
        phone: '',
        restaurantName,
        role: s.role as any,
        pin: s.pin,
        active: true
      }));

    const newMenu: MenuItem[] = menu
      .filter(m => m.name && m.price)
      .map(m => ({
        id: `item_${Date.now()}_${Math.random()}`,
        name: m.name!,
        description: '',
        price: m.price || 0,
        category: m.category || 'General',
        station: 'Cocina',
        cabysCode: '0000000000000',
        taxRate: 0.13,
        available: true,
        imageIcon: '🍽️',
        ingredients: []
      }));

    onComplete(updatedTenant, newStaff, newMenu);
  };

  const addZone = (e: React.FormEvent) => {
    e.preventDefault();
    if (newZoneName.trim() && !zones.includes(newZoneName.trim())) {
      setZones([...zones, newZoneName.trim()]);
      setNewZoneName('');
    }
  };

  const removeZone = (z: string) => {
    setZones(zones.filter(zone => zone !== z));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950 p-4 sm:p-8 animate-in fade-in duration-500">
      {/* Background glowing effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#588157]/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#a9b994]/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-4xl h-full max-h-[800px] flex flex-col md:flex-row bg-stone-900/60 backdrop-blur-xl border border-stone-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/50">
        
        {/* Left Panel: Nysa's Avatar & Message */}
        <div className="w-full md:w-5/12 p-8 lg:p-12 flex flex-col justify-between border-b md:border-b-0 md:border-r border-stone-800 relative overflow-hidden">
          {/* Subtle grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
          
          <div className="relative z-10 flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#588157] to-[#a9b994] flex items-center justify-center shadow-[0_0_20px_rgba(88,129,87,0.4)]">
                <Sparkles className="w-6 h-6 text-stone-950" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">Nysa AI</h2>
                <p className="text-xs text-[#a9b994] font-semibold tracking-wider uppercase">Onboarding Assistant</p>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                {steps[step].icon}
                {steps[step].title}
              </h3>
              <p className="text-lg text-stone-300 leading-relaxed min-h-[120px]">
                {typedText}
                {isTyping && <span className="inline-block w-2 h-5 ml-1 bg-[#a9b994] animate-pulse" />}
              </p>
            </div>
          </div>

          <div className="relative z-10 mt-8">
            <div className="flex gap-2 mb-4">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full flex-1 transition-all duration-500 ${
                    i < step ? 'bg-[#588157]' : i === step ? 'bg-[#a9b994] shadow-[0_0_10px_rgba(169,185,148,0.5)]' : 'bg-stone-800'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider">
              Paso {step + 1} de {steps.length}
            </p>
          </div>
        </div>

        {/* Right Panel: Interactive Forms */}
        <div className="w-full md:w-7/12 p-8 lg:p-12 flex flex-col justify-between bg-stone-950/40 relative">
          
          <div className="flex-1 flex flex-col justify-center animate-in slide-in-from-right-4 fade-in duration-500 key={step}">
            
            {step === 0 && (
              <div className="text-center space-y-6">
                <div className="w-24 h-24 mx-auto rounded-3xl bg-stone-800/50 border border-stone-700 flex items-center justify-center shadow-inner">
                  <span className="text-4xl">👋</span>
                </div>
                <h3 className="text-3xl font-black text-white">¡Bienvenido a Saborai!</h3>
                <p className="text-stone-400 text-lg">El primer POS con Inteligencia Artificial diseñado para la gastronomía de Costa Rica.</p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6 max-w-sm mx-auto w-full">
                <div>
                  <label className="block text-sm font-semibold text-stone-400 mb-2">Nombre de tu Restaurante</label>
                  <input
                    type="text"
                    value={restaurantName}
                    onChange={e => setRestaurantName(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-900 border border-stone-700 rounded-xl text-white focus:outline-none focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    placeholder="Ej. Saborai Café"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-stone-400 mb-2">Moneda Principal</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setCurrency('CRC')}
                      className={`py-3 rounded-xl border font-bold transition-all ${
                        currency === 'CRC' 
                          ? 'bg-[#588157]/20 border-[#588157] text-[#a9b994]' 
                          : 'bg-stone-900 border-stone-700 text-stone-400 hover:bg-stone-800'
                      }`}
                    >
                      Colones (₡)
                    </button>
                    <button
                      onClick={() => setCurrency('USD')}
                      className={`py-3 rounded-xl border font-bold transition-all ${
                        currency === 'USD' 
                          ? 'bg-[#588157]/20 border-[#588157] text-[#a9b994]' 
                          : 'bg-stone-900 border-stone-700 text-stone-400 hover:bg-stone-800'
                      }`}
                    >
                      Dólares ($)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6 max-w-sm mx-auto w-full">
                <div>
                  <label className="block text-sm font-semibold text-stone-400 mb-2">Régimen Tributario</label>
                  <div className="grid grid-cols-1 gap-3">
                    <button
                      onClick={() => setTaxRegime('TRADITIONAL')}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        taxRegime === 'TRADITIONAL' 
                          ? 'bg-[#588157]/20 border-[#588157]' 
                          : 'bg-stone-900 border-stone-700 hover:bg-stone-800'
                      }`}
                    >
                      <div className={`font-bold ${taxRegime === 'TRADITIONAL' ? 'text-[#a9b994]' : 'text-stone-300'}`}>Régimen General</div>
                      <div className="text-xs text-stone-500 mt-1">Cobro el IVA del 13% (o tarifas reducidas) y facturo electrónicamente todos los días.</div>
                    </button>
                    <button
                      onClick={() => setTaxRegime('SIMPLIFIED')}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        taxRegime === 'SIMPLIFIED' 
                          ? 'bg-[#588157]/20 border-[#588157]' 
                          : 'bg-stone-900 border-stone-700 hover:bg-stone-800'
                      }`}
                    >
                      <div className={`font-bold ${taxRegime === 'SIMPLIFIED' ? 'text-[#a9b994]' : 'text-stone-300'}`}>Régimen Simplificado</div>
                      <div className="text-xs text-stone-500 mt-1">No cobro IVA. Saborai ocultará los impuestos de las facturas automáticamente.</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6 max-w-md mx-auto w-full">
                <form onSubmit={addZone} className="flex gap-2">
                  <input
                    type="text"
                    value={newZoneName}
                    onChange={e => setNewZoneName(e.target.value)}
                    placeholder="Nuevo Salón (Ej. Barra)"
                    className="flex-1 px-4 py-3 bg-stone-900 border border-stone-700 rounded-xl text-white focus:outline-none focus:border-[#a9b994] transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!newZoneName.trim()}
                    className="px-6 py-3 bg-stone-800 text-white font-bold rounded-xl hover:bg-stone-700 disabled:opacity-50 transition-all"
                  >
                    Añadir
                  </button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {zones.map(zone => (
                    <div key={zone} className="flex items-center gap-2 px-3 py-1.5 bg-[#588157]/20 border border-[#588157]/40 rounded-lg text-[#a9b994] text-sm font-semibold">
                      <span>{zone}</span>
                      <button onClick={() => removeZone(zone)} className="text-[#a9b994]/60 hover:text-red-400 transition-colors">
                        &times;
                      </button>
                    </div>
                  ))}
                  {zones.length === 0 && (
                    <p className="text-stone-500 text-sm italic">No tienes salones. Añade al menos uno.</p>
                  )}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6 max-w-sm mx-auto w-full">
                {staff.map((s, index) => (
                  <div key={index} className="p-4 bg-stone-900 border border-stone-700 rounded-xl space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-400 mb-1">Nombre</label>
                      <input
                        type="text"
                        value={s.name}
                        onChange={e => {
                          const newStaff = [...staff];
                          newStaff[index].name = e.target.value;
                          setStaff(newStaff);
                        }}
                        className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none focus:border-[#a9b994] text-sm"
                        placeholder="Ej. Carlos"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-400 mb-1">Rol</label>
                        <select
                          value={s.role}
                          onChange={e => {
                            const newStaff = [...staff];
                            newStaff[index].role = e.target.value as any;
                            setStaff(newStaff);
                          }}
                          className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none text-sm"
                        >
                          <option value="SALONERO">Salonero</option>
                          <option value="CAJERO">Cajero</option>
                          <option value="SALONERO_CAJA">Salón y Caja</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-400 mb-1">PIN (4 dígitos)</label>
                        <input
                          type="password"
                          maxLength={4}
                          value={s.pin}
                          onChange={e => {
                            const val = e.target.value.replace(/\D/g, '');
                            const newStaff = [...staff];
                            newStaff[index].pin = val;
                            setStaff(newStaff);
                          }}
                          className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none focus:border-[#a9b994] text-sm text-center tracking-widest font-mono"
                          placeholder="••••"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-6 max-w-sm mx-auto w-full">
                {menu.map((m, index) => (
                  <div key={index} className="p-4 bg-stone-900 border border-stone-700 rounded-xl space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-400 mb-1">Nombre del Platillo</label>
                      <input
                        type="text"
                        value={m.name}
                        onChange={e => {
                          const newMenu = [...menu];
                          newMenu[index].name = e.target.value;
                          setMenu(newMenu);
                        }}
                        className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none focus:border-[#a9b994] text-sm"
                        placeholder="Ej. Hamburguesa Clásica"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-stone-400 mb-1">Categoría</label>
                        <input
                          type="text"
                          value={m.category}
                          onChange={e => {
                            const newMenu = [...menu];
                            newMenu[index].category = e.target.value;
                            setMenu(newMenu);
                          }}
                          className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none focus:border-[#a9b994] text-sm"
                          placeholder="Ej. Principales"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-400 mb-1">Precio ({currency === 'CRC' ? '₡' : '$'})</label>
                        <input
                          type="number"
                          value={m.price || ''}
                          onChange={e => {
                            const newMenu = [...menu];
                            newMenu[index].price = parseFloat(e.target.value);
                            setMenu(newMenu);
                          }}
                          className="w-full px-3 py-2 bg-stone-950 border border-stone-800 rounded-lg text-white focus:outline-none focus:border-[#a9b994] text-sm font-mono"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 6 && (
              <div className="text-center space-y-6">
                <div className="w-24 h-24 mx-auto rounded-full bg-[#588157]/20 border border-[#588157] flex items-center justify-center shadow-[0_0_30px_rgba(88,129,87,0.3)]">
                  <Sparkles className="w-10 h-10 text-[#a9b994]" />
                </div>
                <h3 className="text-3xl font-black text-white">¡Configuración Exitosa!</h3>
                <p className="text-stone-400 text-lg">He guardado todas tus preferencias de forma segura. Ahora estás listo para revolucionar tu operación con Saborai.</p>
              </div>
            )}

          </div>

          <div className="flex justify-end pt-6 border-t border-stone-800/50 mt-8">
            <button
              onClick={handleNext}
              disabled={isTyping && step !== 0 && step !== steps.length - 1}
              className="group px-8 py-3.5 rounded-xl bg-white text-stone-950 font-black flex items-center gap-2 hover:bg-[#a9b994] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            >
              <span>{step === steps.length - 1 ? 'Ir al Sistema' : 'Siguiente Paso'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
