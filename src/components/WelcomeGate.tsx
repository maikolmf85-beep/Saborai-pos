import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import {
  Sparkles, CreditCard, ShieldCheck, CheckCircle2,
  ArrowRight, Eye, LogIn, EyeOff, Lock, Mail
} from 'lucide-react';
import { tilopayService } from '../services/tilopayService';
import { UserProfile, TenantInfo } from '../types';
import { notionService } from '../services/notionService';

export interface SaboraiSubscription {
  mode: 'DEMO' | 'TRIAL' | 'ACTIVE';
  email?: string;
  restaurantName?: string;
  plan?: string;
  trialEndsAt?: string;
  activatedAt: string;
}

type GateView =
  | 'WELCOME'
  | 'DEMO_FORM'
  | 'TRIAL_STEP1'
  | 'TRIAL_STEP2'
  | 'TRIAL_SUCCESS'
  | 'LOGIN_FORM';

interface WelcomeGateProps {
  onSubscriptionActivated: (sub: SaboraiSubscription, user: UserProfile, tenant: TenantInfo) => void;
}

/* ─── Shared UI primitives (outside component to prevent re-mount on render) ── */

const FIELD_CLASS = "w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm transition-colors disabled:opacity-50";
const LABEL_CLASS = "block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5";

const ErrorBox: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-xs text-red-400 mb-4">⚠️ {msg}</div>
);

const BackBtn: React.FC<{ onClick: () => void; label?: string; disabled?: boolean }> = ({
  onClick, label = '← Volver', disabled = false
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="text-stone-500 hover:text-stone-300 text-sm mb-6 flex items-center gap-1.5 transition-colors disabled:opacity-40"
  >
    {label}
  </button>
);

const CardWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex items-center justify-center p-4 sm:p-6">
    <div className="bg-stone-900/70 border border-stone-700/40 rounded-3xl p-7 sm:p-9 max-w-md w-full shadow-2xl backdrop-blur-sm">
      {children}
    </div>
  </div>
);

/* ─── Helper: create demo tenant & user ─────────────────────── */
function buildDemoSession(email: string, restaurantName = 'Mi Restaurante Demo'): { user: UserProfile; tenant: TenantInfo } {
  const user: UserProfile = {
    id: `usr_demo_${Date.now()}`,
    name: 'Administrador Demo',
    email: email.trim().toLowerCase(),
    phone: '+506 0000-0000',
    restaurantName,
    role: 'ADMIN',
    active: true,
  };
  const tenant: TenantInfo = {
    id: `tenant_demo_${Date.now()}`,
    name: restaurantName,
    cedulaJuridica: '3-101-000000',
    email: email.trim().toLowerCase(),
    phone: '+506 0000-0000',
    location: 'Costa Rica',
    plan: 'pro',
    status: 'ACTIVE',
    currency: 'CRC',
    monthlyFee: 45000,
  };
  return { user, tenant };
}

