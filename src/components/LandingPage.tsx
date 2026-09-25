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
  Tablet,
  Monitor,
  Smartphone,
  Star,
  Play,
  X,
  Menu,
  Globe,
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
      accent: '#6ee7b7',
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
        'Saborai Copilot IA - Cross-selling y Asistente',
        'Control de Recetas y Escandallos automáticos',
        'Subcuentas y división de cuentas en mesa',
        'KDS Cocina y Bar con alertas de tiempo',
        'Matriz de impresión en red IP y Spooler',
        'Sincronización Offline en Red Local (Mesh)',
      ],
      popular: true,
      accent: '#a7f3d0',
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
        'Consolidación financiera y stock entre locales',
        'Multi-caja y conciliación bancaria Tilopay',
        'Soporte prioritario 24/7 y Onboarding VIP',
      ],
      popular: false,
      accent: '#c4b5fd',
      buttonText: 'Contratar Multi-Sucursal',
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
      setCheckoutError(err.message || 'Error al conectar con TiloPay.');
    }
  };

  const features = [
    {
      emoji: '🧠',
      label: 'IA Nativa',
      title: 'Saborai Copilot',
      badge: 'Solo en Saborai',
      desc: 'La única IA integrada en el núcleo de un POS en Costa Rica. Predice quiebres de inventario, sugiere maridajes en mesa y audita códigos CABYS de Hacienda en tiempo real, sin salir del sistema.',
      color: '#10b981',
      chat: [
        { role: 'ai', msg: 'El lomo de res estará agotado en 2 días según el ritmo actual de ventas.' },
        { role: 'user', msg: 'Mesa 7 pidió el ribeye. ¿Qué vino le recomiendo?' },
        { role: 'ai', msg: 'Malbec Reserva o Carménère. Ambos en inventario, maridarán perfectamente.' },
        { role: 'user', msg: 'Revisar CABYS del tiramisú' },
        { role: 'ai', msg: 'Código 2129090000 correcto. IVA 13%. Sin observaciones de Hacienda.' },
      ],
    },
    {
      emoji: '🏛️',
      label: 'Hacienda v4.3',
      title: 'Facturación Electrónica',
      badge: 'Certificado Hacienda',
      desc: 'Emisión de XML firmado digitalmente según normativa Hacienda v4.3. Clave 50 dígitos, IVA diferenciado (13%, 4%, 2%, 1%, Exento) y 10% de servicio automático.',
      color: '#3b82f6',
      chat: [
        { role: 'ai', msg: 'Factura FE-001 emitida y enviada a Hacienda exitosamente.' },
        { role: 'user', msg: 'El cliente quiere una nota de crédito.' },
        { role: 'ai', msg: 'Nota de crédito NC-001 generada y enviada al correo del cliente.' },
        { role: 'ai', msg: 'IVA 13% aplicado correctamente. Exoneración B2B detectada.' },
      ],
    },
    {
      emoji: '👨‍🍳',
      label: 'KDS Cocina',
      title: 'Pantallas KDS Inteligentes',
      badge: 'Multi-Estación',
      desc: 'Comandas en tiempo real para cocina y bar. Alertas visuales y sonoras por tiempo de preparación. Enrutamiento automático por categoría, caliente a cocina, cócteles al bar.',
      color: '#f97316',
      chat: [
        { role: 'ai', msg: 'Comanda Mesa 3: 2x Ceviche, 1x Salmón. En espera 4 min.' },
        { role: 'ai', msg: 'Bar Mesa 5: 3x Mojito, 1x Margarita. ¡Listo!' },
        { role: 'user', msg: 'El ribeye de Mesa 7 está tomando demasiado.' },
        { role: 'ai', msg: 'Alerta enviada al chef. Tiempo actual: 18 min (umbral: 15 min).' },
      ],
    },
    {
      emoji: '⚗️',
      label: 'Escandallos',
      title: 'Recetas y Escandallos Vivos',
      badge: 'Control Total',
      desc: 'Cada venta descuenta gramos exactos de carne, ml de licor y unidades de insumo. Control automático de mermas, costos operativos y rentabilidad real por plato.',
      color: '#eab308',
      chat: [
        { role: 'ai', msg: 'Venta Ribeye 300g: -315g de res (merma 5%). Stock restante: 2.4 kg.' },
        { role: 'ai', msg: 'Mojito vendido: -45ml ron, -8g azúcar, -2 hojas de menta.' },
        { role: 'user', msg: '¿Cuál plato está debajo del margen objetivo?' },
        { role: 'ai', msg: 'Ceviche: margen 18% vs objetivo 30%. Costo de insumos subió 12%.' },
      ],
    },
    {
      emoji: '📡',
      label: 'Modo Offline',
      title: 'Sincronización Mesh Local',
      badge: 'Sin Interrupciones',
      desc: '¿Se cayó el internet? La red local sigue comunicando saloneros, cocina y bar al instante mediante WebSockets locales e IndexedDB. Todo se sincroniza al reconectar.',
      color: '#64748b',
      chat: [
        { role: 'ai', msg: 'Internet desconectado. Modo Offline activo. Red local OK.' },
        { role: 'user', msg: 'Mesa 2 pide la cuenta.' },
        { role: 'ai', msg: 'Tiquete generado. Cola Hacienda: 3 facturas pendientes de envío.' },
        { role: 'ai', msg: 'Conexión restaurada. 3 facturas enviadas a Hacienda exitosamente.' },
      ],
    },
    {
      emoji: '🖨️',
      label: 'Impresión',
      title: 'Enrutador Térmico Inteligente',
      badge: 'Plug and Print',
      desc: 'Conexión multicanal: IP/Ethernet, Bluetooth y USB. Separa automáticamente platos a cocina y cócteles al bar. Compatible con impresoras 58mm y 80mm de cualquier marca.',
      color: '#ec4899',
      chat: [
        { role: 'ai', msg: 'Impresora Cocina (IP 192.168.1.10): OK. Papel disponible.' },
        { role: 'ai', msg: 'Comanda Bar enviada a Epson TM-T20 vía Bluetooth.' },
        { role: 'user', msg: 'La impresora de cocina se desconectó.' },
        { role: 'ai', msg: 'Reintentando... Comanda redirigida a impresora de respaldo USB.' },
      ],
    },
  ];

  const usageModes = [
    {
      icon: '📱',
      title: 'Salonero en Mesa',
      subtitle: 'iPad / Tablet Android',
      desc: 'El salonero toma el pedido desde la mesa con el mapa interactivo. La comanda llega en segundos a cocina y bar. Sin papel, sin errores.',
      steps: ['Selecciona mesa en el mapa interactivo', 'Agrega items del menú digital', 'IA sugiere maridajes al instante', 'Envía a cocina y bar con 1 toque'],
      accent: '#22d3ee',
    },
    {
      icon: '🖥️',
      title: 'Caja Rápida',
      subtitle: 'PC / Pantalla Táctil',
      desc: 'Cobro express en mostrador. Subcuentas, splits por persona y pagos mixtos (efectivo + Tilopay). Factura Hacienda emitida en segundos.',
      steps: ['Selección rápida de items', 'División de cuenta automática', 'Cobro Tilopay o efectivo', 'Factura electrónica en segundos'],
      accent: '#a78bfa',
    },
    {
      icon: '📊',
      title: 'Admin Remoto',
      subtitle: 'Smartphone - Control Total',
      desc: 'El dueño monitorea ventas, inventario y rendimiento del equipo desde cualquier lugar. La IA envía alertas proactivas cuando detecta anomalías.',
      steps: ['Dashboard de ventas en vivo', 'Alertas IA de stock bajo', 'Reportes Z y financieros', 'Gestión de menú y precios'],
      accent: '#34d399',
    },
    {
      icon: '🌐',
      title: 'Multi-Sucursal',
      subtitle: 'Dashboard Centralizado',
      desc: 'Controla todas tus sucursales desde un panel unificado. Menú sincronizado, inventario consolidado y reportes financieros comparativos en tiempo real.',
      steps: ['Vista comparativa de sucursales', 'Menú y precios centralizados', 'Stock consolidado en red', 'Conciliación Tilopay multi-caja'],
      accent: '#f59e0b',
    },
  ];

  return (
    <div className="min-h-screen bg-[#08090a] text-white overflow-x-hidden">
      <style>{`
        @keyframes floatY { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes glowPulse { 0%,100%{opacity:.35} 50%{opacity:.8} }
        @keyframes slideUp { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes gradientShift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes beamSweep {
          0%{transform:translateX(-100%) skewX(-20deg)}
          100%{transform:translateX(500%) skewX(-20deg)}
        }
        .lp-float { animation: floatY 5s ease-in-out infinite; }
        .lp-glow { animation: glowPulse 3.5s ease-in-out infinite; }
        .lp-slide-up { animation: slideUp .65s ease both; }
        .lp-fade-in { animation: fadeIn .45s ease both; }
        .lp-grad { animation: gradientShift 7s ease infinite; background-size:200% 200%; }
        .lp-cursor { display:inline-block; animation: cursorBlink .75s step-end infinite; }
        .lp-glass {
          background: rgba(255,255,255,.045);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
          border: 1px solid rgba(255,255,255,.09);
        }
        .lp-glass-dark {
          background: rgba(0,0,0,.45);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border: 1px solid rgba(255,255,255,.06);
        }
        .lp-grad-text {
          background: linear-gradient(135deg, #6ee7b7 0%, #3b82f6 50%, #a855f7 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lp-card {
          transition: transform .28s cubic-bezier(.4,0,.2,1), box-shadow .28s cubic-bezier(.4,0,.2,1);
        }
        .lp-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 24px 64px rgba(0,0,0,.55);
        }
        .lp-feat-tab {
          transition: all .22s ease;
          border: 1px solid rgba(255,255,255,.08);
        }
        .lp-feat-tab:hover { border-color: rgba(255,255,255,.18); }
        .lp-feat-tab.lp-active {
          background: rgba(16,185,129,.12);
          border-color: rgba(16,185,129,.45);
        }
        .lp-beam { position: relative; overflow: hidden; }
        .lp-beam::after {
          content:'';
          position:absolute; top:0; left:0; right:0; bottom:0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.1), transparent);
          animation: beamSweep 2.8s ease-in-out infinite;
          pointer-events: none;
        }
        .lp-grid-bg {
          background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
          background-size: 56px 56px;
        }
        .lp-hero-bg {
          background:
            radial-gradient(ellipse 80% 55% at 50% -5%, rgba(52,211,153,.11) 0%, transparent 58%),
            radial-gradient(ellipse 50% 40% at 85% 80%, rgba(139,92,246,.09) 0%, transparent 50%),
            radial-gradient(ellipse 45% 35% at 5% 65%, rgba(59,130,246,.07) 0%, transparent 50%),
            #08090a;
        }
      `}</style>

      {/* Orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute top-[-15%] left-[15%] w-[700px] h-[700px] rounded-full lp-glow" style={{ background: 'rgba(52,211,153,.07)', filter: 'blur(130px)' }} />
        <div className="absolute bottom-[5%] right-[0%] w-[550px] h-[550px] rounded-full lp-glow" style={{ background: 'rgba(139,92,246,.07)', filter: 'blur(110px)', animationDelay: '2s' }} />
        <div className="absolute top-[45%] left-[-8%] w-[400px] h-[400px] rounded-full lp-glow" style={{ background: 'rgba(59,130,246,.06)', filter: 'blur(90px)', animationDelay: '4s' }} />
      </div>

      {/* Announcement bar */}
      <div className="relative z-20 lp-grad text-white py-2.5 px-4 text-center text-xs font-semibold flex items-center justify-center gap-2.5" style={{ background: 'linear-gradient(90deg,#059669,#0d9488,#0891b2,#059669)', backgroundSize:'200% auto' }}>
        <Sparkles className="w-3.5 h-3.5 animate-pulse shrink-0" aria-hidden="true" />
        <span>
          <strong>Saborai POS</strong> — El primer POS en Costa Rica con IA nativa integrada.{' '}
          <button onClick={onEnterPOS} className="underline underline-offset-2 font-bold hover:no-underline">
            Prueba gratis 14 días
          </button>
        </span>
      </div>

      {/* Navbar */}
      <header
        role="banner"
        className="sticky top-0 z-50 transition-all duration-300"
        style={scrolled ? { background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,.06)' } : {}}
      >
        <nav aria-label="Navegación principal" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <a href="#" aria-label="Saborai POS - Ir al inicio">
            <BrandLogo variant="full" size="sm" />
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: 'rgba(255,255,255,.55)' }}>
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','FAQ']].map(([href,label]) => (
              <a key={href} href={href} className="relative group transition-colors hover:text-white">
                {label}
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-emerald-400 group-hover:w-full transition-all duration-300" />
              </a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={onEnterPOS} aria-label="Probar demo del POS" className="px-4 py-2 text-sm font-semibold transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,.55)' }}>
              Probar Demo
            </button>
            <button
              onClick={onEnterPOS}
              id="nav-cta-free-trial"
              aria-label="Comenzar prueba gratuita de 14 días"
              className="lp-beam px-5 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 hover:scale-105 active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 4px 20px rgba(16,185,129,.3)' }}
            >
              Prueba Gratis 14 días
            </button>
          </div>
          <button className="md:hidden p-2 transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,.6)' }} onClick={() => setMobileMenuOpen(v => !v)} aria-label="Abrir menú">
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>
        {mobileMenuOpen && (
          <div className="md:hidden lp-glass-dark border-t border-white/5 px-6 py-5 space-y-4 lp-fade-in">
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','FAQ']].map(([href,label]) => (
              <a key={href} href={href} className="block py-1 font-medium transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,.55)' }} onClick={() => setMobileMenuOpen(false)}>{label}</a>
            ))}
            <div className="pt-3 flex flex-col gap-3">
              <button onClick={onEnterPOS} className="w-full py-3 rounded-xl text-sm font-bold border border-white/15 hover:border-white/30 transition-colors" style={{ color: 'rgba(255,255,255,.7)' }}>Probar Demo</button>
              <button onClick={onEnterPOS} className="w-full py-3 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 4px 16px rgba(16,185,129,.3)' }}>Prueba Gratis 14 días</button>
            </div>
          </div>
        )}
      </header>

      <main id="main-content">

        {/* HERO */}
        <section className="lp-hero-bg relative overflow-hidden pt-20 pb-28 lg:pt-28 lg:pb-36" aria-label="Inicio">
          <div className="lp-grid-bg absolute inset-0 pointer-events-none" aria-hidden="true" style={{ opacity: .4 }} />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="flex flex-col items-center text-center max-w-5xl mx-auto">

              <div className="lp-slide-up inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 lp-glass" style={{ border: '1px solid rgba(16,185,129,.35)', color: '#6ee7b7' }}>
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <Cpu className="w-3.5 h-3.5" />
                <span className="text-xs font-bold uppercase tracking-widest">El primer POS con IA nativa en Costa Rica</span>
              </div>

              <h1 className="lp-slide-up text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight leading-tight mb-6" style={{ animationDelay: '.1s' }}>
                El POS que{' '}
                <span className="lp-grad-text">
                  {typingText}
                  <span className="lp-cursor">|</span>
                </span>
              </h1>

              <p className="lp-slide-up text-lg sm:text-xl leading-relaxed mb-10 max-w-3xl" style={{ animationDelay: '.2s', color: 'rgba(255,255,255,.5)' }}>
                Saborai POS integra <strong style={{ color: 'rgba(255,255,255,.85)' }}>Inteligencia Artificial nativa</strong> en cada módulo de tu restaurante.
                Facturación Hacienda v4.3, KDS, escandallos, modo offline y pagos Tilopay — todo conectado con IA que trabaja junto a tu equipo.
              </p>

              <div className="lp-slide-up flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto" style={{ animationDelay: '.3s' }}>
                <button
                  onClick={onEnterPOS}
                  id="hero-cta-free-trial"
                  aria-label="Comenzar prueba gratuita de 14 días"
                  className="lp-beam w-full sm:w-auto px-8 py-4 rounded-2xl font-bold text-base hover:opacity-90 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2.5 group"
                  style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 8px 32px rgba(16,185,129,.35)' }}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Comenzar Prueba Gratis (14 Días)</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                  onClick={onEnterPOS}
                  id="hero-cta-demo"
                  aria-label="Probar demo del POS"
                  className="lp-glass w-full sm:w-auto px-8 py-4 rounded-2xl font-bold text-base hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                  style={{ border: '1px solid rgba(255,255,255,.2)' }}
                >
                  <Play className="w-4 h-4" style={{ color: '#34d399' }} />
                  <span>Probar Demo del POS</span>
                </button>
              </div>

              <div className="lp-slide-up mt-14 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs font-medium" style={{ animationDelay: '.4s', color: 'rgba(255,255,255,.35)' }}>
                {[
                  { icon: <Cpu className="w-3.5 h-3.5" style={{ color: '#34d399' }} />, text: 'IA Nativa Integrada' },
                  { icon: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#34d399' }} />, text: 'Hacienda v4.3 Certificado' },
                  { icon: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#34d399' }} />, text: 'Pagos Tilopay CR' },
                  { icon: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#34d399' }} />, text: 'Sincronización Offline' },
                  { icon: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#34d399' }} />, text: 'Sin permanencia' },
                ].map(({ icon, text }) => (
                  <div key={text} className="flex items-center gap-2 hover:text-white/70 transition-colors">
                    {icon}
                    <span>{text}</span>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </section>

        {/* STATS */}
        <section className="py-16" style={{ borderTop: '1px solid rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.05)' }} aria-label="Estadísticas">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div ref={statsRef} className="grid grid-cols-1 sm:grid-cols-3 gap-10 text-center">
              {[
                { val: stat1, suffix: '%', label: 'Reducción de errores en comanda', note: 'vs. sistema en papel' },
                { val: stat2, suffix: '%', label: 'Ahorro en tiempo de facturación', note: 'con Hacienda automático' },
                { val: stat3, suffix: ' días', label: 'Prueba gratuita sin tarjeta', note: 'Activa en 2 minutos' },
              ].map(({ val, suffix, label, note }) => (
                <div key={label}>
                  <div className="text-5xl sm:text-6xl font-black lp-grad-text mb-2">
                    {val}{suffix}
                  </div>
                  <p className="font-semibold text-base mb-1" style={{ color: 'rgba(255,255,255,.8)' }}>{label}</p>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,.3)' }}>{note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" aria-labelledby="features-heading" className="py-28 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

            <div className="text-center max-w-3xl mx-auto mb-16">
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#34d399' }}>Módulos de Nueva Generación</p>
              <h2 id="features-heading" className="text-3xl sm:text-5xl font-black tracking-tight mb-5">
                Diseñado para el ritmo <span className="lp-grad-text">frenético</span> de los restaurantes
              </h2>
              <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,.45)' }}>
                Cada módulo conectado con IA. Información en tiempo real que fluye entre mesas, cocina, bar y gerencia.
              </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Tabs */}
              <div className="flex lg:flex-col gap-2 w-full lg:w-64 shrink-0 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
                {features.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveFeature(i)}
                    className={`lp-feat-tab shrink-0 flex items-center gap-3 px-4 py-3 rounded-2xl text-left w-[150px] lg:w-full ${activeFeature === i ? 'lp-active' : ''}`}
                    style={{ color: activeFeature === i ? 'white' : 'rgba(255,255,255,.45)' }}
                  >
                    <span className="text-lg">{f.emoji}</span>
                    <span className="font-bold text-sm">{f.label}</span>
                    {activeFeature === i && <ChevronRight className="w-4 h-4 ml-auto shrink-0 hidden lg:block" style={{ color: '#34d399' }} />}
                  </button>
                ))}
              </div>

              {/* Panel */}
              <div className="flex-1 lp-glass rounded-3xl p-8 min-h-[480px]">
                {features.map((f, i) => (
                  <div key={i} className={activeFeature === i ? 'block lp-fade-in' : 'hidden'}>
                    <div className="flex flex-col lg:flex-row gap-8">
                      <div className="flex-1">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-xs font-bold uppercase tracking-wider mb-5" style={{ background: f.color + '22', border: '1px solid ' + f.color + '44', color: f.color }}>
                          <span>{f.badge}</span>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-black mb-4">{f.title}</h3>
                        <p className="text-base leading-relaxed mb-8" style={{ color: 'rgba(255,255,255,.55)' }}>{f.desc}</p>
                        <button
                          onClick={onEnterPOS}
                          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white hover:opacity-90 transition-all"
                          style={{ background: `linear-gradient(135deg,${f.color},${f.color}cc)`, boxShadow: `0 4px 20px ${f.color}35` }}
                        >
                          <Play className="w-4 h-4" />
                          Ver en vivo
                        </button>
                      </div>

                      <div className="flex-1 lp-glass-dark rounded-2xl p-5 max-w-sm w-full">
                        <div className="flex items-center gap-2.5 mb-4 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg,#10b981,#0d9488)` }}>
                            <Bot className="w-3.5 h-3.5 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">Saborai Copilot</p>
                            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,.3)' }}>IA nativa activa</p>
                          </div>
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        </div>
                        <div className="space-y-2.5">
                          {f.chat.map((m, ci) => (
                            <div key={ci} className={`text-xs px-3.5 py-2.5 rounded-xl leading-relaxed ${m.role === 'ai' ? 'bg-white/5 border border-white/8' : 'ml-8 text-right border'}`} style={m.role === 'ai' ? { color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.07)' } : { background: f.color + '18', borderColor: f.color + '35', color: f.color }}>
                              {m.msg}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* USAGE MODES */}
        <section id="usage" aria-labelledby="usage-heading" className="py-28 relative" style={{ background: 'radial-gradient(ellipse 75% 50% at 50% 50%, rgba(16,185,129,.06) 0%, transparent 70%)' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

            <div className="text-center max-w-3xl mx-auto mb-16">
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#34d399' }}>Modos de Uso</p>
              <h2 id="usage-heading" className="text-3xl sm:text-5xl font-black tracking-tight mb-5">
                Un sistema, <span className="lp-grad-text">infinitas formas</span> de operar
              </h2>
              <p className="text-base" style={{ color: 'rgba(255,255,255,.45)' }}>Saborai POS se adapta al rol de cada persona en tu equipo.</p>
            </div>

            <div className="flex flex-wrap justify-center gap-3 mb-12">
              {usageModes.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setActiveUsage(i)}
                  className="flex items-center gap-2.5 px-5 py-3 rounded-2xl font-semibold text-sm transition-all duration-300"
                  style={activeUsage === i
                    ? { border: `1px solid ${m.accent}55`, background: m.accent + '18', color: m.accent }
                    : { border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.45)' }
                  }
                >
                  <span>{m.icon}</span><span>{m.title}</span>
                </button>
              ))}
            </div>

            {usageModes.map((mode, i) => (
              <div key={i} className={activeUsage === i ? 'block lp-fade-in' : 'hidden'}>
                <div className="lp-glass rounded-3xl p-8 sm:p-12" style={{ border: `1px solid ${mode.accent}25` }}>
                  <div className="flex flex-col lg:flex-row gap-10 items-center">
                    <div className="flex-1 max-w-xl">
                      <div className="flex items-center gap-3 mb-5">
                        <span className="text-4xl">{mode.icon}</span>
                        <div>
                          <h3 className="text-2xl font-black text-white">{mode.title}</h3>
                          <p className="text-sm" style={{ color: 'rgba(255,255,255,.35)' }}>{mode.subtitle}</p>
                        </div>
                      </div>
                      <p className="text-base leading-relaxed mb-8" style={{ color: 'rgba(255,255,255,.6)' }}>{mode.desc}</p>
                      <button
                        onClick={onEnterPOS}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white lp-glass hover:bg-white/10 transition-all"
                        style={{ border: `1px solid ${mode.accent}35` }}
                      >
                        <Play className="w-4 h-4" style={{ color: mode.accent }} />
                        Probar este modo
                      </button>
                    </div>
                    <div className="flex-1 w-full max-w-md space-y-3">
                      {mode.steps.map((step, si) => (
                        <div key={si} className="flex items-center gap-4 lp-glass rounded-2xl px-5 py-4 lp-card">
                          <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center shrink-0" style={{ background: mode.accent + '22', color: mode.accent }}>
                            {si + 1}
                          </div>
                          <span className="font-medium text-sm" style={{ color: 'rgba(255,255,255,.7)' }}>{step}</span>
                          <ChevronRight className="w-4 h-4 ml-auto shrink-0" style={{ color: 'rgba(255,255,255,.2)' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}

          </div>
        </section>

        {/* AI DEEP DIVE */}
        <section aria-labelledby="ai-heading" id="ai" className="py-28 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#060a09 0%,#0a1512 40%,#060a09 100%)' }}>
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(16,185,129,.055) 0%, transparent 65%)' }} />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              
              <div className="flex-1 max-w-xl">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-6" style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)', color: '#34d399' }}>
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Saborai Copilot IA - Exclusivo</span>
                </div>
                <h2 id="ai-heading" className="text-3xl sm:text-5xl font-black tracking-tight mb-6 leading-tight">
                  La primera IA que vive <span className="lp-grad-text">dentro</span> de tu POS.
                </h2>
                <p className="text-base leading-relaxed mb-10" style={{ color: 'rgba(255,255,255,.5)' }}>
                  Otros sistemas conectan un chatbot externo. Saborai Copilot tiene acceso directo a tus comandas, inventario, ventas y recetas en tiempo real.
                </p>

                <div className="space-y-4">
                  {[
                    ['🧠', 'Predicción de quiebres de stock', 'Alerta con días de anticipación.'],
                    ['🍷', 'Sugerencias de maridaje en mesa', 'Recomendaciones en tiempo real.'],
                    ['📋', 'Auditoría de códigos CABYS', 'Detecta y corrige para cumplir Hacienda.'],
                    ['📊', 'Análisis de rentabilidad por plato', 'Identifica qué platos tienen mejor margen.'],
                  ].map(([emoji, title, desc]) => (
                    <div key={title} className="flex items-start gap-4 lp-glass rounded-2xl p-4 lp-card">
                      <span className="text-2xl shrink-0" aria-hidden="true">{emoji}</span>
                      <div>
                        <p className="font-bold text-white text-sm mb-1">{title}</p>
                        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,.4)' }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={onEnterPOS}
                  aria-label="Probar Copilot IA gratis"
                  className="lp-beam mt-10 inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl font-bold text-sm text-white hover:opacity-90 active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 8px 28px rgba(16,185,129,.3)' }}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Probar el Copilot IA Gratis</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 w-full max-w-lg">
                <div className="lp-glass-dark rounded-3xl p-6">
                  <div className="flex items-center gap-3 mb-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 4px 16px rgba(16,185,129,.3)' }}>
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Saborai Copilot</p>
                      <p className="text-[10px]" style={{ color: 'rgba(255,255,255,.3)' }}>IA nativa integrada</p>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] font-bold" style={{ color: '#34d399' }}>En vivo</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { role: 'ai', msg: 'El lomo de res se agotará en 2 días según el ritmo de ventas.' },
                      { role: 'user', msg: 'Mesa 7 pidió el ribeye. ¿Qué vino le recomiendo?' },
                      { role: 'ai', msg: 'Sugiere el Malbec Reserva o el Carménère. Ambos en inventario y maridarán perfectamente con cortes rojos.' },
                      { role: 'user', msg: 'Revisar el código CABYS del tiramisú' },
                      { role: 'ai', msg: 'Código correcto: 2129090000 · IVA aplicable: 13% · Sin observaciones de Hacienda.' },
                      { role: 'user', msg: '¿Cuál plato tiene mejor margen hoy?' },
                      { role: 'ai', msg: 'El Risotto de Hongos tiene 52% de margen neto. El Ceviche bajó a 18% — costo de insumos subió 12% esta semana.' },
                    ].map((m, i) => (
                      <div key={i} className={`text-xs px-4 py-3 rounded-xl leading-relaxed ${m.role === 'ai' ? '' : 'ml-12 text-right'}`} style={m.role === 'ai' ? { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', color: 'rgba(255,255,255,.72)' } : { background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)', color: '#6ee7b7' }}>
                        {m.msg}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" aria-labelledby="pricing-heading" className="py-28" style={{ background: '#08090a' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <p className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 lp-glass" style={{ border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.5)' }}>
                <TrendingUp className="w-3.5 h-3.5" style={{ color: '#34d399' }} />Tarifas Transparentes en Costa Rica
              </p>
              <h2 id="pricing-heading" className="text-3xl sm:text-5xl font-black tracking-tight mb-5">
                Elige el plan ideal <span className="lp-grad-text">para tu restaurante</span>
              </h2>
              <p className="text-base" style={{ color: 'rgba(255,255,255,.4)' }}>Todos los planes incluyen actualizaciones, soporte y facturación Hacienda.</p>
              
              <div className="inline-flex items-center p-1 lp-glass rounded-2xl mt-8" style={{ border: '1px solid rgba(255,255,255,.09)' }}>
                {(['CRC', 'USD'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => setSelectedCurrency(c)}
                    className="px-6 py-2.5 rounded-xl text-xs font-bold transition-all"
                    style={selectedCurrency === c ? { background: 'linear-gradient(135deg,#10b981,#0d9488)', color: 'white', boxShadow: '0 2px 12px rgba(16,185,129,.3)' } : { color: 'rgba(255,255,255,.4)' }}
                  >
                    {c === 'CRC' ? 'Colones (₡ CRC)' : 'Dólares ($ USD)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {plans.map((pl) => (
                <div
                  key={pl.id}
                  className={`relative flex flex-col rounded-3xl overflow-hidden lp-card ${pl.popular ? '' : 'lp-glass'}`}
                  style={pl.popular ? { outline: '2px solid rgba(16,185,129,.5)', boxShadow: '0 0 60px rgba(16,185,129,.15)', background: 'rgba(255,255,255,.04)' } : { border: '1px solid rgba(255,255,255,.08)' }}
                >
                  {pl.popular && <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#10b981,#0d9488,#0891b2)' }} />}
                  
                  <div className="p-8 relative" style={pl.popular ? { background: 'linear-gradient(135deg,rgba(16,185,129,.15) 0%,rgba(13,148,136,.1) 100%)' } : {}}>
                    {pl.popular && (
                      <div className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(16,185,129,.2)', border: '1px solid rgba(16,185,129,.4)', color: '#34d399' }}>
                        <Star className="w-2.5 h-2.5" />
                        Más Popular
                      </div>
                    )}
                    <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: pl.accent + 'aa' }}>{pl.subtitle}</p>
                    <h3 className="text-2xl font-black text-white mb-4">{pl.name}</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-4xl sm:text-5xl font-black text-white">
                        {selectedCurrency === 'CRC' ? pl.priceCRC : pl.priceUSD}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,.4)' }}>{pl.period}</span>
                    </div>
                    {pl.popular && <p className="mt-2 text-xs font-bold" style={{ color: pl.accent }}>14 días gratis. Sin tarjeta requerida</p>}
                  </div>

                  <div className="flex-1 p-8 flex flex-col" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <ul className="space-y-3.5 mb-8 flex-1">
                      {pl.features.map((f) => (
                        <li key={f} className="flex items-start gap-3 text-sm" style={{ color: 'rgba(255,255,255,.6)' }}>
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: pl.accent }} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={onEnterPOS}
                      className="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200"
                      style={pl.popular ? { background: 'linear-gradient(135deg,#10b981,#0d9488)', color: 'white', boxShadow: '0 4px 20px rgba(16,185,129,.3)' } : { border: '1px solid ' + pl.accent + '35', color: pl.accent, background: pl.accent + '10' }}
                    >
                      {pl.buttonText}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            <p className="text-center text-xs mt-10" style={{ color: 'rgba(255,255,255,.2)' }}>
              Precios incluyen impuestos · Pago seguro vía Tilopay Costa Rica · Sin contratos de permanencia
            </p>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="py-24 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#0d1f1a,#0a1a14,#0d1f1a)' }}>
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(16,185,129,.3),transparent)' }} />
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
            
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest mb-8" style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)', color: '#34d399' }}>
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>Comienza hoy - Sin riesgos</span>
            </div>
            
            <h2 className="text-4xl sm:text-6xl font-black tracking-tight mb-6">
              Tu restaurante merece la <span className="lp-grad-text">tecnología más avanzada</span> de Costa Rica
            </h2>
            
            <p className="text-lg leading-relaxed mb-12 max-w-2xl mx-auto" style={{ color: 'rgba(255,255,255,.45)' }}>
              Únete a los restaurantes que gestionan sus operaciones con IA nativa. Sin permanencia, sin complicaciones.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={onEnterPOS}
                id="final-trial"
                aria-label="Comenzar prueba gratuita 14 días"
                className="lp-beam w-full sm:w-auto px-10 py-5 rounded-2xl font-black text-lg text-white hover:opacity-90 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 group"
                style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 10px 40px rgba(16,185,129,.4)' }}
              >
                <Sparkles className="w-5 h-5" />
                <span>Comenzar Prueba Gratis (14 Días)</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              
              <button
                onClick={onEnterPOS}
                id="final-demo"
                aria-label="Probar demo del POS"
                className="lp-glass w-full sm:w-auto px-10 py-5 rounded-2xl font-bold text-lg text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                style={{ border: '1px solid rgba(255,255,255,.18)' }}
              >
                <Play className="w-5 h-5" style={{ color: '#34d399' }} />
                <span>Probar Demo del POS</span>
              </button>
            </div>
            
            <div className="mt-10 flex flex-wrap items-center justify-center gap-8 text-xs" style={{ color: 'rgba(255,255,255,.25)' }}>
              {['Sin tarjeta de crédito', '14 días completamente gratis', 'Activo en 2 minutos', 'Cancelar cuando quieras'].map(t => (
                <span key={t}>✓ {t}</span>
              ))}
            </div>
            
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-h" className="py-24" style={{ background: '#08090a' }}>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 id="faq-h" className="text-3xl sm:text-5xl font-black tracking-tight mb-4">Preguntas <span className="lp-grad-text">Frecuentes</span></h2>
              <p className="text-base" style={{ color: 'rgba(255,255,255,.35)' }}>Todo lo que necesitas saber antes de comenzar.</p>
            </div>
            <dl className="space-y-4">
              {[
                ['¿Saborai POS cumple con la facturación electrónica de Hacienda?', 'Sí. XML según norma v4.3, clave 50 dígitos, IVA diferenciado (13%, 4%, 2%, 1%, Exento). Firma digital XAdES-EPES incluida.'],
                ['¿Cómo funcionan los pagos con Tilopay?', 'Tarjetas tokenizadas por Tilopay. Cobros automáticos mensuales. Saborai POS nunca almacena datos de tarjeta.'],
                ['¿Puedo usar Saborai POS sin internet?', 'Sí. Modo Offline con red local Mesh (IndexedDB y WebSockets). Operaciones continuas y sincronización al reconectar.'],
                ['¿Qué hace diferente la IA de Saborai?', 'La IA está integrada en el núcleo del sistema con acceso directo a comandas, inventario, recetas y ventas en tiempo real.'],
                ['¿Cuánto cuesta Saborai POS?', 'Express ₡22,000/mes, Pro ₡45,000/mes, Multi-Sucursal ₡85,000/mes por sucursal. Todos con 14 días de prueba.'],
                ['¿Puedo cancelar mi suscripción?', 'Sí. Sin permanencia. Cancela cuando quieras desde tu panel o contactando soporte vía WhatsApp.'],
              ].map(([q, a], i) => (
                <div key={i} className="lp-glass rounded-2xl p-6 lp-card" style={{ border: '1px solid rgba(255,255,255,.07)' }}>
                  <dt className="font-bold text-white text-base mb-2">{q}</dt>
                  <dd className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.4)' }}>{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer role="contentinfo" className="py-16" style={{ background: '#050607', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-12 mb-12">
            <div>
              <div className="mb-4"><BrandLogo variant="full" size="sm" /></div>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.28)' }}>El primer software gastronómico con Inteligencia Artificial nativa para restaurantes de Costa Rica.</p>
              <address className="not-italic mt-4 text-xs" style={{ color: 'rgba(255,255,255,.18)' }}>Costa Rica. Soporte vía WhatsApp</address>
            </div>
            
            <nav aria-label="Navegación del pie de página">
              <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: 'rgba(16,185,129,.6)' }}>Navegación</p>
              <ul className="space-y-3 text-sm" style={{ color: 'rgba(255,255,255,.3)' }}>
                {[['#features', 'Funciones'], ['#usage', 'Cómo funciona'], ['#pricing', 'Precios'], ['#faq', 'FAQ']].map(([h, l]) => (
                  <li key={h}><a href={h} className="hover:text-white transition-colors">{l}</a></li>
                ))}
              </ul>
            </nav>
            
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: 'rgba(16,185,129,.6)' }}>Legal</p>
              <ul className="space-y-3 text-sm" style={{ color: 'rgba(255,255,255,.22)' }}>
                {['Términos y Condiciones', 'Política de Privacidad', 'Política de Cookies'].map(t => (
                  <li key={t}><span>{t}</span></li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,.05)', color: 'rgba(255,255,255,.18)' }}>
            <p>2026 Saborai POS Costa Rica. Todos los derechos reservados.</p>
            <p>Hacienda v4.3. Tilopay Costa Rica. IA Nativa</p>
          </div>
        </div>
      </footer>

      {/* TILOPAY MODAL */}
      {selectedPlanModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 lp-fade-in" style={{ background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(16px)' }}>
          <div className="lp-glass-dark rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative" style={{ border: '1px solid rgba(255,255,255,.1)' }}>
            <button onClick={() => setSelectedPlanModal(null)} className="absolute top-5 right-5 p-2 rounded-xl hover:bg-white/10 transition-all" style={{ color: 'rgba(255,255,255,.4)' }} aria-label="Cerrar">
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)' }}>
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white">{checkoutStep === 'REGISTRATION' ? 'Paso 1: Tus Datos' : 'Paso 2: Pago Seguro'}</h3>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,.3)' }}>Suscripción tokenizada en Costa Rica</p>
              </div>
            </div>
            
            {showSuccessOnboarding ? (
              <div className="py-12 text-center space-y-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto animate-bounce" style={{ background: 'rgba(16,185,129,.2)' }}>
                  <CheckCircle2 className="w-10 h-10" style={{ color: '#34d399' }} />
                </div>
                <h4 className="text-2xl font-black text-white">¡Suscripción Activada!</h4>
                <p className="text-xs max-w-sm mx-auto" style={{ color: 'rgba(255,255,255,.35)' }}>Webhook verificado. Redirigiendo a tu POS...</p>
              </div>
            ) : checkoutStep === 'REGISTRATION' ? (
              <form onSubmit={handleContinueToPayment} className="space-y-4">
                {checkoutError && <div className="p-3 rounded-xl text-xs font-medium" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171' }}>{checkoutError}</div>}
                
                {[
                  { lb: 'Nombre del Restaurante', t: 'text', ph: 'Ej. Café y Bistro Escalante', v: restaurantName, fn: (v: string) => setRestaurantName(v) },
                  { lb: 'Correo Electrónico', t: 'email', ph: 'gerencia@escalante.cr', v: ownerEmail, fn: (v: string) => setOwnerEmail(v) },
                  { lb: 'Confirmar Correo', t: 'email', ph: 'Vuelve a ingresar tu correo', v: ownerEmailConfirm, fn: (v: string) => setOwnerEmailConfirm(v) }
                ].map(({ lb, t, ph, v, fn }) => (
                  <div key={lb}>
                    <label className="block text-xs font-bold uppercase mb-1.5" style={{ color: 'rgba(255,255,255,.5)' }}>{lb}</label>
                    <input type={t} required placeholder={ph} value={v} onChange={e => fn(e.target.value)} className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 placeholder-white/20 outline-none" style={{ border: '1px solid rgba(255,255,255,.1)' }} onFocus={e => (e.currentTarget.style.borderColor = 'rgba(16,185,129,.5)')} onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)')} />
                  </div>
                ))}
                
                <div className="pt-4">
                  <button type="submit" className="lp-beam w-full py-4 rounded-xl font-bold text-sm text-white hover:opacity-90 transition-all flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 4px 20px rgba(16,185,129,.3)' }}>
                    <span>Continuar al Pago Seguro</span><ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSimulateTilopayCheckout} className="space-y-4">
                {checkoutError && <div className="p-3 rounded-xl text-xs font-medium mb-4" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171' }}>{checkoutError}</div>}
                
                <div className="p-5 rounded-2xl text-center" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)' }}>
                  <ShieldCheck className="w-10 h-10 mx-auto mb-3" style={{ color: '#34d399' }} />
                  <h4 className="text-white font-black text-lg mb-2">Pago 100% Seguro</h4>
                  <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,.35)' }}>Serás redirigido a la bóveda segura de <strong style={{ color: 'rgba(255,255,255,.6)' }}>TiloPay Costa Rica</strong>. Saborai POS nunca almacena tu tarjeta.</p>
                </div>
                
                <div className="p-3.5 rounded-2xl flex items-center justify-between text-xs" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
                  <div><span className="font-bold text-white block mb-0.5">Plan:</span><span style={{ color: 'rgba(255,255,255,.4)' }}>{selectedPlanModal.toUpperCase()}</span></div>
                  <span className="text-sm font-black text-right">
                    {selectedPlanModal === 'express' ? <span className="text-white">₡22,000/mes</span> : selectedPlanModal === 'pro' ? (
                      <><span className="block" style={{ color: '#34d399' }}>14 Días Gratis</span><span className="text-xs" style={{ color: 'rgba(255,255,255,.3)' }}>Luego ₡45,000/mes</span></>
                    ) : <span className="text-white">₡85,000/mes</span>}
                  </span>
                </div>
                
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setCheckoutStep('REGISTRATION')} disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'} className="py-4 px-5 rounded-xl font-bold text-sm hover:bg-white/5 disabled:opacity-50 transition-all" style={{ border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.5)' }}>Atrás</button>
                  <button type="submit" disabled={checkoutStatus !== 'IDLE' && checkoutStatus !== 'ERROR'} className="flex-1 py-4 rounded-xl font-bold text-sm text-white hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)', boxShadow: '0 4px 20px rgba(16,185,129,.25)' }}>
                    {checkoutStatus === 'TOKENIZING' && <span className="animate-pulse">Redirigiendo a TiloPay...</span>}
                    {checkoutStatus === 'SUCCESS' && <span>¡Aprobada! ✓</span>}
                    {(checkoutStatus === 'IDLE' || checkoutStatus === 'ERROR') && <><CreditCard className="w-4 h-4" /><span>Ir al Pago Seguro</span></>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
