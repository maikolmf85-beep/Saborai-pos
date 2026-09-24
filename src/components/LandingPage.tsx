import React, { useState, useEffect } from 'react';
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
  const [checkoutStatus, setCheckoutStatus] = useState<'IDLE' | 'TOKENIZING' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  
  const [checkoutStep, setCheckoutStep] = useState<'REGISTRATION' | 'PAYMENT'>('REGISTRATION');
  const [ownerEmailConfirm, setOwnerEmailConfirm] = useState('');

  const handleContinueToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (ownerEmail !== ownerEmailConfirm) {
      setCheckoutError('Los correos electrónicos no coinciden.');
      return;
    }
    setCheckoutError(null);
    setCheckoutStep('PAYMENT');
  };

  /* ── TiloPay Return Interceptor ──── */
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('tilopay_success') === 'true') {
      const email = searchParams.get('email');
      const plan = searchParams.get('planId') as SubscriptionPlan || 'pro';
      const token = searchParams.get('token') || searchParams.get('id');

      if (email) {
        setSelectedPlanModal(plan);
        setCheckoutStep('PAYMENT');
        setCheckoutStatus('PROCESSING');
        
        const registerSub = async () => {
          try {
            if (token) {
              await tilopayService.createSubscription(plan, token, email);
            }
            // Clear URL
            window.history.replaceState({}, document.title, window.location.pathname);
            setCheckoutStatus('SUCCESS');
            setShowSuccessOnboarding(true);
            setTimeout(() => {
              onStartDemo(plan);
            }, 2500);
          } catch (err: any) {
            setCheckoutStatus('ERROR');
            setCheckoutError(err.message || 'Error finalizando la suscripción con TiloPay.');
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        };

        registerSub();
      }
    }
  }, []);

  const handleSimulateTilopayCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanModal) return;

    setCheckoutStatus('TOKENIZING');
    setCheckoutError(null);

    try {
      // Usamos el nombre del restaurante como firstName provisional para TiloPay
      const url = await tilopayService.getPaymentUrl({
        email: ownerEmail,
        firstName: restaurantName || 'Saborai',
        lastName: 'Cliente',
        planId: selectedPlanModal,
        redirect: window.location.origin + `?tilopay_success=true&planId=${selectedPlanModal}&email=${encodeURIComponent(ownerEmail)}`
      });

      // Redirigir al cliente a la bóveda segura de TiloPay
      window.location.href = url;

    } catch (err: any) {
      setCheckoutStatus('ERROR');
      setCheckoutError(err.message || 'Error al conectar con TiloPay.');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfeff] text-[#3b3733]">
      
      {/* ── Top announcement bar ─────────────────────────────── */}
      <header role="banner">
        <div className="bg-gradient-to-r from-[#1e2018] to-[#3b3733] text-[#fcfeff] py-2 px-4 text-center text-xs font-medium flex items-center justify-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[#a9b994] animate-pulse" aria-hidden="true" />
          <span><strong className="text-[#a9b994]">Saborai POS</strong> — El primer punto de venta en Costa Rica con Inteligencia Artificial nativa integrada. Prueba gratis 14 días.</span>
        </div>

        {/* ── Navigation ─────────────────────────────────────── */}
        <nav aria-label="Navegación principal" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <a href="#" aria-label="Saborai POS — Ir al inicio">
            <BrandLogo variant="full" size="sm" />
          </a>
          <div className="hidden sm:flex items-center gap-6 text-sm font-medium text-[#6b686d]">
            <a href="#features" className="hover:text-[#3b3733] transition-colors">Funciones</a>
            <a href="#pricing" className="hover:text-[#3b3733] transition-colors">Precios</a>
            <a href="#faq" className="hover:text-[#3b3733] transition-colors">FAQ</a>
          </div>
          <button
            onClick={onEnterPOS}
            aria-label="Comenzar prueba gratuita de 14 días"
            className="px-5 py-2.5 bg-[#3b3733] text-[#fcfeff] rounded-xl font-bold text-sm hover:bg-[#2e2a27] transition-colors"
          >
            Prueba Gratis
          </button>
        </nav>
      </header>

      <main id="main-content">

      {/* ── Main Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28 border-b border-[#6b686d]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            
            {/* Header Brand Logo (Variant: Isologotipo Horizontal Completo) */}
            <div className="mb-6 p-2.5 rounded-2xl bg-[#a9b994]/15 border border-[#a9b994]/40 shadow-sm inline-flex">
              <BrandLogo variant="full" size="lg" />
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#a9b994]/30 to-[#a9b994]/10 border border-[#a9b994]/60 text-[#3b3733] text-xs font-bold mb-6 shadow-sm">
              <Cpu className="w-3.5 h-3.5 text-[#3b3733]" />
              <span className="uppercase tracking-wider">El primer POS gastronómico con IA nativa en Costa Rica</span>
            </div>

            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-[#3b3733] leading-[1.1] mb-6">
              El único POS que<br className="hidden sm:inline" />{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3b3733] via-[#588157] to-[#a9b994]">
                piensa junto a ti.
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-[#6b686d] font-normal leading-relaxed mb-10 max-w-3xl">
              Saborai Copilot es la primera IA nativa integrada en un POS de Costa Rica. Predice quiebres de inventario, sugiere maridajes en tiempo real y audita tus facturas de Hacienda v4.3 automáticamente. Todo mientras tu equipo trabaja.
            </p>

            {/* Main Action CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <button
                onClick={onEnterPOS}
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
                <span>Probar Demo del POS</span>
              </button>
            </div>

            {/* Trust Badges */}
            <div className="mt-12 pt-8 border-t border-[#6b686d]/15 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-[#6b686d] font-medium">
              <div className="flex items-center gap-2 text-[#3b3733] font-bold">
                <Cpu className="w-4 h-4 text-[#588157]" />
                <span>IA Nativa Integrada</span>
              </div>
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

      {/* ── AI Showcase Section ───────────────────────────────── */}
      <section aria-labelledby="ai-heading" id="ai" className="py-24 bg-gradient-to-br from-[#1e2018] via-[#2a2e22] to-[#3b3733] text-[#fcfeff] overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-96 h-96 bg-[#a9b994]/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-[#a9b994]/5 rounded-full blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            {/* Left: Messaging */}
            <div className="flex-1 max-w-xl">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#a9b994]/20 border border-[#a9b994]/40 text-[#a9b994] text-xs font-bold uppercase tracking-wider mb-6">
                <Cpu className="w-3.5 h-3.5" />
                <span>Saborai Copilot IA — Exclusivo</span>
              </div>
              <h2 id="ai-heading" className="text-3xl sm:text-5xl font-black tracking-tight mb-6 leading-tight">
                La primera IA que vive <span className="text-[#a9b994]">dentro</span> de tu POS.
              </h2>
              <p className="text-[#fcfeff]/70 text-base leading-relaxed mb-8">
                Otros sistemas conectan un chatbot externo. Saborai Copilot es diferente: la IA está integrada en el núcleo del sistema, con acceso directo a tus comandas, inventario, ventas y recetas en tiempo real.
              </p>
              <div className="space-y-4">
                {[
                  { icon: '🧠', title: 'Predicción de quiebres de stock', desc: 'Antes de que se acabe el producto, el Copilot alerta al encargado con días de anticipación.' },
                  { icon: '🍷', title: 'Sugerencias de maridaje en mesa', desc: 'El salonero recibe recomendaciones de vinos y cócteles en tiempo real según el pedido.' },
                  { icon: '📋', title: 'Auditoría de códigos CABYS', desc: 'Detecta y sugiere correcciones de códigos CABYS para cumplir con Hacienda v4.3 sin errores.' },
                  { icon: '📊', title: 'Análisis de rentabilidad por plato', desc: 'Identifica qué platos tienen mejor margen y cuáles están generando pérdidas ocultas.' },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3.5">
                    <span className="text-xl mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
                    <div>
                      <p className="font-bold text-[#fcfeff] text-sm">{title}</p>
                      <p className="text-[#fcfeff]/55 text-xs leading-relaxed mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={onEnterPOS}
                aria-label="Probar Saborai Copilot IA gratis"
                className="mt-10 inline-flex items-center gap-2.5 px-7 py-3.5 bg-[#a9b994] text-[#1e2018] rounded-2xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all shadow-lg shadow-[#a9b994]/20"
              >
                <Sparkles className="w-4 h-4" />
                <span>Probar el Copilot IA Gratis</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            {/* Right: Visual demo card */}
            <div className="flex-1 max-w-sm w-full">
              <div className="bg-[#fcfeff]/5 border border-[#a9b994]/20 rounded-3xl p-6 backdrop-blur-sm">
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="w-8 h-8 rounded-xl bg-[#a9b994]/20 border border-[#a9b994]/30 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-[#a9b994]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#fcfeff]">Saborai Copilot</p>
                    <p className="text-[10px] text-[#fcfeff]/40">IA nativa activa</p>
                  </div>
                  <div className="ml-auto w-2 h-2 rounded-full bg-[#a9b994] animate-pulse" />
                </div>
                <div className="space-y-3">
                  {[
                    { role: 'sys', msg: '⚠️ El lomo de res estará agotado en ~2 días según el ritmo de ventas.' },
                    { role: 'user', msg: 'Mesa 7 pidió el ribeye. ¿Qué vino le recomiendo?' },
                    { role: 'sys', msg: '🍷 Sugiere el Malbec Reserva o el Carménère. Ambos están en inventario y maridán perfectamente con cortes rojos.' },
                    { role: 'user', msg: 'Revisar el código CABYS del tiramisu' },
                    { role: 'sys', msg: '✅ Código correcto: 2129090000. IVA aplicable: 13%. Sin observaciones.' },
                  ].map((m, i) => (
                    <div key={i} className={`text-xs px-3.5 py-2.5 rounded-xl leading-relaxed ${
                      m.role === 'sys'
                        ? 'bg-[#a9b994]/15 border border-[#a9b994]/25 text-[#fcfeff]/80'
                        : 'bg-[#fcfeff]/8 border border-[#fcfeff]/10 text-[#fcfeff]/50 text-right'
                    }`}>{m.msg}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section aria-labelledby="features-heading" id="features" className="py-20 bg-[#fcfeff] border-b border-[#6b686d]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-[#a9b994] mb-3">Módulos de Nueva Generación</p>
            <h2 id="features-heading" className="text-3xl sm:text-4xl font-black text-[#3b3733] tracking-tight">
              Diseñado exclusivamente para el ritmo frenético de los restaurantes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Feature 1 — AI (featured, larger) */}
            <div className="md:col-span-2 lg:col-span-1 p-8 rounded-3xl bg-gradient-to-br from-[#2a2e22] to-[#3b3733] text-[#fcfeff] border border-[#a9b994]/30 hover:border-[#a9b994] transition-all duration-300 hover:shadow-xl hover:shadow-[#a9b994]/15 group">
              <div className="w-12 h-12 rounded-2xl bg-[#a9b994]/20 border border-[#a9b994]/30 flex items-center justify-center mb-6 group-hover:bg-[#a9b994]/30 transition-colors">
                <Cpu className="w-6 h-6 text-[#a9b994]" />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#a9b994]/20 border border-[#a9b994]/30 text-[#a9b994] text-[10px] font-bold uppercase tracking-wider mb-3">
                <Sparkles className="w-2.5 h-2.5" /> Solo en Saborai
              </div>
              <h3 className="text-xl font-bold text-[#fcfeff] mb-3">Saborai Copilot — IA Nativa</h3>
              <p className="text-sm text-[#fcfeff]/65 leading-relaxed">
                La única IA integrada directamente en el POS. Predice quiebres de inventario, sugiere maridajes en mesa, audita códigos CABYS de Hacienda y analiza rentabilidad por plato — todo sin salir del sistema.
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

      {/* ── Pricing ──────────────────────────────────────────── */}
      <section aria-labelledby="pricing-heading" className="py-24 bg-[#fcfeff]" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-12">
            <p className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#a9b994]/25 text-[#3b3733] text-xs font-bold uppercase tracking-wider mb-4">
              Tarifas Transparentes en Costa Rica
            </p>
            <h2 id="pricing-heading" className="text-3xl sm:text-5xl font-black text-[#3b3733] tracking-tight mb-6">
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
                  onClick={onEnterPOS}
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
                <h3 className="text-xl font-black text-[#3b3733]">
                  {checkoutStep === 'REGISTRATION' ? 'Paso 1: Tus Datos' : 'Paso 2: Pago Seguro'}
                </h3>
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
            ) : checkoutStep === 'REGISTRATION' ? (
              <form onSubmit={handleContinueToPayment} className="space-y-4">
                {checkoutError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium">
                    ⚠️ {checkoutError}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Nombre del Restaurante</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Café & Bistro Escalante"
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      placeholder="gerencia@escalante.cr"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#3b3733] uppercase mb-1.5">Confirmar Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      placeholder="Vuelve a ingresar tu correo"
                      value={ownerEmailConfirm}
                      onChange={(e) => setOwnerEmailConfirm(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#6b686d]/30 focus:border-[#a9b994] focus:outline-none text-sm text-[#3b3733] bg-[#fcfeff]"
                    />
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full py-4 bg-[#3b3733] text-[#fcfeff] rounded-xl font-bold text-sm hover:bg-[#2a2623] transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Continuar al Pago Seguro</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSimulateTilopayCheckout} className="space-y-4">
                {checkoutError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium mb-4">
                    ⚠️ {checkoutError}
                  </div>
                )}
                
                <div className="p-5 rounded-2xl bg-[#a9b994]/10 border border-[#a9b994]/30 text-center">
                  <ShieldCheck className="w-10 h-10 text-[#a9b994] mx-auto mb-3" />
                  <h4 className="text-[#3b3733] font-black text-lg mb-2">Pago 100% Seguro</h4>
                  <p className="text-xs text-[#6b686d] leading-relaxed mb-4">
                    Al continuar, serás redirigido a la bóveda segura de <strong>TiloPay Costa Rica</strong> para digitar los datos de tu tarjeta con encriptación bancaria. Saborai POS nunca almacena tu tarjeta.
                  </p>
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
                    Serás redirigido a TiloPay. 
                    {selectedPlanModal === 'pro' && (
                      <strong className="text-[#3b3733] block mt-1">
                        Se requiere tarjeta para activar la prueba. No se realizarán cargos hoy.
                      </strong>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-4 pt-2">
                  <button
                    type="button"
                    onClick={() => setCheckoutStep('REGISTRATION')}
                    disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                    className="py-4 px-4 bg-[#f0f3ec] text-[#6b686d] rounded-xl font-bold text-sm hover:bg-[#e4e9dd] transition-colors disabled:opacity-50"
                  >
                    Atrás
                  </button>
                  <button
                    type="submit"
                    disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'}
                    className="flex-1 py-4 bg-[#3b3733] text-[#fcfeff] rounded-xl font-bold text-sm hover:bg-[#2a2623] transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {checkoutStatus === 'TOKENIZING' && <span className="animate-pulse">Redirigiendo a TiloPay...</span>}
                    {checkoutStatus === 'SUCCESS' && <span>¡Aprobada! ✓</span>}
                    {(checkoutStatus === 'IDLE' || checkoutStatus === 'ERROR') && (
                      <>
                        <CreditCard className="w-4 h-4 text-[#a9b994]" />
                        <span>Ir al Pago Seguro</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

      {/* ── FAQ Section ──────────────────────────────────────── */}
      <section aria-labelledby="faq-heading" id="faq" className="py-20 bg-[#fcfeff] border-t border-[#6b686d]/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 id="faq-heading" className="text-3xl sm:text-4xl font-black text-[#3b3733] tracking-tight mb-4">Preguntas Frecuentes</h2>
            <p className="text-[#6b686d] text-base">Todo lo que necesitas saber antes de comenzar.</p>
          </div>
          <dl className="space-y-6">
            {[
              {
                q: '¿Saborai POS cumple con la facturación electrónica de Hacienda Costa Rica?',
                a: 'Sí. Emitimos facturas en formato XML según la norma v4.3 del Ministerio de Hacienda, con clave de 50 dígitos y control de IVA diferenciado (13%, 4%, 2%, 1% y exento).'
              },
              {
                q: '¿Cómo funcionan los pagos con Tilopay?',
                a: 'Los datos de tarjeta son tokenizados de forma segura por Tilopay. Los cobros de suscripción son automáticos cada mes sin que tengas que hacer nada.'
              },
              {
                q: '¿Puedo usar Saborai POS sin internet?',
                a: 'Sí. Funciona en modo Offline mediante sincronización en red local. Tus operaciones continúan con normalidad y se sincronizan al recuperar la conexión.'
              },
              {
                q: '¿Puedo cancelar mi suscripción en cualquier momento?',
                a: 'Sí. No hay contratos de permanencia. Puedes cancelar cuando quieras desde tu panel de administración o contactando al soporte.'
              }
            ].map(({ q, a }, i) => (
              <div key={i} className="border border-[#6b686d]/20 rounded-2xl p-6 hover:border-[#a9b994] transition-colors">
                <dt className="font-bold text-[#3b3733] text-base mb-2">{q}</dt>
                <dd className="text-[#6b686d] text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      </main>{/* end #main-content */}

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer role="contentinfo" className="py-14 bg-[#3b3733] text-[#fcfeff]/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-10">
            {/* Brand */}
            <div>
              <div className="mb-3">
                <BrandLogo variant="full" size="sm" />
              </div>
              <p className="text-xs leading-relaxed text-[#fcfeff]/50">
                El primer software gastronómico con Inteligencia Artificial para restaurantes de Costa Rica.
              </p>
              <address className="not-italic mt-4 text-xs text-[#fcfeff]/40">
                Costa Rica · Soporte vía WhatsApp
              </address>
            </div>
            {/* Quick Links */}
            <nav aria-label="Navegación del pie de página">
              <p className="text-xs font-bold uppercase tracking-widest text-[#a9b994] mb-4">Navegación</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-[#fcfeff] transition-colors">Funciones</a></li>
                <li><a href="#pricing" className="hover:text-[#fcfeff] transition-colors">Precios</a></li>
                <li><a href="#faq" className="hover:text-[#fcfeff] transition-colors">Preguntas Frecuentes</a></li>
              </ul>
            </nav>
            {/* Legal */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#a9b994] mb-4">Legal</p>
              <ul className="space-y-2 text-sm">
                <li><span className="text-[#fcfeff]/50">Términos y Condiciones</span></li>
                <li><span className="text-[#fcfeff]/50">Política de Privacidad</span></li>
                <li><span className="text-[#fcfeff]/50">Política de Cookies</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-[#fcfeff]/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#fcfeff]/40">
            <p>&copy; 2026 Saborai POS Costa Rica. Todos los derechos reservados.</p>
            <p>Cumplimiento Ministerio de Hacienda v4.3 · Pagos seguros Tilopay</p>
          </div>
        </div>
      </footer>

    </div>
  );
};