export const WelcomeGate: React.FC<WelcomeGateProps> = ({ onSubscriptionActivated }) => {
  const [view, setView] = useState<GateView>('WELCOME');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  /* ── Demo fields ──────────── */
  const [demoEmail, setDemoEmail] = useState('');

  /* ── Trial Step 1 fields ──── */
  const [restaurantName, setRestaurantName] = useState('');
  const [trialEmail, setTrialEmail] = useState('');
  const [trialEmailConfirm, setTrialEmailConfirm] = useState('');
  const [trialPhone, setTrialPhone] = useState('');
  const [trialPassword, setTrialPassword] = useState('');

  /* ── Trial Step 2 (card) ──── */
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpMonth, setCardExpMonth] = useState('');
  const [cardExpYear, setCardExpYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');

  /* ── Login fields ─────────── */
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  /* ─────────────────────────────────────────────────────────── */
  /*  HANDLERS                                                   */
  /* ─────────────────────────────────────────────────────────── */

  const resetError = () => { setError(null); };

  /* Demo submit */
  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoEmail.trim() || !demoEmail.includes('@')) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }
    const { user, tenant } = buildDemoSession(demoEmail.trim());
    try {
      localStorage.setItem('saborai_user', JSON.stringify(user));
      localStorage.setItem('saborai_tenant', JSON.stringify(tenant));
    } catch {}
    const sub: SaboraiSubscription = { mode: 'DEMO', email: demoEmail.trim(), activatedAt: new Date().toISOString() };
    onSubscriptionActivated(sub, user, tenant);
  };

  /* Trial Step 1 */
  const handleTrialStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (trialEmail !== trialEmailConfirm) {
      setError('Los correos electrónicos no coinciden.');
      return;
    }
    if (trialPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    resetError();
    setView('TRIAL_STEP2');
  };

  /* Trial Step 2 – card payment */
  const handleTrialPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    resetError();
    try {
      const token = await tilopayService.tokenizeCard({
        cardNumber,
        expMonth: cardExpMonth,
        expYear: cardExpYear,
        cvv: cardCvv,
        cardholderName: cardName,
      });
      const response = await tilopayService.createSubscription('pro', token, trialEmail);
      if (response.success) {
        /* Build user & tenant */
        const user: UserProfile = {
          id: `usr_${Date.now()}`,
          name: restaurantName.trim(),
          email: trialEmail.trim().toLowerCase(),
          phone: trialPhone.trim(),
          restaurantName: restaurantName.trim(),
          role: 'ADMIN',
          active: true,
        };
        const tenant: TenantInfo = {
          id: `tenant_${Date.now()}`,
          name: restaurantName.trim(),
          cedulaJuridica: '3-101-998877',
          email: trialEmail.trim().toLowerCase(),
          phone: trialPhone.trim(),
          location: 'Costa Rica',
          plan: 'pro',
          status: 'ACTIVE',
          currency: 'CRC',
          monthlyFee: 45000,
        };
        try {
          localStorage.setItem('saborai_user', JSON.stringify({ ...user, password: trialPassword }));
          localStorage.setItem('saborai_tenant', JSON.stringify(tenant));
        } catch {}
        notionService.recordUserRegistration(user, tenant).catch(() => {});
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);
        const sub: SaboraiSubscription = {
          mode: 'TRIAL',
          email: trialEmail,
          restaurantName: restaurantName,
          plan: 'pro',
          trialEndsAt: trialEnd.toISOString(),
          activatedAt: new Date().toISOString(),
        };
        setView('TRIAL_SUCCESS');
        setTimeout(() => onSubscriptionActivated(sub, user, tenant), 2200);
      } else {
        setError(response.error || 'Error al procesar el pago. Intenta nuevamente.');
        setIsProcessing(false);
      }
    } catch (err: any) {
      setError(err.message || 'Error de conexión con el servicio de pagos.');
      setIsProcessing(false);
    }
  };

  /* Login — validación estricta de email + contraseña */
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    resetError();
    setIsProcessing(true);

    setTimeout(() => {
      try {
        const savedUserRaw = localStorage.getItem('saborai_user');
        const savedTenantRaw = localStorage.getItem('saborai_tenant');

        if (!savedUserRaw || !savedTenantRaw) {
          // No hay ningún usuario registrado en este dispositivo
          setIsProcessing(false);
          setError('No encontramos una cuenta en este dispositivo. Crea una cuenta primero.');
          setView('TRIAL_STEP1');
          return;
        }

        const savedUser = JSON.parse(savedUserRaw);
        const savedTenant = JSON.parse(savedTenantRaw);
        const emailMatch = savedUser.email?.toLowerCase() === loginEmail.trim().toLowerCase();

        if (!emailMatch) {
          setIsProcessing(false);
          setError('No existe una cuenta con ese correo. ¿Quieres crear una cuenta nueva?');
          return;
        }

        // Email encontrado — verificar contraseña
        const passwordMatch = savedUser.password && savedUser.password === loginPassword;
        if (!passwordMatch) {
          setIsProcessing(false);
          setError('Contraseña incorrecta. Verifica tus datos e intenta nuevamente.');
          return;
        }

        // Credenciales correctas ✅
        setIsProcessing(false);
        const sub: SaboraiSubscription = { mode: 'ACTIVE', email: savedUser.email, activatedAt: new Date().toISOString() };
        onSubscriptionActivated(sub, savedUser, savedTenant);

      } catch {
        setIsProcessing(false);
        setError('Error al verificar tus credenciales. Intenta nuevamente.');
      }
    }, 700);
  };


  /* ─────────────────────────────────────────────────────────── */
  /*  VIEWS                                                      */
  /* ─────────────────────────────────────────────────────────── */

  /* ── WELCOME ──────────────────────────────────────────────── */
  if (view === 'WELCOME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#a9b994]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-[#a9b994]/8 rounded-full blur-3xl pointer-events-none" />

        <div className="mb-10 p-3 rounded-2xl bg-white/8 border border-white/15 backdrop-blur-sm">
          <BrandLogo variant="full" size="lg" />
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-white text-center mb-4 tracking-tight leading-tight">
          Bienvenido a<br className="hidden sm:block" />{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#a9b994] to-[#d4e0c9]">Saborai POS</span>
        </h1>
        <p className="text-stone-400 text-center max-w-md mb-14 text-base leading-relaxed">
          El punto de venta gastronómico más avanzado de Costa Rica. ¿Cómo quieres comenzar?
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl w-full">
          {/* Demo */}
          <div className="group flex flex-col p-6 rounded-2xl bg-white/4 border border-white/10 hover:border-white/20 hover:bg-white/6 transition-all duration-200">
            <div className="w-12 h-12 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center mb-5 group-hover:bg-stone-700 transition-colors">
              <Eye className="w-6 h-6 text-stone-300" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Explorar sin compromiso</h3>
            <p className="text-stone-500 text-sm leading-relaxed flex-1 mb-6">
              Prueba todas las funciones ahora mismo. Solo necesitas tu correo. Los datos son de ejemplo.
            </p>
            <button
              onClick={() => { resetError(); setView('DEMO_FORM'); }}
              className="w-full py-3 border border-stone-700 text-stone-400 rounded-xl font-semibold text-sm hover:border-stone-500 hover:text-stone-200 transition-all"
            >
              Modo Demo
            </button>
          </div>

          {/* Trial */}
          <div className="flex flex-col p-6 rounded-2xl bg-[#a9b994]/10 border-2 border-[#a9b994]/50 relative shadow-xl shadow-[#a9b994]/5">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#a9b994] text-stone-900 text-xs font-bold rounded-full uppercase tracking-wider shadow-md flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Más Popular
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#a9b994]/20 border border-[#a9b994]/30 flex items-center justify-center mb-5">
              <Sparkles className="w-6 h-6 text-[#a9b994]" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Prueba Gratis 14 Días</h3>
            <p className="text-stone-300 text-sm leading-relaxed flex-1 mb-6">
              Acceso completo. Requiere tarjeta, pero <strong className="text-white">no se te cobra hoy</strong>. Cancela cuando quieras.
            </p>
            <button
              onClick={() => { resetError(); setView('TRIAL_STEP1'); }}
              className="w-full py-3 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#a9b994]/20"
            >
              <span>Comenzar Prueba</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Login */}
          <div className="group flex flex-col p-6 rounded-2xl bg-white/4 border border-white/10 hover:border-white/20 hover:bg-white/6 transition-all duration-200">
            <div className="w-12 h-12 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center mb-5 group-hover:bg-stone-700 transition-colors">
              <LogIn className="w-6 h-6 text-stone-300" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Ya tengo cuenta</h3>
            <p className="text-stone-500 text-sm leading-relaxed flex-1 mb-6">
              Si ya eres cliente activo de Saborai, inicia sesión con tu correo y contraseña.
            </p>
            <button
              onClick={() => { resetError(); setView('LOGIN_FORM'); }}
              className="w-full py-3 border border-stone-700 text-stone-400 rounded-xl font-semibold text-sm hover:border-stone-500 hover:text-stone-200 transition-all"
            >
              Iniciar Sesión
            </button>
          </div>
        </div>

        <p className="mt-10 text-stone-600 text-xs text-center">
          Pagos seguros con Tilopay · Facturación Hacienda CR v4.3 · Soporte en Costa Rica
        </p>
      </div>
    );
  }

  /* ── DEMO FORM ────────────────────────────────────────────── */
  if (view === 'DEMO_FORM') {
    return (
      <CardWrapper>
        <BackBtn onClick={() => { resetError(); setView('WELCOME'); }} />
        <div className="flex items-center gap-3 mb-7">
          <div className="p-2 rounded-xl bg-stone-700/50 border border-stone-600">
            <Eye className="w-5 h-5 text-stone-300" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Modo Demo</h2>
            <p className="text-xs text-stone-500">Explora Saborai POS sin compromiso</p>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}

        <form onSubmit={handleDemoSubmit} className="space-y-5">
          <div>
            <label className={LABEL_CLASS}>Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
              <input
                type="email"
                required
                placeholder="tucorreo@ejemplo.com"
                value={demoEmail}
                onChange={(e) => setDemoEmail(e.target.value)}
                className={`${FIELD_CLASS} pl-10`}
              />
            </div>
            <p className="text-xs text-stone-600 mt-1.5 ml-1">Solo necesitamos tu correo para identificar tu sesión demo.</p>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-stone-700 text-white rounded-xl font-bold text-sm hover:bg-stone-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-2"
          >
            <Eye className="w-4 h-4" />
            <span>Entrar en Modo Demo</span>
          </button>
        </form>

        <p className="text-xs text-stone-600 text-center mt-5">
          ⚠️ En modo demo los datos no son permanentes y se usan datos de ejemplo.
        </p>
      </CardWrapper>
    );
  }

  /* ── TRIAL STEP 1 ─────────────────────────────────────────── */
  if (view === 'TRIAL_STEP1') {
    return (
      <CardWrapper>
        <BackBtn onClick={() => { resetError(); setView('WELCOME'); }} />
        <div className="flex items-center gap-3 mb-7">
          <div className="p-2 rounded-xl bg-[#a9b994]/15 border border-[#a9b994]/30">
            <Sparkles className="w-5 h-5 text-[#a9b994]" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Paso 1: Tus Datos</h2>
            <p className="text-xs text-stone-500">Prueba de 14 días · Sin cargo hoy</p>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}

        <form onSubmit={handleTrialStep1} className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Nombre del Restaurante</label>
            <input type="text" required placeholder="Ej. Café & Bistro Escalante" value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Teléfono</label>
            <input type="tel" required placeholder="+506 8888-0000" value={trialPhone} onChange={(e) => setTrialPhone(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Correo Electrónico</label>
            <input type="email" required placeholder="gerencia@mirestaurante.cr" value={trialEmail} onChange={(e) => setTrialEmail(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Confirmar Correo</label>
            <input type="email" required placeholder="Vuelve a ingresar tu correo" value={trialEmailConfirm} onChange={(e) => setTrialEmailConfirm(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Contraseña (mín. 6 caracteres)</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                placeholder="Tu contraseña de acceso"
                value={trialPassword}
                onChange={(e) => setTrialPassword(e.target.value)}
                className={`${FIELD_CLASS} pr-10`}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button type="submit" className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-[#a9b994]/15">
            <span>Continuar al Pago Seguro</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </CardWrapper>
    );
  }

  /* ── TRIAL STEP 2 (Payment) ───────────────────────────────── */
  if (view === 'TRIAL_STEP2') {
    return (
      <CardWrapper>
        <BackBtn onClick={() => { resetError(); setIsProcessing(false); setView('TRIAL_STEP1'); }} disabled={isProcessing} />
        <div className="flex items-center gap-3 mb-7">
          <div className="p-2 rounded-xl bg-[#a9b994]/15 border border-[#a9b994]/30">
            <CreditCard className="w-5 h-5 text-[#a9b994]" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Paso 2: Pago Seguro</h2>
            <p className="text-xs text-stone-500">Tilopay · ₡0 durante los 14 días de prueba</p>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}

        <form onSubmit={handleTrialPayment} className="space-y-4">
          <div>
            <label className={`${LABEL_CLASS} flex items-center gap-1.5`}><CreditCard className="w-3.5 h-3.5" /> Número de Tarjeta</label>
            <input type="text" required maxLength={19} placeholder="4000 1234 5678 9010" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} disabled={isProcessing} className={FIELD_CLASS} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Expira (MM / YY)</label>
              <div className="flex items-center gap-2">
                <input type="text" required maxLength={2} placeholder="MM" value={cardExpMonth} onChange={(e) => setCardExpMonth(e.target.value)} disabled={isProcessing} className={`${FIELD_CLASS} text-center`} />
                <span className="text-stone-500">/</span>
                <input type="text" required maxLength={2} placeholder="YY" value={cardExpYear} onChange={(e) => setCardExpYear(e.target.value)} disabled={isProcessing} className={`${FIELD_CLASS} text-center`} />
              </div>
            </div>
            <div>
              <label className={LABEL_CLASS}>CVV</label>
              <input type="password" required maxLength={4} placeholder="•••" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} disabled={isProcessing} className={FIELD_CLASS} />
            </div>
          </div>
          <div>
            <label className={LABEL_CLASS}>Nombre en Tarjeta</label>
            <input type="text" required placeholder="Como aparece en la tarjeta" value={cardName} onChange={(e) => setCardName(e.target.value)} disabled={isProcessing} className={FIELD_CLASS} />
          </div>

          <div className="p-4 rounded-xl bg-[#a9b994]/8 border border-[#a9b994]/25 flex items-center justify-between">
            <div>
              <span className="font-bold text-white text-sm block">Plan Pro · 14 Días Gratis</span>
              <span className="text-stone-500 text-xs">Luego ₡45,000 / mes · Cancela cuando quieras</span>
            </div>
            <span className="text-[#a9b994] font-black text-lg">₡0</span>
          </div>

          <div className="flex items-start gap-2.5 text-xs text-stone-500">
            <ShieldCheck className="w-4 h-4 text-[#a9b994] shrink-0 mt-0.5" />
            <span>Datos procesados de forma segura por Tilopay. Tu tarjeta es tokenizada y no se realiza ningún cobro durante la prueba.</span>
          </div>

          <button type="submit" disabled={isProcessing} className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-[#a9b994]/15">
            {isProcessing ? <span className="animate-pulse">Procesando con Tilopay...</span> : <><CreditCard className="w-4 h-4" /><span>Activar Prueba Gratuita de 14 Días</span></>}
          </button>
        </form>
      </CardWrapper>
    );
  }

  /* ── TRIAL SUCCESS ────────────────────────────────────────── */
  if (view === 'TRIAL_SUCCESS') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex flex-col items-center justify-center p-6">
        <div className="text-center animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-[#a9b994]/15 border-2 border-[#a9b994]/40 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-14 h-14 text-[#a9b994]" />
          </div>
          <h2 className="text-3xl font-black text-white mb-3">¡Prueba Activada!</h2>
          <p className="text-stone-400 max-w-xs mx-auto text-sm leading-relaxed">
            Tu periodo de 14 días comenzó hoy. Redirigiendo a Saborai POS...
          </p>
        </div>
      </div>
    );
  }

  /* ── LOGIN FORM ───────────────────────────────────────────── */
  return (
    <CardWrapper>
      <BackBtn onClick={() => { resetError(); setView('WELCOME'); }} />
      <div className="flex items-center gap-3 mb-7">
        <div className="p-2 rounded-xl bg-stone-700/50 border border-stone-600">
          <Lock className="w-5 h-5 text-stone-300" />
        </div>
        <div>
          <h2 className="text-xl font-black text-white">Iniciar Sesión</h2>
          <p className="text-xs text-stone-500">Accede con tu correo y contraseña</p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-950/50 border border-red-800/50 rounded-xl text-xs text-red-400 mb-4 space-y-2">
          <p>⚠️ {error}</p>
          {(error.includes('cuenta con ese correo') || error.includes('cuenta en este dispositivo')) && (
            <button
              type="button"
              onClick={() => { resetError(); setView('TRIAL_STEP1'); }}
              className="mt-1 w-full py-2 bg-[#a9b994] text-stone-900 rounded-lg font-bold text-xs hover:bg-[#bccaad] transition-colors"
            >
              Crear cuenta ahora →
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className={LABEL_CLASS}>Correo Electrónico</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
            <input
              type="email"
              required
              placeholder="tucorreo@restaurante.cr"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              disabled={isProcessing}
              className={`${FIELD_CLASS} pl-10`}
            />
          </div>
        </div>
        <div>
          <label className={LABEL_CLASS}>Contraseña</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Tu contraseña"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              disabled={isProcessing}
              className={`${FIELD_CLASS} pl-10 pr-10`}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isProcessing}
          className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 mt-2 shadow-lg shadow-[#a9b994]/15"
        >
          {isProcessing ? <span className="animate-pulse">Verificando...</span> : <><LogIn className="w-4 h-4" /><span>Iniciar Sesión</span></>}
        </button>
      </form>

      <p className="text-xs text-stone-600 text-center mt-5">
        ¿No tienes cuenta aún? <button onClick={() => { resetError(); setView('TRIAL_STEP1'); }} className="text-[#a9b994] hover:underline font-semibold">Inicia tu prueba gratis</button>
      </p>
    </CardWrapper>
  );
};
