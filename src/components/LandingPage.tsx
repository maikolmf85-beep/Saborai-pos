import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  Sparkles, 
  CheckCircle2, 
  ArrowRight, 
  CreditCard, 
  ShieldCheck, 
  Zap, 
  Utensils, 
  FileCode2, 
  Printer, 
  Laptop, 
  ChevronRight,
  TrendingUp,
  Cpu,
  Store
} from 'lucide-react';
import { SubscriptionPlan } from '../types';
import { tilopayService } from '../services/tilopayService';

interface LandingPageProps {
  onStartDemo: (plan: SubscriptionPlan) => void;
  onEnterPOS: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStartDemo, onEnterPOS }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<'CRC' | 'USD'>('CRC');
  const [selectedPlanModal, setSelectedPlanModal] = useState<SubscriptionPlan | null>(null);
  const [showSuccessOnboarding, setShowSuccessOnboarding] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  const plans = [
    {
      id: 'express' as SubscriptionPlan,
      name: 'Plan Express / Básico',
      badge: 'Para Cafés y Food Trucks',
      priceCRC: '₡22,000',
      priceUSD: '$42',
      period: '/ mes',
      features: [
        'Hasta 2 dispositivos simultáneos',
        'Toma de pedidos y mapa de mesas básico',
        'Facturación Electrónica Hacienda v4.3',
        'Impresión térmica USB y Bluetooth',
        'Soporte estándar vía WhatsApp',
      ],
      popular: false,
      buttonText: 'Elegir Plan Express'
    },
    {
      id: 'pro' as SubscriptionPlan,
      name: 'Plan Pro Restaurante',
      badge: 'El Más Elegido en Costa Rica',
      priceCRC: '₡45,000',
      priceUSD: '$86',
      period: '/ mes',
      features: [
        'Dispositivos ilimitados (Móviles, Tablets, PC)',
        'Saborai Copilot IA (Cross-selling + Asistente)',
        'Control de Recetas y Escandallos automáticos',
        'Subcuentas y división de cuentas en mesa',
        'Pantallas KDS para Cocina y Bar con alertas',
        'Matriz de impresión en red IP + Spooler',
        'Sincronización Offline en Red Local (Mesh)',
      ],
      popular: true,
      buttonText: 'Probar 14 Días Gratis'
    },
    {
      id: 'multibranch' as SubscriptionPlan,
      name: 'Plan Multi-Sucursal',
      badge: 'Para Cadenas y Franquicias',
      priceCRC: '₡85,000',
      priceUSD: '$162',
      period: '/ mes por sucursal',
      features: [
        'Todo lo incluido en el Plan Pro',
        'Gestión centralizada de menú y precios',
        'Consolidación financiera y stock entre locales',
        'Multi-caja y conciliación bancaria Tilopay',
        'Soporte prioritario 24/7 y Onboarding VIP',
      ],
      popular: false,
      buttonText: 'Contratar Multi-Sucursal'
    }
  ];
  
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpMonth, setCardExpMonth] = useState('');
  const [cardExpYear, setCardExpYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');

  const [checkoutStatus, setCheckoutStatus] = useState<'IDLE' | 'TOKENIZING' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleSimulateTilopayCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanModal) return;

    setCheckoutStatus('TOKENIZING');
    setCheckoutError(null);

    try {
      const token = await tilopayService.tokenizeCard({
        cardNumber,
        expMonth: cardExpMonth,
        expYear: cardExpYear,
        cvv: cardCvv,
        cardholderName: cardName
      });

      setCheckoutStatus('PROCESSING');
      
      const response = await tilopayService.createSubscription(selectedPlanModal, token, ownerEmail);

      if (response.success) {
        setCheckoutStatus('SUCCESS');
        setTimeout(() => {
          onStartDemo(selectedPlanModal as SubscriptionPlan);
          setShowSuccessOnboarding(true);
        }, 1500);
      } else {
        setCheckoutStatus('ERROR');
        setCheckoutError(response.error || 'Error al procesar la suscripción.');
      }
    } catch (err: any) {
      setCheckoutStatus('ERROR');
      setCheckoutError(err.message || 'Error durante la tokenización de la tarjeta.');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfeff] text-[#3b3733]">
      
      {/* Top Banner Notice */}
      <div className="bg-gradient-to-r from-[#3b3733] to-[#4b4742] text-[#fcfeff] py-2 px-4 text-center text-xs font-medium flex items-center justify-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[#a9b994] animate-pulse" />
        <span>¡Lanzamiento en Costa Rica! 14 días de prueba sin tarjeta de crédito. Pagos recurrentes seguros con Tilopay.</span>
      </div>

      {/* Main Hero Header */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28 border-b border-[#6b686d]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            
            {/* Header Brand Logo (Variant: Isologotipo Horizontal Completo) */}
            <div className="mb-6 p-2.5 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/40 shadow-sm inline-flex">
              <BrandLogo variant="full" size="lg" />
            </div>

            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#a9b994]/20 border border-[#a9b994]/40 text-[#3b3733] text-xs font-semibold mb-6">
              <Sparkles className="w-3.5 h-3.5 text-[#3b3733]" />
              <span>Primer POS Gastronómico en Costa Rica con Inteligencia Artificial Nativa</span>
            </div>

            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-[#3b3733] leading-[1.1] mb-6">
              La gastronomía del futuro, <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3b3733] via-[#6b686d] to-[#a9b994]">
                automatizada y sin fricción.
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-[#6b686d] font-normal leading-relaxed mb-10 max-w-3xl">
              Centraliza mesas, comandas KDS, inventario basado en recetas y facturación electrónica de Hacienda Costa Rica v4.3 en una plataforma SaaS hermosa, ultra rápida y Offline-First.
            </p>

            {/* Main Action CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <button
                onClick={() => setSelectedPlanModal('pro')}
                className="w-full sm:w-auto px-8 py-4 bg-[#3b3733] text-[#fcfeff] rounded-2xl font-bold text-base hover:bg-[#2e2a27] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shadow-xl shadow-[#3b3733]/20 flex items-center justify-center gap-2.5 group"
              >
                <span>Comenzar Prueba Gratis (14 Días)</span>
                <ArrowRight className="w-4 h-4 text-[#a9b994] group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={onEnterPOS}
                className="w-full sm:w-auto px-8 py-4 bg-[#fcfeff] text-[#3b3733] border-2 border-[#3b3733] rounded-2xl font-bold text-base hover:bg-[#a9b994]/15 hover:border-[#a9b994] transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Store className="w-4 h-4 text-[#3b3733]" />
                <span>Entrar al POS en Vivo</span>
              </button>
            </div>

            {/* Trust Badges */}
            <div className="mt-12 pt-8 border-t border-[#6b686d]/15 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-[#6b686d] font-medium">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>Pagos Recurrentes Tilopay CR</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>Hacienda Costa Rica v4.3</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>Sincronización Offline Local</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>Impresoras 58mm y 80mm</span>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* Core AI Disruptive Feature Grid */}
      <section className="py-20 bg-[#fcfeff] border-b border-[#6b686d]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#a9b994] mb-3">Módulos de Nueva Generación</h2>
            <p className="text-3xl sm:text-4xl font-black text-[#3b3733] tracking-tight">
              Diseñado exclusivamente para el ritmo frenético de los restaurantes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <Sparkles className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Saborai Copilot IA</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                Asistente inteligente con Function Calling para sugerir maridajes, auditar códigos CABYS y predecir quiebres de inventario antes de que ocurran.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <Zap className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Sincronización Local Mesh</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                ¿Se cayó el internet del restaurante? La red local sigue comunicando saloneros, bar y cocina al instante gracias a IndexedDB y WebSockets locales.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <FileCode2 className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Hacienda CR v4.3 Automática</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                Emisión de XML, clave de 50 dígitos, control de IVA diferenciado (13%, 4%, 2%, 1%, Exento) y 10% de servicio en mesa con un solo toque.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <Printer className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Enrutador Térmico Inteligente</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                Conexión multicanal (IP/Ethernet, Bluetooth, USB). Separa automáticamente platos a cocina e ingredientes líquidos a la comandera del bar.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <Utensils className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Recetas & Escandallos Vivos</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                Cada venta descuenta gramos exactos de carne, ml de licor y unidades de insumo. Control estricto de mermas y costos operativos en tiempo real.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/10 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/25 flex items-center justify-center text-[#3b3733] mb-6 group-hover:bg-[#a9b994] transition-colors">
                <CreditCard className="w-6 h-6 text-[#3b3733]" />
              </div>
              <h3 className="text-xl font-bold text-[#3b3733] mb-3">Subcuentas & Pagos Tilopay</h3>
              <p className="text-sm text-[#6b686d] leading-relaxed">
                División flexible por persona o ítem en mesa. Cobro tokenizado con tarjetas y suscripciones automáticas sin retrasos.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* Pricing Section (Tilopay Costa Rica Plans) */}
      <section className="py-24 bg-[#fcfeff]" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#a9b994]/25 text-[#3b3733] text-xs font-bold uppercase tracking-wider mb-4">
              Tarifas Transparentes en Costa Rica
            </div>
            <h2 className="text-3xl sm:text-5xl font-black text-[#3b3733] tracking-tight mb-6">
              Elige el plan ideal para tu restaurante
            </h2>
            <p className="text-[#6b686d] text-base">
              Todos los planes incluyen actualizaciones continuas, soporte técnico y facturación de Hacienda Costa Rica.
            </p>

            {/* Currency Selector */}
            <div className="inline-flex items-center p-1 bg-[#fcfeff] border border-[#6b686d]/25 rounded-2xl mt-8 shadow-sm">
              <button
                onClick={() => setSelectedCurrency('CRC')}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                  selectedCurrency === 'CRC'
                    ? 'bg-[#3b3733] text-[#fcfeff] shadow'
                    : 'text-[#6b686d] hover:text-[#3b3733]'
                }`}
              >
                Colones (₡ CRC)
              </button>
              <button
                onClick={() => setSelectedCurrency('USD')}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                  selectedCurrency === 'USD'
                    ? 'bg-[#3b3733] text-[#fcfeff] shadow'
                    : 'text-[#6b686d] hover:text-[#3b3733]'
                }`}
              >
                Dólares ($ USD)
              </button>
            </div>

          </div>

          {/* Pricing Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative flex flex-col p-8 sm:p-10 rounded-3xl transition-all duration-300 ${
                  plan.popular
                    ? 'bg-[#fcfeff] border-2 border-[#3b3733] shadow-2xl shadow-[#3b3733]/15 scale-[1.03]'
                    : 'bg-[#fcfeff] border border-[#6b686d]/20 hover:border-[#a9b994]'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[#3b3733] text-[#fcfeff] text-xs font-bold tracking-wide uppercase shadow-md flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#a9b994]" />
                    <span>{plan.badge}</span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-[#3b3733] mb-2">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mt-4">
                    <span className="text-4xl sm:text-5xl font-black text-[#3b3733] tracking-tight">
                      {selectedCurrency === 'CRC' ? plan.priceCRC : plan.priceUSD}
                    </span>
                    <span className="text-xs text-[#6b686d] font-semibold">{plan.period}</span>
                  </div>
                </div>

                <div className="space-y-3.5 flex-1 mb-8">
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm text-[#3b3733]">
                      <CheckCircle2 className="w-4 h-4 text-[#a9b994] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setSelectedPlanModal(plan.id)}
                  className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 ${
                    plan.popular
                      ? 'bg-[#3b3733] text-[#fcfeff] hover:bg-[#282522] shadow-lg shadow-[#3b3733]/25'
                      : 'bg-[#a9b994]/25 text-[#3b3733] hover:bg-[#a9b994] border border-[#a9b994]/50'
                  }`}
                >
                  {plan.buttonText}
                </button>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Tilopay Checkout Modal Simulation */}
      {selectedPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3b3733]/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#fcfeff] border border-[#6b686d]/20 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
            
            <button
              onClick={() => setSelectedPlanModal(null)}
              className="absolute top-5 right-5 text-[#6b686d] hover:text-[#3b3733] text-lg font-bold"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-[#a9b994]/30">
                <CreditCard className="w-6 h-6 text-[#3b3733]" />
              </div>
              <div>
                <h3 className="text-xl font-black text-[#3b3733]">Checkout Seguro Tilopay</h3>
                <p className="text-xs text-[#6b686d]">Suscripción tokenizada en Costa Rica</p>
              </div>
            </div>

            {showSuccessOnboarding ? (
              <div className="py-12 text-center space-y-4">
                <div className="w-16 h-16 bg-[#a9b994]/30 text-[#3b3733] rounded-full flex items-center justify-center mx-auto animate-bounce">
                  <CheckCircle2 className="w-10 h-10 text-[#3b3733]" />
                </div>
                <h4 className="text-2xl font-black text-[#3b3733]">¡Suscripción Activada!</h4>
                <p className="text-xs text-[#6b686d] max-w-sm mx-auto">
                  Webhook `transaction.success` verificado. Redirigiendo a tu nuevo Punto de Venta Saborai...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSimulateTilopayCheckout} className="space-y-4">
                
                {checkoutError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium">
                    ⚠️ {checkoutError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Nombre del Restaurante</label>
                    <input
                      type="text"
                      required
                      disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                      placeholder="Ej. Café & Bistro Escalante"
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                      placeholder="gerencia@escalante.cr"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div className="col-span-2 pt-4 border-t border-[#6b686d]/10">
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5 flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Número de Tarjeta (Tilopay)
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={19}
                      disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                      placeholder="4000 1234 5678 9010"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Expira (MM/YY)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        maxLength={2}
                        placeholder="MM"
                        disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                        value={cardExpMonth}
                        onChange={(e) => setCardExpMonth(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] text-center bg-[#fcfeff]"
                      />
                      <span className="text-[#6b686d] font-bold">/</span>
                      <input
                        type="text"
                        required
                        maxLength={2}
                        placeholder="YY"
                        disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                        value={cardExpYear}
                        onChange={(e) => setCardExpYear(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] text-center bg-[#fcfeff]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">CVC/CVV</label>
                    <input
                      type="password"
                      required
                      maxLength={4}
                      placeholder="***"
                      disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Nombre en Tarjeta</label>
                    <input
                      type="text"
                      required
                      placeholder="Como aparece en la tarjeta"
                      disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/40 text-xs text-[#3b3733] flex items-center justify-between mt-4">
                  <div>
                    <span className="font-bold block">Plan Seleccionado:</span>
                    <span className="text-[#6b686d]">{selectedPlanModal.toUpperCase()}</span>
                  </div>
                  <span className="text-sm font-black text-[#3b3733] text-right">
                    {selectedPlanModal === 'express' ? '₡22,000/mes' : selectedPlanModal === 'pro' ? (
                      <>
                        <span className="block text-[#a9b994]">14 Días Gratis</span>
                        <span className="text-xs text-[#6b686d]">Luego ₡45,000/mes</span>
                      </>
                    ) : '₡85,000/mes'}
                  </span>
                </div>

                <div className="p-3 rounded-xl border border-dashed border-[#6b686d]/40 text-xs text-[#6b686d] flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-[#a9b994] shrink-0" />
                  <span>
                    Ambiente Seguro Tilopay 2.0. 
                    {selectedPlanModal === 'pro' && (
                      <strong className="text-[#3b3733] block mt-1">
                        Se requiere tarjeta para activar la prueba. No se realizarán cargos hoy.
                      </strong>
                    )}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                  className="w-full py-4 bg-[#3b3733] text-[#fcfeff] rounded-xl font-bold text-sm hover:bg-[#2a2623] transition-colors flex items-center justify-center gap-2 disabled:opacity-70 mt-4"
                >
                  {checkoutStatus === 'TOKENIZING' && <span className="animate-pulse">Tokenizando Tarjeta en Tilopay...</span>}
                  {checkoutStatus === 'PROCESSING' && <span className="animate-pulse">Creando Suscripción...</span>}
                  {checkoutStatus === 'SUCCESS' && <span>¡Suscripción Aprobada! ✓</span>}
                  {(checkoutStatus === 'IDLE' || checkoutStatus === 'ERROR') && (
                    <>
                      <CreditCard className="w-4 h-4 text-[#a9b994]" />
                      <span>Suscribirme de Forma Segura</span>
                    </>
                  )}
                </button>
              </form>
            )}

          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-12 bg-[#fcfeff] border-t border-[#6b686d]/15 text-center text-xs text-[#6b686d]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <BrandLogo variant="full" size="sm" />
          <p>© 2026 Saborai POS Costa Rica. Todos los derechos reservados. Cumplimiento Ministerio de Hacienda v4.3.</p>
        </div>
      </footer>

    </div>
  );
};
