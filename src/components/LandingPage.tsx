import React, { useState, useEffect, useRef } from 'react';
import { BrandLogo } from './BrandLogos';
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  CreditCard,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Cpu,
  Bot,
  Play,
  X,
  Menu,
  Star,
} from 'lucide-react';
import { SubscriptionPlan } from '../types';
import { tilopayService } from '../services/tilopayService';

interface LandingPageProps {
  onStartDemo: (plan: SubscriptionPlan) => void;
  onEnterPOS: () => void;
}

function useCountUp(target: number, duration = 1800, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [start, target, duration]);
  return count;
}

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function useTyping(words: string[], speed = 80, pause = 2200) {
  const [text, setText] = useState('');
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const word = words[wordIdx];
    const timeout = setTimeout(() => {
      if (!deleting) {
        if (charIdx < word.length) {
          setText(word.slice(0, charIdx + 1));
          setCharIdx(c => c + 1);
        } else {
          setTimeout(() => setDeleting(true), pause);
        }
      } else {
        if (charIdx > 0) {
          setText(word.slice(0, charIdx - 1));
          setCharIdx(c => c - 1);
        } else {
          setDeleting(false);
          setWordIdx(i => (i + 1) % words.length);
        }
      }
    }, deleting ? speed / 2 : speed);
    return () => clearTimeout(timeout);
  }, [text, charIdx, deleting, wordIdx, words, speed, pause]);
  return text;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStartDemo, onEnterPOS }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<'CRC' | 'USD'>('CRC');
  const [selectedPlanModal, setSelectedPlanModal] = useState<SubscriptionPlan | null>(null);
  const [showSuccessOnboarding, setShowSuccessOnboarding] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const [activeUsage, setActiveUsage] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  const { ref: statsRef, inView: statsInView } = useInView();

  const typingText = useTyping(
    ['predice tus quiebres', 'sugiere maridajes', 'audita tu Hacienda', 'analiza rentabilidad'],
    70,
    2200
  );

  const stat1 = useCountUp(98, 1500, statsInView);
  const stat2 = useCountUp(40, 1600, statsInView);
  const stat3 = useCountUp(14, 1200, statsInView);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveFeature(f => (f + 1) % 6), 4000);
    return () => clearInterval(t);
  }, []);

  const plans = [
    {
      id: 'express' as SubscriptionPlan,
      name: 'Express',
      subtitle: 'Cafés y Food Trucks',
      priceCRC: '₡22,000',
      priceUSD: '$42',
      period: '/ mes',
      features: [
        'Hasta 2 dispositivos simultáneos',
        'Toma de pedidos y mapa de mesas',
        'Facturación Electrónica Hacienda v4.3',
        'Impresión térmica USB y Bluetooth',
        'Soporte estándar vía WhatsApp',
      ],
      popular: false,
      accent: '#a9b994',
      buttonText: 'Elegir Plan Express',
    },
    {
      id: 'pro' as SubscriptionPlan,
      name: 'Pro Restaurante',
      subtitle: 'El más elegido en CR',
      priceCRC: '₡45,000',
      priceUSD: '$86',
      period: '/ mes',
      features: [
        'Dispositivos ilimitados (Móvil, Tablet, PC)',
        'Saborai Copilot IA - Asistente en mesa',
        'Control de Recetas y Escandallos automáticos',
        'Subcuentas y división de cuentas en mesa',
        'KDS Cocina y Bar con alertas de tiempo',
        'Sincronización Offline en Red Local (Mesh)',
      ],
      popular: true,
      accent: '#588157',
      buttonText: 'Probar 14 Días Gratis',
    },
    {
      id: 'multibranch' as SubscriptionPlan,
      name: 'Multi-Sucursal',
      subtitle: 'Cadenas y Franquicias',
      priceCRC: '₡85,000',
      priceUSD: '$162',
      period: '/ mes por sucursal',
      features: [
        'Todo lo incluido en el Plan Pro',
        'Gestión centralizada de menú y precios',
        'Consolidación financiera y stock',
        'Multi-caja y conciliación Tilopay',
        'Soporte prioritario 24/7 y Onboarding VIP',
      ],
      popular: false,
      accent: '#3b3733',
      buttonText: 'Contratar Multi-Sucursal',
    },
  ];

  const features = [
    {
      emoji: '🧠',
      label: 'IA Nativa',
      title: 'Saborai Copilot',
      badge: 'Solo en Saborai',
      desc: 'La IA predecirá quiebres de inventario, sugerirá maridajes y auditará códigos CABYS sin salir del sistema.',
      color: '#588157',
      chat: [
        { role: 'ai', msg: 'El lomo de res se agotará en 2 días.' },
        { role: 'user', msg: 'Mesa 7 pide ribeye. ¿Vino?' },
        { role: 'ai', msg: 'Malbec Reserva. Marida perfectamente.' },
      ],
    },
    {
      emoji: '🏛️',
      label: 'Hacienda v4.3',
      title: 'Facturación Electrónica',
      badge: 'Certificado Hacienda',
      desc: 'Emisión de XML firmado según Hacienda v4.3. Clave 50 dígitos, IVA diferenciado (13%, 4%, 2%, 1%, Exento).',
      color: '#3b3733',
      chat: [
        { role: 'ai', msg: 'Factura FE-001 enviada a Hacienda.' },
        { role: 'user', msg: 'Nota de crédito.' },
        { role: 'ai', msg: 'Nota NC-001 generada.' },
      ],
    },
    {
      emoji: '👨‍🍳',
      label: 'KDS Cocina',
      title: 'Pantallas KDS',
      badge: 'Multi-Estación',
      desc: 'Comandas en tiempo real para cocina y bar con enrutamiento automático y alertas de preparación.',
      color: '#a9b994',
      chat: [
        { role: 'ai', msg: 'Mesa 3: 2x Ceviche. En espera 4 min.' },
        { role: 'user', msg: 'Ribeye Mesa 7 demorado.' },
        { role: 'ai', msg: 'Alerta enviada. 18 min (umbral: 15).' },
      ],
    },
    {
      emoji: '⚗️',
      label: 'Escandallos',
      title: 'Recetas Vivas',
      badge: 'Control Total',
      desc: 'Cada venta descuenta gramos exactos e insumos para controlar mermas y rentabilidad real por plato.',
      color: '#588157',
      chat: [
        { role: 'ai', msg: 'Venta Ribeye: -315g res. Stock: 2.4 kg.' },
        { role: 'user', msg: '¿Rentabilidad actual?' },
        { role: 'ai', msg: 'Ceviche: margen 18%. Costos subieron.' },
      ],
    },
    {
      emoji: '📡',
      label: 'Modo Offline',
      title: 'Red Local Mesh',
      badge: 'Sin Interrupciones',
      desc: 'Si el internet falla, la red local sigue funcionando. Todo se sincroniza automáticamente al reconectar.',
      color: '#3b3733',
      chat: [
        { role: 'ai', msg: 'Modo Offline activo. Red local OK.' },
        { role: 'user', msg: 'Mesa 2 cuenta.' },
        { role: 'ai', msg: 'Cola Hacienda: 3 facturas pendientes.' },
      ],
    },
    {
      emoji: '🖨️',
      label: 'Impresión',
      title: 'Enrutador Inteligente',
      badge: 'Plug and Print',
      desc: 'Conecta impresoras IP, Bluetooth o USB. Enruta platos a cocina y bebidas al bar automáticamente.',
      color: '#a9b994',
      chat: [
        { role: 'ai', msg: 'Impresora Cocina IP 192.168.1.10: OK.' },
        { role: 'user', msg: 'Se desconectó la cocina.' },
        { role: 'ai', msg: 'Comanda redirigida a la impresora de bar.' },
      ],
    },
  ];

  const usageModes = [
    {
      icon: '📱',
      title: 'Salonero en Mesa',
      subtitle: 'iPad / Tablet',
      desc: 'Toma el pedido desde la mesa. Llega en segundos a cocina y bar. Sin errores.',
      steps: ['Selecciona mesa', 'Agrega items', 'Sugerencia de IA', 'Envía a cocina'],
    },
    {
      icon: '🖥️',
      title: 'Caja Rápida',
      subtitle: 'Pantalla Táctil',
      desc: 'Cobro en mostrador. Subcuentas, split y pagos mixtos. Factura Hacienda al instante.',
      steps: ['Selección rápida', 'Split de cuenta', 'Cobro Tilopay', 'Factura inmediata'],
    },
    {
      icon: '📊',
      title: 'Admin Remoto',
      subtitle: 'Smartphone',
      desc: 'Monitorea ventas y alertas proactivas desde cualquier lugar.',
      steps: ['Dashboard en vivo', 'Alertas IA', 'Reportes Z', 'Control de Menú'],
    },
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
            if (token) await tilopayService.createSubscription(plan, token, email);
            window.history.replaceState({}, document.title, window.location.pathname);
            setCheckoutStatus('SUCCESS');
            setShowSuccessOnboarding(true);
            setTimeout(() => { onStartDemo(plan); onEnterPOS(); }, 2500);
          } catch (err: any) {
            setCheckoutStatus('ERROR');
            setCheckoutError(err.message);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        };
        registerSub();
      }
    }
  }, [onStartDemo, onEnterPOS]);

  const handleSimulateTilopayCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanModal) return;
    setCheckoutStatus('TOKENIZING');
    setCheckoutError(null);
    try {
      const url = await tilopayService.getPaymentUrl({
        email: ownerEmail,
        firstName: restaurantName || 'Saborai',
        lastName: 'Cliente',
        planId: selectedPlanModal,
        redirect: window.location.origin + `?tilopay_success=true&planId=${selectedPlanModal}&email=${encodeURIComponent(ownerEmail)}`,
      });
      window.location.href = url;
    } catch (err: any) {
      setCheckoutStatus('ERROR');
      setCheckoutError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfeff] text-[#3b3733] font-['Inter',sans-serif] overflow-x-hidden">
      <style>{`
        @keyframes floatY { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes glowPulse { 0%,100%{opacity:.4} 50%{opacity:.8} }
        @keyframes slideUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes beamSweep {
          0%{transform:translateX(-100%) skewX(-20deg)}
          100%{transform:translateX(500%) skewX(-20deg)}
        }
        .lp-float { animation: floatY 5s ease-in-out infinite; }
        .lp-glow { animation: glowPulse 4s ease-in-out infinite; }
        .lp-slide-up { animation: slideUp .7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .lp-fade-in { animation: fadeIn .5s ease both; }
        .lp-cursor { display:inline-block; animation: glowPulse .8s infinite; }
        
        .lp-glass {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(169, 185, 148, 0.3);
        }
        
        .lp-grad-text {
          background: linear-gradient(135deg, #588157 0%, #a9b994 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-card {
          transition: transform .3s cubic-bezier(.4,0,.2,1), box-shadow .3s cubic-bezier(.4,0,.2,1);
        }
        .lp-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px rgba(88, 129, 87, 0.1);
        }

        .lp-beam { position: relative; overflow: hidden; }
        .lp-beam::after {
          content:'';
          position:absolute; top:0; left:0; right:0; bottom:0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);
          animation: beamSweep 3s ease-in-out infinite;
          pointer-events: none;
        }

        .lp-hero-bg {
          background: 
            radial-gradient(circle at 15% 50%, rgba(169, 185, 148, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(88, 129, 87, 0.1) 0%, transparent 50%),
            #fcfeff;
        }
      `}</style>

      {/* Background Orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute top-[-10%] left-[10%] w-[600px] h-[600px] rounded-full lp-glow" style={{ background: 'rgba(169, 185, 148, 0.15)', filter: 'blur(100px)' }} />
        <div className="absolute bottom-[5%] right-[0%] w-[500px] h-[500px] rounded-full lp-glow" style={{ background: 'rgba(88, 129, 87, 0.1)', filter: 'blur(90px)', animationDelay: '2s' }} />
      </div>

      {/* Top Banner */}
      <div className="relative z-20 text-white py-2.5 px-4 text-center text-xs font-semibold flex items-center justify-center gap-2.5" style={{ background: 'linear-gradient(90deg, #3b3733, #588157, #3b3733)', backgroundSize: '200% auto', animation: 'glowPulse 5s infinite' }}>
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span>
          <strong>Saborai POS</strong> — El primer POS en Costa Rica con IA nativa.{' '}
          <button onClick={onEnterPOS} className="underline underline-offset-2 font-bold hover:no-underline">
            Prueba gratis 14 días
          </button>
        </span>
      </div>

      {/* Navbar */}
      <header
        role="banner"
        className="sticky top-0 z-50 transition-all duration-300"
        style={scrolled ? { background: 'rgba(252, 254, 255, 0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(169, 185, 148, 0.2)' } : {}}
      >
        <nav aria-label="Navegación principal" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <a href="#" aria-label="Saborai POS - Inicio">
            <BrandLogo variant="full" size="sm" />
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#6b686d]">
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','FAQ']].map(([href,label]) => (
              <a key={href} href={href} className="hover:text-[#588157] transition-colors">{label}</a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={onEnterPOS} className="px-4 py-2 text-sm font-bold text-[#3b3733] hover:text-[#588157] transition-colors">
              Probar Demo
            </button>
            <button
              onClick={onEnterPOS}
              className="lp-beam px-6 py-2.5 rounded-full font-bold text-sm text-white hover:scale-105 active:scale-95 transition-all shadow-md"
              style={{ background: '#588157' }}
            >
              Prueba Gratis 14 Días
            </button>
          </div>
          <button className="md:hidden p-2 text-[#3b3733]" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </nav>
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-[#a9b994]/20 px-6 py-5 space-y-4 shadow-xl absolute w-full lp-fade-in">
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','FAQ']].map(([href,label]) => (
              <a key={href} href={href} className="block py-2 font-bold text-[#3b3733]" onClick={() => setMobileMenuOpen(false)}>{label}</a>
            ))}
            <div className="pt-4 flex flex-col gap-3">
              <button onClick={onEnterPOS} className="w-full py-3 rounded-xl font-bold border border-[#a9b994] text-[#588157]">Probar Demo</button>
              <button onClick={onEnterPOS} className="w-full py-3 rounded-xl font-bold text-white bg-[#588157]">Prueba Gratis 14 Días</button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO */}
        <section className="lp-hero-bg relative pt-20 pb-32 lg:pt-32 lg:pb-40 text-center px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto relative z-10">
            <div className="lp-slide-up inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 bg-white border border-[#a9b994]/50 text-[#588157] shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs font-bold uppercase tracking-widest">Minimalismo e Inteligencia</span>
            </div>

            <h1 className="lp-slide-up text-5xl sm:text-7xl font-black tracking-tight leading-tight mb-6 text-[#3b3733]" style={{ animationDelay: '.1s' }}>
              El POS para restaurantes que <br className="hidden sm:block" />
              <span className="lp-grad-text">
                {typingText}
                <span className="lp-cursor text-[#a9b994]">|</span>
              </span>
            </h1>

            <p className="lp-slide-up text-lg text-[#6b686d] mb-10 max-w-2xl mx-auto leading-relaxed" style={{ animationDelay: '.2s' }}>
              Automatiza tu restaurante con la única plataforma en Costa Rica que combina Facturación Hacienda v4.3, KDS, y pagos Tilopay impulsados por IA nativa.
            </p>

            <div className="lp-slide-up flex flex-col sm:flex-row items-center justify-center gap-4" style={{ animationDelay: '.3s' }}>
              <button
                onClick={onEnterPOS}
                className="lp-beam w-full sm:w-auto px-8 py-4 rounded-full font-black text-white hover:scale-105 transition-all shadow-lg flex items-center justify-center gap-2"
                style={{ background: '#588157' }}
              >
                Comenzar Prueba Gratis <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={onEnterPOS}
                className="w-full sm:w-auto px-8 py-4 rounded-full font-bold text-[#3b3733] bg-white border border-[#a9b994]/50 hover:bg-[#f4f7f0] transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 text-[#588157]" /> Probar Demo
              </button>
            </div>
            
            <div className="lp-slide-up mt-12 flex flex-wrap items-center justify-center gap-6 text-[11px] font-bold text-[#a9b994] uppercase tracking-wider" style={{ animationDelay: '.4s' }}>
              {['IA Nativa', 'Hacienda v4.3', 'Tilopay', 'Modo Offline'].map((t) => (
                <span key={t} className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> {t}</span>
              ))}
            </div>
          </div>
        </section>

        {/* STATS */}
        <section className="py-16 bg-white border-y border-[#a9b994]/20" ref={statsRef}>
          <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 sm:grid-cols-3 gap-10 text-center">
            {[
              { val: stat1, s: '%', l: 'Eficiencia en Comanda' },
              { val: stat2, s: '%', l: 'Ahorro de Tiempo en Caja' },
              { val: stat3, s: ' días', l: 'Prueba Completamente Gratis' },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-5xl font-black text-[#588157] mb-2">{s.val}{s.s}</div>
                <div className="text-sm font-bold text-[#6b686d] uppercase tracking-widest">{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES - Minimalist Grid */}
        <section id="features" className="py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4 text-[#3b3733]">Características <span className="text-[#588157]">Únicas</span></h2>
            <p className="text-[#6b686d] max-w-2xl mx-auto">Una suite completa y moderna diseñada para simplificar la operación diaria de tu negocio gastronómico.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="lp-card bg-white rounded-3xl p-8 border border-[#a9b994]/30 shadow-sm relative overflow-hidden group">
                <div className="w-12 h-12 rounded-2xl bg-[#f4f7f0] flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform">
                  {f.emoji}
                </div>
                <h3 className="text-xl font-black mb-3 text-[#3b3733]">{f.title}</h3>
                <p className="text-sm text-[#6b686d] leading-relaxed mb-6">{f.desc}</p>
                <div className="p-4 rounded-xl bg-[#f4f7f0] border border-[#a9b994]/20 space-y-2">
                  <div className="text-[10px] font-bold text-[#a9b994] uppercase tracking-wider mb-2">Simulación:</div>
                  {f.chat.slice(0, 2).map((c, j) => (
                    <div key={j} className={`text-xs p-2 rounded-lg ${c.role === 'ai' ? 'bg-white border border-[#a9b994]/30 text-[#588157]' : 'bg-[#3b3733] text-white ml-6'}`}>
                      {c.msg}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* USAGE MODES */}
        <section id="usage" className="py-28 bg-[#f4f7f0] border-y border-[#a9b994]/20">
          <div className="max-w-7xl mx-auto px-4 text-center">
            <h2 className="text-4xl font-black mb-12 text-[#3b3733]">Flujo de trabajo <span className="text-[#588157]">Perfecto</span></h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {usageModes.map((m, i) => (
                <div key={i} className="bg-white rounded-3xl p-8 shadow-sm border border-[#a9b994]/20 text-left lp-card">
                  <div className="text-4xl mb-4">{m.icon}</div>
                  <h3 className="text-xl font-black text-[#3b3733] mb-1">{m.title}</h3>
                  <p className="text-xs font-bold text-[#a9b994] uppercase tracking-wider mb-4">{m.subtitle}</p>
                  <p className="text-sm text-[#6b686d] mb-6">{m.desc}</p>
                  <ul className="space-y-3">
                    {m.steps.map((s, j) => (
                      <li key={j} className="flex items-center gap-3 text-xs font-semibold text-[#3b3733]">
                        <div className="w-5 h-5 rounded-full bg-[#588157]/10 text-[#588157] flex items-center justify-center">{j+1}</div>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-28 max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4 text-[#3b3733]">Planes Transparentes</h2>
            <div className="inline-flex bg-[#f4f7f0] p-1 rounded-xl border border-[#a9b994]/30">
              {(['CRC', 'USD'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedCurrency(c)}
                  className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${selectedCurrency === c ? 'bg-white text-[#588157] shadow-sm' : 'text-[#6b686d]'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map(pl => (
              <div key={pl.id} className={`bg-white rounded-3xl p-8 border ${pl.popular ? 'border-[#588157] shadow-xl relative' : 'border-[#a9b994]/30 shadow-sm'} flex flex-col lp-card`}>
                {pl.popular && <div className="absolute top-0 inset-x-0 h-1.5 bg-[#588157]" />}
                {pl.popular && <div className="absolute top-4 right-4 bg-[#f4f7f0] text-[#588157] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">Recomendado</div>}
                <p className="text-[#a9b994] font-bold text-xs uppercase tracking-widest mb-2">{pl.subtitle}</p>
                <h3 className="text-2xl font-black text-[#3b3733] mb-4">{pl.name}</h3>
                <div className="text-4xl font-black text-[#588157] mb-6">
                  {selectedCurrency === 'CRC' ? pl.priceCRC : pl.priceUSD} <span className="text-sm text-[#6b686d] font-semibold">{pl.period}</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {pl.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-[#6b686d] font-medium">
                      <CheckCircle2 className="w-5 h-5 text-[#588157] shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <button onClick={onEnterPOS} className={`w-full py-4 rounded-xl font-bold transition-all ${pl.popular ? 'bg-[#588157] text-white hover:opacity-90 shadow-md' : 'bg-[#f4f7f0] text-[#3b3733] hover:bg-[#e8ece1]'}`}>
                  {pl.buttonText}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 bg-[#3b3733] text-white text-center px-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-[#588157]/10" />
          <div className="relative z-10 max-w-3xl mx-auto">
            <h2 className="text-4xl font-black mb-6">Simplifica la gestión hoy mismo.</h2>
            <p className="text-lg text-white/70 mb-10">Únete a la evolución del software gastronómico en Costa Rica. Sin permanencia.</p>
            <button onClick={onEnterPOS} className="px-10 py-5 rounded-full font-black text-[#3b3733] bg-white hover:scale-105 transition-transform shadow-xl flex items-center justify-center gap-2 mx-auto">
              Probar 14 Días Gratis <ArrowRight className="w-5 h-5 text-[#588157]" />
            </button>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="py-12 bg-[#fcfeff] border-t border-[#a9b994]/20 text-center text-sm text-[#6b686d]">
        <BrandLogo variant="full" size="sm" />
        <p className="mt-4 max-w-md mx-auto">Software de Punto de Venta con IA para Restaurantes en Costa Rica. Facturación Hacienda y Tilopay Integrado.</p>
        <p className="mt-8 text-xs text-[#a9b994]">© 2026 Saborai POS Costa Rica. Todos los derechos reservados.</p>
      </footer>
      
      {/* MODAL TILOPAY (Simplified) */}
      {selectedPlanModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#3b3733]/40 backdrop-blur-sm lp-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative">
            <button onClick={() => setSelectedPlanModal(null)} className="absolute top-5 right-5 text-[#a9b994] hover:text-[#3b3733]">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-[#f4f7f0]"><CreditCard className="w-6 h-6 text-[#588157]" /></div>
              <div>
                <h3 className="text-lg font-black text-[#3b3733]">{checkoutStep === 'REGISTRATION' ? 'Tus Datos' : 'Pago Seguro'}</h3>
                <p className="text-xs text-[#6b686d]">Suscripción con TiloPay CR</p>
              </div>
            </div>
            
            {showSuccessOnboarding ? (
              <div className="text-center py-10 space-y-4">
                <CheckCircle2 className="w-16 h-16 text-[#588157] mx-auto animate-bounce" />
                <h4 className="text-2xl font-black text-[#3b3733]">¡Bienvenido a Saborai!</h4>
              </div>
            ) : checkoutStep === 'REGISTRATION' ? (
              <form onSubmit={handleContinueToPayment} className="space-y-4">
                {checkoutError && <div className="text-red-500 text-xs font-bold bg-red-50 p-2 rounded">{checkoutError}</div>}
                <input required type="text" placeholder="Nombre Restaurante" value={restaurantName} onChange={e=>setRestaurantName(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157]" />
                <input required type="email" placeholder="Correo Electrónico" value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157]" />
                <input required type="email" placeholder="Confirmar Correo" value={ownerEmailConfirm} onChange={e=>setOwnerEmailConfirm(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157]" />
                <button type="submit" className="w-full py-4 bg-[#588157] text-white rounded-xl font-bold hover:opacity-90 transition-opacity">Siguiente Paso</button>
              </form>
            ) : (
              <form onSubmit={handleSimulateTilopayCheckout} className="space-y-6">
                <div className="bg-[#f4f7f0] p-4 rounded-2xl text-center border border-[#a9b994]/30">
                  <ShieldCheck className="w-8 h-8 text-[#588157] mx-auto mb-2" />
                  <p className="text-xs text-[#6b686d]">Serás redirigido a TiloPay para procesar tu tarjeta de forma 100% segura.</p>
                </div>
                <button type="submit" className="w-full py-4 bg-[#3b3733] text-white rounded-xl font-bold shadow-lg hover:scale-[1.02] transition-transform">Ir a Pagar Seguro</button>
                <button type="button" onClick={()=>setCheckoutStep('REGISTRATION')} className="w-full text-xs font-bold text-[#6b686d]">Volver</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
