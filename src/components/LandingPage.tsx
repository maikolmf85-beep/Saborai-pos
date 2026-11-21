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
  Mic,
  BrainCircuit,
  Wand2,
  MessageSquare,
  Zap,
  Terminal,
  ChefHat,
  Receipt,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { SubscriptionPlan } from '../types';
import { tilopayService } from '../services/tilopayService';

interface LandingPageProps {
  onStartDemo: (plan: SubscriptionPlan) => void;
  onEnterPOS: (isDemo?: boolean) => void;
}

const WHATSAPP_NUMBER = '15557961750';
const WHATSAPP_DISPLAY_NUMBER = '+1 555 796 1750';
const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola, Saborai. Me gustaría obtener más información sobre Saborai POS.')}`;

const WhatsAppMark: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
    <path fillRule="evenodd" d="M16.004 2.667c-7.364 0-13.333 5.969-13.333 13.333 0 2.355.612 4.567 1.687 6.49L2.667 29.333l7.045-1.849A13.268 13.268 0 0 0 16.004 29.333c7.364 0 13.333-5.969 13.333-13.333S23.368 2.667 16.004 2.667m0 24.222c-2.006 0-3.96-.543-5.65-1.57l-.405-.24-4.187 1.1 1.117-4.08-.264-.42a10.824 10.824 0 0 1-1.665-5.679c0-5.987 4.874-10.861 10.861-10.861 5.987 0 10.861 4.874 10.861 10.861 0 5.987-4.874 10.861-10.861 10.861m5.26-7.17c-.29-.145-1.718-.848-1.984-.945-.265-.097-.459-.145-.653.145-.194.29-.75.944-.92 1.137-.17.194-.34.218-.629.073-.29-.145-1.223-.45-2.33-1.436-.861-.767-1.442-1.714-1.612-2.003-.169-.29-.018-.446.127-.59.13-.13.29-.339.435-.508.145-.17.193-.29.29-.484.096-.193.048-.362-.025-.507-.072-.145-.653-1.569-.895-2.148-.236-.564-.474-.488-.653-.497-.169-.008-.362-.01-.556-.01-.193 0-.507.073-.774.363-.266.29-1.016.992-1.016 2.414 0 1.424 1.04 2.8 1.185 2.994.145.193 2.027 3.09 4.902 4.33.685.296 1.221.474 1.64.608.689.219 1.315.188 1.81.114.552-.082 1.718-.701 1.96-1.378.242-.677.242-1.257.17-1.378-.073-.121-.267-.194-.557-.339Z" />
  </svg>
);

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
  const [hideWhatsAppFab, setHideWhatsAppFab] = useState(false);
  
  const [demoEmailModal, setDemoEmailModal] = useState(false);
  const [demoEmail, setDemoEmail] = useState('');
  const [isSubmittingDemo, setIsSubmittingDemo] = useState(false);

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
    const inlineCtas = Array.from(document.querySelectorAll<HTMLElement>('[data-whatsapp-cta]'));
    if (inlineCtas.length === 0) return;

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const visibleCtas = new Set<Element>();
    const updateFabVisibility = () => setHideWhatsAppFab(mobileQuery.matches && visibleCtas.size > 0);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visibleCtas.add(entry.target);
        else visibleCtas.delete(entry.target);
      });
      updateFabVisibility();
    }, { threshold: 0.15 });

    inlineCtas.forEach((cta) => observer.observe(cta));
    mobileQuery.addEventListener('change', updateFabVisibility);
    return () => {
      observer.disconnect();
      mobileQuery.removeEventListener('change', updateFabVisibility);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveFeature(f => (f + 1) % 8), 4000);
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
        'Facturación Electrónica Hacienda v4.4',
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
        'Importar Menú desde PDF o Fotos con IA',
        'Soporte 24/7 con Auto-Reparación IA',
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
        'Importar Menú desde PDF o Fotos con IA',
        'Auto-Reparación IA del sistema incluida',
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
      label: 'Hacienda v4.4',
      title: 'Facturación Electrónica',
      badge: 'Certificado Hacienda',
      desc: 'Emisión de XML firmado según Hacienda v4.4. Clave 50 dígitos, IVA diferenciado (13%, 4%, 2%, 1%, Exento).',
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
    {
      emoji: '📄',
      label: 'Menú IA',
      title: 'Importar Menú Mágico',
      badge: 'Ahorra horas',
      desc: 'Sube una foto o PDF de tu menú actual y la IA extraerá platillos, precios y descripciones automáticamente. Configura tu POS en minutos.',
      color: '#588157',
      chat: [
        { role: 'user', msg: 'Subí el menú en PDF.' },
        { role: 'ai', msg: 'Detecté 28 platillos. Creando catálogo...' },
        { role: 'ai', msg: '¡Listo! 28 productos con precios y categorías.' },
      ],
    },
    {
      emoji: '🛡️',
      label: 'Soporte 24/7',
      title: 'Auto-Reparación IA',
      badge: 'Tu TI virtual',
      desc: 'Si algo falla, díselo a Nysa y el sistema se diagnosticará y reparará a sí mismo. Sin esperar técnicos ni tickets de soporte.',
      color: '#3b3733',
      chat: [
        { role: 'user', msg: 'Algo no funciona bien en caja.' },
        { role: 'ai', msg: 'Escaneando módulos... Conflicto de caché detectado.' },
        { role: 'ai', msg: '¡Reparado! Sistema operando al 100%.' },
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

  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // Rutas directas generadas en TiloPay (el cliente configurará los enlaces reales aquí)
  const tilopayLinks: Record<SubscriptionPlan, string> = {
    express: selectedCurrency === 'CRC' ? 'https://tp.cr/l/TnpZek5nPT18MQ==' : 'https://tp.cr/l/TnpZMU1RPT18MQ==',
    pro: selectedCurrency === 'CRC' ? 'https://tp.cr/l/TnpZME9RPT18MQ==' : 'https://tp.cr/l/TnpZMU1nPT18MQ==',
    multibranch: selectedCurrency === 'CRC' ? 'https://tp.cr/l/TnpZMU1BPT18MQ==' : 'https://tp.cr/l/TnpZMU13PT18MQ=='
  };

  const handleDirectRegistrationAndPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);
    
    if (!selectedPlanModal) return;

    try {
      // 1. Register the user before redirecting to TiloPay
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: ownerEmail,
          password: password,
          name: ownerName || 'Admin',
          phone: phone || '',
          restaurantName: restaurantName || 'Restaurante',
          plan: selectedPlanModal
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        setCheckoutError(data.error || 'Error al registrar usuario. Por favor intenta de nuevo.');
        return; // Detener flujo, no redirigir a TiloPay
      }

      // Guardar temporalmente como respaldo local (útil para la simulación frontend sin backend real)
      const pendingUser = {
        id: Date.now().toString(),
        name: ownerName,
        email: ownerEmail,
        phone: phone,
        restaurantName: restaurantName,
        role: 'ADMIN',
        active: true
      };
      localStorage.setItem('saborai_pending_user', JSON.stringify(pendingUser));
    } catch (err) {
      console.error('Error registrando usuario antes del pago:', err);
    }

    const directLink = tilopayLinks[selectedPlanModal] || tilopayLinks.pro;
    window.location.href = directLink;
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('login') === 'true') {
      // The parent component (App or WelcomeGate) handles ?login=true
      // This ensures LandingPage doesn't do anything weird.
    }
  }, []);

  const handleDemoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoEmail) return;
    setIsSubmittingDemo(true);
    try {
      await fetch('/api/demo/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail })
      });
    } catch (err) {
      console.error(err);
    }
    setIsSubmittingDemo(false);
    setDemoEmailModal(false);
    onEnterPOS(true);
  };

  return (
    <div className="min-h-screen bg-[#fcfeff] text-[#3b3733] font-['Inter',sans-serif] overflow-x-hidden">
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .lp-slide-up { animation: slideUp .55s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .lp-fade-in { animation: fadeIn .5s ease both; }
        .lp-grad-text {
          background: linear-gradient(135deg, #588157 0%, #a9b994 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-card {
          transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
        }
        .lp-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 16px 32px rgba(59, 55, 51, 0.08);
          border-color: rgba(88, 129, 87, 0.42);
        }
        .lp-button { transition: transform .2s ease, box-shadow .2s ease, background-color .2s ease; }
        .lp-button:hover { transform: translateY(-2px); }
        .lp-whatsapp-icon { transition: transform .2s ease; }
        .lp-whatsapp:hover .lp-whatsapp-icon,
        .lp-whatsapp:focus-visible .lp-whatsapp-icon { transform: scale(1.08); }
        .lp-wa-tooltip { opacity: 0; transform: translateX(4px); transition: opacity .18s ease, transform .18s ease; }
        .lp-wa-fab:hover .lp-wa-tooltip,
        .lp-wa-fab:focus-visible .lp-wa-tooltip { opacity: 1; transform: translateX(0); }
        .lp-faq summary::-webkit-details-marker { display: none; }
        .lp-faq details[open] summary svg { transform: rotate(90deg); }
        .lp-faq summary svg { transition: transform .18s ease; }
        .lp-hero-bg {
          background:
            radial-gradient(circle at 15% 50%, rgba(169, 185, 148, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(88, 129, 87, 0.1) 0%, transparent 50%),
            #fcfeff;
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-slide-up, .lp-fade-in { animation: none !important; }
          .lp-card, .lp-button, .lp-whatsapp-icon, .lp-wa-tooltip, .lp-faq summary svg { transition: none !important; }
          .lp-card:hover, .lp-button:hover { transform: none; }
        }
      `}</style>

      {/* Top Banner */}
      <div className="relative z-20 flex items-center justify-center gap-2.5 bg-[#3b3733] px-4 py-2.5 text-center text-xs font-semibold text-white">
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span>
          <strong>Saborai POS</strong> — El primer POS en Costa Rica con IA nativa.{' '}
          <button onClick={() => { const el = document.getElementById('pricing'); if(el) el.scrollIntoView({ behavior: 'smooth' }); }} className="underline underline-offset-2 font-bold hover:no-underline">
            Prueba gratis 14 días
          </button>
        </span>
      </div>

      {/* Navbar */}
      <header
        role="banner"
        className="sticky top-0 z-50 border-b border-[#a9b994]/20 bg-[#fcfeff]/95 shadow-sm backdrop-blur-xl transition-all duration-300"
        style={scrolled ? { background: 'rgba(252, 254, 255, 0.98)', boxShadow: '0 8px 24px rgba(59, 55, 51, 0.05)' } : {}}
      >
        <nav aria-label="Navegación principal" className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" aria-label="Saborai POS - Inicio">
            <BrandLogo variant="full" size="sm" tone="web" />
          </a>
          <div className="hidden items-center gap-7 text-sm font-semibold text-[#6b686d] md:flex">
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','Preguntas']].map(([href,label]) => (
              <a key={href} href={href} className="transition-colors hover:text-[#588157]">{label}</a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={() => onEnterPOS(false)} className="px-4 py-2 text-sm font-bold text-[#3b3733] hover:text-[#588157] transition-colors">
              Iniciar Sesión
            </button>
            <button
              onClick={() => setDemoEmailModal(true)}
              className="px-4 py-2 text-sm font-bold text-[#3b3733] bg-[#f4f7f0] rounded-full hover:bg-[#e8ece1] transition-colors"
            >
              Probar Demo
            </button>
            <button
              onClick={() => { const el = document.getElementById('pricing'); if(el) el.scrollIntoView({ behavior: 'smooth' }); }}
              className="lp-button px-6 py-2.5 rounded-full font-bold text-sm text-white shadow-sm hover:shadow-md"
              style={{ background: '#588157' }}
            >
              Adquirir POS
            </button>
          </div>
          <button aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={mobileMenuOpen} className="rounded-xl p-2 text-[#3b3733] hover:bg-[#f4f7f0] md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </nav>
        {mobileMenuOpen && (
          <div className="absolute w-full space-y-3 border-t border-[#a9b994]/20 bg-white px-6 py-5 shadow-lg lp-fade-in md:hidden">
            {[['#features','Funciones'],['#usage','Cómo funciona'],['#pricing','Precios'],['#faq','Preguntas']].map(([href,label]) => (
              <a key={href} href={href} className="block rounded-lg py-2 font-bold text-[#3b3733] hover:text-[#588157]" onClick={() => setMobileMenuOpen(false)}>{label}</a>
            ))}
            <div className="pt-4 flex flex-col gap-3">
              <button onClick={() => onEnterPOS(false)} className="w-full py-3 rounded-xl font-bold border border-[#a9b994] text-[#3b3733]">Iniciar Sesión</button>
              <button onClick={() => setDemoEmailModal(true)} className="w-full py-3 rounded-xl font-bold border border-[#a9b994] text-[#588157]">Probar Demo</button>
              <button onClick={() => { const el = document.getElementById('pricing'); if(el) el.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false); }} className="w-full py-3 rounded-xl font-bold text-white bg-[#588157]">Adquirir POS</button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO */}
        <section className="lp-hero-bg relative px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-12">
            <div className="text-center lg:col-span-5 lg:text-left">
            <div className="lp-slide-up mb-6 inline-flex items-center justify-center gap-2 rounded-full border border-[#a9b994]/50 bg-white px-4 py-1.5 text-[#588157] shadow-sm lg:justify-start">
              <Sparkles className="w-3.5 h-3.5 text-[#588157] animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest">SaborAI POS • Inteligencia Artificial Gastronómica</span>
            </div>

            <h1 className="lp-slide-up mb-6 text-4xl font-black leading-[1.08] tracking-tight text-[#3b3733] sm:text-5xl lg:text-[3.55rem] xl:text-6xl" style={{ animationDelay: '.1s' }}>
              El primer POS gastronómico <br className="hidden sm:block" />
              impulsado por <span className="lp-grad-text">Inteligencia Artificial</span>
            </h1>

            <p className="lp-slide-up mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-[#6b686d] sm:text-xl lg:mx-0" style={{ animationDelay: '.2s' }}>
              Conoce a <strong>Nyza Copilot</strong>: comanda por voz, previene quiebres de inventario, audita Hacienda DGT v4.4 en tiempo real y repara fallos técnicos sin necesidad de soporte humano.
            </p>

            <div className="lp-slide-up mb-0 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-start" style={{ animationDelay: '.3s' }}>
              <button
                onClick={() => { const el = document.getElementById('pricing'); if(el) el.scrollIntoView({ behavior: 'smooth' }); }}
                className="lp-button flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-7 py-4 font-black text-white shadow-lg shadow-[#588157]/20 sm:w-auto"
                style={{ background: '#588157' }}
              >
                Comenzar Prueba Gratis (14 Días) <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDemoEmailModal(true)}
                className="lp-button flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[#a9b994]/60 bg-white px-7 py-4 font-bold text-[#3b3733] shadow-sm hover:bg-[#f4f7f0] sm:w-auto"
              >
                <Play className="w-4 h-4 text-[#588157]" /> Ver Demo Interactivo
              </button>
              <a data-whatsapp-cta href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="lp-whatsapp lp-button inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#588157]/25 bg-[#f4f7f0] px-6 py-4 font-bold text-[#3b3733] hover:bg-[#e8ece1] sm:w-auto">
                <WhatsAppMark className="lp-whatsapp-icon h-5 w-5 text-[#588157]" /> Escríbenos por WhatsApp
              </a>
            </div>

            </div>
            <div className="lp-slide-up lg:col-span-7" style={{ animationDelay: '.25s' }}>
            {/* Interactive Live POS + Nyza AI Mockup Component */}
            <div className="mx-auto max-w-none overflow-hidden rounded-3xl border border-stone-800 bg-stone-900 text-left shadow-2xl ring-1 ring-white/10">
              {/* Window Header */}
              <div className="px-5 py-3.5 bg-stone-950 border-b border-stone-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  <span className="text-xs font-mono text-stone-400 ml-2">saborai-pos.cr • Terminal Mesa 4</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#a9b994]/20 text-[#a9b994] border border-[#a9b994]/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Nyza IA Activa
                  </span>
                </div>
              </div>

              {/* Mockup Operational Content */}
              <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 bg-gradient-to-b from-stone-900 to-stone-950 text-white">
                {/* Left Column: POS Order Preview */}
                <div className="md:col-span-7 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-stone-800">
                    <div>
                      <span className="text-xs font-bold text-[#a9b994] uppercase tracking-wider">Mesa 4 • Terraza</span>
                      <h4 className="text-lg font-black text-white">Orden Actual (Comanda #1042)</h4>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl bg-stone-800 text-stone-300 text-xs font-bold">2 Comensales</span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center p-3 rounded-2xl bg-stone-800/60 border border-stone-700/50">
                      <div>
                        <div className="font-bold text-stone-100">1x Ribeye Steak 350g Angus</div>
                        <div className="text-xs text-stone-400">Término Medio • Salsa Pimienta</div>
                      </div>
                      <span className="font-mono font-bold text-[#a9b994]">₡16,500</span>
                    </div>

                    <div className="flex justify-between items-center p-3 rounded-2xl bg-stone-800/60 border border-stone-700/50">
                      <div>
                        <div className="font-bold text-stone-100">1x Ceviche Corvina Reina</div>
                        <div className="text-xs text-stone-400">Patacones y aguacate</div>
                      </div>
                      <span className="font-mono font-bold text-[#a9b994]">₡7,800</span>
                    </div>

                    {/* AI Prompted upsell chip */}
                    <div className="p-3 rounded-2xl bg-[#588157]/15 border border-[#a9b994]/30 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-4 h-4 text-[#a9b994] shrink-0" />
                        <span className="text-xs text-stone-200">
                          <strong>Sugerencia Nyza:</strong> ¿Ofrecer Maridaje Copa Malbec (+₡4,500)?
                        </span>
                      </div>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg bg-[#a9b994] text-stone-900 shrink-0">
                        Upsell +18%
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-stone-800 flex items-center justify-between text-xs text-stone-400">
                    <span>Hacienda DGT: Clave 50 dígitos lista</span>
                    <span className="text-stone-200 font-bold">Total: <strong className="text-emerald-400 font-mono text-base">₡27,459</strong> (IVA + Serv)</span>
                  </div>
                </div>

                {/* Right Column: Nyza AI Live Agent Insights */}
                <div className="md:col-span-5 bg-stone-950/80 rounded-2xl p-5 border border-stone-800 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <BrainCircuit className="w-5 h-5 text-[#a9b994]" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Acciones Nyza IA</span>
                    </div>

                    <div className="space-y-3">
                      <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs">
                        <div className="flex items-center gap-1.5 text-[#a9b994] font-bold mb-1">
                          <Mic className="w-3.5 h-3.5" /> Comanda por Voz Activa
                        </div>
                        <p className="text-stone-300 text-[11px]">
                          "Agrega dos cervezas Imperial y cuenta separada para el cliente 2"
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs">
                        <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-1">
                          <Zap className="w-3.5 h-3.5" /> Predicción de Inventario
                        </div>
                        <p className="text-stone-300 text-[11px]">
                          Quedan 4 porciones de Ribeye. Alerta emitida a cocina y barra.
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-bold mb-1">
                          <ShieldCheck className="w-3.5 h-3.5" /> Autodiagnóstico 24/7
                        </div>
                        <p className="text-stone-300 text-[11px]">
                          0 errores en red local. Base de datos sincronizada al 100%.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-stone-800/80 text-[11px] text-stone-400 flex items-center justify-between">
                    <span>Modo Mesh Offline</span>
                    <span className="text-emerald-400 font-bold">● En Línea</span>
                  </div>
                </div>
              </div>
            </div>

            </div>
            <div className="lp-slide-up lg:col-span-12 mt-0 flex flex-wrap items-center justify-center gap-3 text-xs font-bold uppercase tracking-wider text-[#588157] sm:gap-4" style={{ animationDelay: '.4s' }}>
              {['Comanda por Voz con Nyza', 'Predicción de Mermas', 'Hacienda v4.4 en 1 Clic', 'Red Mesh Local Offline', 'Pagos Tilopay & WhatsApp'].map((t) => (
                <span key={t} className="flex items-center gap-1.5 bg-white/80 px-3.5 py-1.5 rounded-full border border-[#a9b994]/30 shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#588157]" /> {t}
                </span>
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
                <button onClick={() => setSelectedPlanModal(pl.id)} className={`w-full py-4 rounded-xl font-bold transition-all ${pl.popular ? 'bg-[#588157] text-white hover:opacity-90 shadow-md' : 'bg-[#f4f7f0] text-[#3b3733] hover:bg-[#e8ece1]'}`}>
                  {pl.buttonText}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="lp-faq border-y border-[#a9b994]/20 bg-[#f4f7f0] px-4 py-20 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-4xl">
            <div className="mb-10 text-center">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#588157]">Resolvemos tus dudas</p>
              <h2 className="text-3xl font-black text-[#3b3733] sm:text-4xl">Preguntas <span className="text-[#588157]">frecuentes</span></h2>
            </div>
            <div className="space-y-3">
              {[
                { q: '¿Para qué tipo de negocio está diseñado Saborai POS?', a: 'Saborai POS está diseñado para restaurantes y negocios gastronómicos que quieren simplificar su operación, caja, comandas y gestión.' },
                { q: '¿Qué hace Nyza Copilot?', a: 'Nyza Copilot incorpora asistencia con IA en tareas como la comanda por voz, alertas de inventario y apoyo para detectar incidencias operativas.' },
                { q: '¿Saborai POS trabaja con facturación electrónica de Hacienda?', a: 'La plataforma incluye herramientas de facturación e integración vinculadas a Hacienda Costa Rica. Escríbenos para revisar los detalles que aplican a tu negocio.' },
                { q: '¿Puedo conocer los planes y probar el sistema?', a: 'La página muestra los planes Express, Pro y Multi-Sucursal, además de una prueba de 14 días. En la sección de precios puedes revisar las opciones o consultarnos directamente.' },
                { q: '¿Cómo funciona la red local cuando hay problemas de conexión?', a: 'Saborai POS cuenta con un modo Red Mesh Local Offline. La configuración depende de los dispositivos y de la operación del local; podemos orientarte por WhatsApp.' },
              ].map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-[#a9b994]/30 bg-white px-5 py-4 shadow-sm sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-bold text-[#3b3733] outline-none focus-visible:ring-2 focus-visible:ring-[#588157] focus-visible:ring-offset-2">
                    <span>{q}</span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-[#588157] transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="pt-3 pr-7 text-sm leading-relaxed text-[#6b686d]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="contact" className="relative overflow-hidden bg-[#3b3733] px-4 py-20 text-center text-white sm:py-24">
          <div className="absolute inset-0 bg-[#588157]/10" />
          <div className="relative z-10 max-w-3xl mx-auto">
            <h2 className="mb-5 text-3xl font-black sm:text-4xl">Simplifica la gestión hoy mismo.</h2>
            <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">Únete a la evolución del software gastronómico en Costa Rica. Sin permanencia.</p>
            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <button onClick={() => { const el = document.getElementById('pricing'); if(el) el.scrollIntoView({ behavior: 'smooth' }); }} className="lp-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 font-black text-[#3b3733] shadow-xl hover:shadow-2xl">
                Probar 14 Días Gratis <ArrowRight className="h-5 w-5 text-[#588157]" />
              </button>
              <a data-whatsapp-cta href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="lp-whatsapp lp-button inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-8 py-4 font-bold text-white hover:bg-white/15">
                <WhatsAppMark className="lp-whatsapp-icon h-5 w-5" /> Hablemos por WhatsApp
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#a9b994]/25 bg-[#fcfeff] px-4 py-12 text-sm text-[#6b686d] sm:px-6 lg:py-14">
        <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <BrandLogo variant="full" size="sm" tone="web" />
            <p className="mt-4 max-w-md leading-relaxed">Software de Punto de Venta con IA para Restaurantes en Costa Rica. Facturación Hacienda y Tilopay Integrado.</p>
          </div>
          <div>
            <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-[#3b3733]">Explora</h2>
            <nav aria-label="Enlaces del pie de página" className="flex flex-col items-start gap-3 text-sm">
              <a href="#features" className="transition-colors hover:text-[#588157]">Funciones</a>
              <a href="#pricing" className="transition-colors hover:text-[#588157]">Planes y precios</a>
              <a href="#faq" className="transition-colors hover:text-[#588157]">Preguntas frecuentes</a>
              <a href="/privacy-policy" className="transition-colors hover:text-[#588157]">Política de Privacidad</a>
              <a href="/terms-of-service" className="transition-colors hover:text-[#588157]">Condiciones de Servicio</a>
            </nav>
          </div>
          <div>
            <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-[#3b3733]">Contacto</h2>
            <a data-whatsapp-cta href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="lp-whatsapp inline-flex items-center gap-2 font-semibold text-[#588157] transition-colors hover:text-[#3b3733]">
              <WhatsAppMark className="lp-whatsapp-icon h-5 w-5" /> WhatsApp {WHATSAPP_DISPLAY_NUMBER}
            </a>
            <a href="#contact" className="mt-3 block text-sm transition-colors hover:text-[#588157]">Conoce Saborai POS</a>
          </div>
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-col gap-2 border-t border-[#a9b994]/20 pt-6 text-xs text-[#8e9d7c] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Saborai POS Costa Rica. Todos los derechos reservados.</p>
          <p>Propiedad de Maikol Rafael Matamoros Fernández · Programa diseñado por Maikol Matamoros</p>
        </div>
      </footer>

      {!hideWhatsAppFab && (
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contactar a Saborai por WhatsApp"
          title="Contactar a Saborai por WhatsApp"
          className="lp-wa-fab group fixed bottom-5 right-5 z-[55] flex h-14 w-14 items-center justify-center rounded-full bg-[#588157] text-white shadow-xl shadow-[#3b3733]/20 outline-none transition-all hover:-translate-y-1 hover:bg-[#496f48] hover:shadow-2xl focus-visible:ring-4 focus-visible:ring-[#a9b994] focus-visible:ring-offset-2 sm:bottom-7 sm:right-7"
        >
          <WhatsAppMark className="h-7 w-7" />
          <span aria-hidden="true" className="lp-wa-tooltip pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-xl border border-[#a9b994]/30 bg-white px-3.5 py-2 text-sm font-bold text-[#3b3733] shadow-lg">
            ¿Hablamos?
          </span>
        </a>
      )}
      
      {/* MODAL TILOPAY DIRECTO */}
      {selectedPlanModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#3b3733]/40 backdrop-blur-sm lp-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setSelectedPlanModal(null)} className="absolute top-5 right-5 text-[#a9b994] hover:text-[#3b3733]">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-[#f4f7f0]"><CreditCard className="w-6 h-6 text-[#588157]" /></div>
              <div>
                <h3 className="text-lg font-black text-[#3b3733]">Registro de Cuenta</h3>
                <p className="text-xs text-[#6b686d]">Plan seleccionado: {selectedPlanModal.toUpperCase()}</p>
              </div>
            </div>
            
            {showSuccessOnboarding ? (
              <div className="text-center py-10 space-y-4">
                <CheckCircle2 className="w-16 h-16 text-[#588157] mx-auto animate-bounce" />
                <h4 className="text-2xl font-black text-[#3b3733]">¡Bienvenido a Saborai!</h4>
                <p className="text-sm text-[#6b686d]">Iniciando tu sesión de inmediato...</p>
              </div>
            ) : (
              <form onSubmit={handleDirectRegistrationAndPayment} className="space-y-4">
                {checkoutError && (
                  <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm text-center font-medium">
                    {checkoutError}
                  </div>
                )}
                <div className="space-y-3">
                  <input required type="text" placeholder="Nombre de tu Restaurante" value={restaurantName} onChange={e=>setRestaurantName(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
                  <input required type="text" placeholder="Tu Nombre Completo" value={ownerName} onChange={e=>setOwnerName(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
                  <input required type="email" placeholder="Correo Electrónico (Tu usuario)" value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
                  <input required type="tel" placeholder="Número de Teléfono (WhatsApp)" value={phone} onChange={e=>setPhone(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
                  <input required type="password" placeholder="Crea tu Contraseña" value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
                </div>

                <div className="bg-[#f4f7f0] p-4 rounded-2xl text-center border border-[#a9b994]/30 mt-4">
                  <ShieldCheck className="w-6 h-6 text-[#588157] mx-auto mb-2" />
                  <p className="text-xs text-[#6b686d] leading-relaxed">
                    Al continuar, crearás tu cuenta de Saborai y serás redirigido a TiloPay para realizar el primer pago de tu mensualidad de forma segura.
                  </p>
                </div>

                <button type="submit" className="w-full py-4 mt-2 bg-[#588157] text-white rounded-xl font-bold hover:scale-[1.02] shadow-md transition-transform flex items-center justify-center gap-2">
                  <span>Ir al Pago Seguro</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL DEMO EMAIL CAPTURE */}
      {demoEmailModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#3b3733]/40 backdrop-blur-sm lp-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl relative">
            <button onClick={() => setDemoEmailModal(false)} className="absolute top-5 right-5 text-[#a9b994] hover:text-[#3b3733]">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-[#f4f7f0]"><Play className="w-6 h-6 text-[#588157]" /></div>
              <div>
                <h3 className="text-lg font-black text-[#3b3733]">Ingresar al Demo</h3>
                <p className="text-xs text-[#6b686d]">Descubre el POS con IA</p>
              </div>
            </div>
            <form onSubmit={handleDemoSubmit} className="space-y-4">
              <p className="text-sm text-[#6b686d] mb-4">
                Ingresa tu correo para acceder directamente al entorno de demostración de Saborai POS.
              </p>
              <input required type="email" placeholder="Tu Correo Electrónico" value={demoEmail} onChange={e=>setDemoEmail(e.target.value)} className="w-full p-3 rounded-xl border border-[#a9b994]/40 bg-[#f4f7f0] outline-none focus:border-[#588157] text-sm" />
              <button type="submit" disabled={isSubmittingDemo} className="w-full py-3 bg-[#588157] text-white rounded-xl font-bold hover:scale-[1.02] shadow-md transition-transform disabled:opacity-70">
                {isSubmittingDemo ? 'Iniciando...' : 'Comenzar Demo'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
