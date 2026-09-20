import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import {
  Sparkles, CreditCard, ShieldCheck, CheckCircle2,
  ArrowRight, Eye, LogIn
} from 'lucide-react';
import { tilopayService } from '../services/tilopayService';

export interface SaboraiSubscription {
  mode: 'DEMO' | 'TRIAL' | 'ACTIVE';
  email?: string;
  restaurantName?: string;
  plan?: string;
  trialEndsAt?: string;
  activatedAt: string;
}

interface WelcomeGateProps {
  onEnterDemo: () => void;
  onSubscriptionActivated: (sub: SaboraiSubscription) => void;
  onAlreadyHaveAccount: () => void;
}

type GateView = 'WELCOME' | 'STEP1' | 'STEP2' | 'SUCCESS';

export const WelcomeGate: React.FC<WelcomeGateProps> = ({
  onEnterDemo,
  onSubscriptionActivated,
  onAlreadyHaveAccount,
}) => {
  const [view, setView] = useState<GateView>('WELCOME');

  // Step 1 fields
  const [restaurantName, setRestaurantName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerEmailConfirm, setOwnerEmailConfirm] = useState('');

  // Step 2 (payment) fields
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpMonth, setCardExpMonth] = useState('');
  const [cardExpYear, setCardExpYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (ownerEmail !== ownerEmailConfirm) {
      setError('Los correos electrónicos no coinciden. Por favor verifica.');
      return;
    }
    setError(null);
    setView('STEP2');
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);
    try {
      const token = await tilopayService.tokenizeCard({
        cardNumber,
        expMonth: cardExpMonth,
        expYear: cardExpYear,
        cvv: cardCvv,
        cardholderName: cardName,
      });

      const response = await tilopayService.createSubscription('pro', token, ownerEmail);

      if (response.success) {
        setView('SUCCESS');
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);
        const sub: SaboraiSubscription = {
          mode: 'TRIAL',
          email: ownerEmail,
          restaurantName,
          plan: 'pro',
          trialEndsAt: trialEnd.toISOString(),
          activatedAt: new Date().toISOString(),
        };
        setTimeout(() => onSubscriptionActivated(sub), 2200);
      } else {
        setError(response.error || 'Error al procesar el pago. Intenta nuevamente.');
        setIsProcessing(false);
      }
    } catch (err: any) {
      setError(err.message || 'Error de conexión con el servicio de pagos.');
      setIsProcessing(false);
    }
  };

  /* ── WELCOME VIEW ─────────────────────────────────────────── */
  if (view === 'WELCOME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#a9b994]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-[#a9b994]/8 rounded-full blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="mb-10 p-3 rounded-2xl bg-white/8 border border-white/15 backdrop-blur-sm">
          <BrandLogo variant="full" size="lg" />
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-white text-center mb-4 tracking-tight leading-tight">
          Bienvenido a<br className="hidden sm:block" />{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#a9b994] to-[#d4e0c9]">
            Saborai POS
          </span>
        </h1>
        <p className="text-stone-400 text-center max-w-md mb-14 text-base leading-relaxed">
          El punto de venta gastronómico más avanzado de Costa Rica. ¿Cómo quieres comenzar?
        </p>

        {/* 3 Option Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl w-full">

          {/* Demo */}
          <div className="group flex flex-col p-6 rounded-2xl bg-white/4 border border-white/10 hover:border-white/20 hover:bg-white/6 transition-all duration-200">
            <div className="w-12 h-12 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center mb-5 group-hover:bg-stone-700 transition-colors">
              <Eye className="w-6 h-6 text-stone-300" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Explorar sin compromiso</h3>
            <p className="text-stone-500 text-sm leading-relaxed flex-1 mb-6">
              Prueba todas las funciones ahora mismo, sin crear una cuenta. Los datos son de ejemplo.
            </p>
            <button
              onClick={onEnterDemo}
              className="w-full py-3 border border-stone-700 text-stone-400 rounded-xl font-semibold text-sm hover:border-stone-500 hover:text-stone-200 transition-all"
            >
              Entrar en Modo Demo
            </button>
          </div>

          {/* Trial - Featured */}
          <div className="flex flex-col p-6 rounded-2xl bg-[#a9b994]/10 border-2 border-[#a9b994]/50 relative shadow-xl shadow-[#a9b994]/5">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#a9b994] text-stone-900 text-xs font-bold rounded-full uppercase tracking-wider shadow-md flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Más Popular
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#a9b994]/20 border border-[#a9b994]/30 flex items-center justify-center mb-5">
              <Sparkles className="w-6 h-6 text-[#a9b994]" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Prueba Gratis 14 Días</h3>
            <p className="text-stone-300 text-sm leading-relaxed flex-1 mb-6">
              Acceso completo al POS. Se requiere tarjeta, pero <strong className="text-white">no se te cobra hoy</strong>. Cancela cuando quieras.
            </p>
            <button
              onClick={() => { setError(null); setView('STEP1'); }}
              className="w-full py-3 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#a9b994]/20"
            >
              <span>Comenzar Prueba</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Existing account */}
          <div className="group flex flex-col p-6 rounded-2xl bg-white/4 border border-white/10 hover:border-white/20 hover:bg-white/6 transition-all duration-200">
            <div className="w-12 h-12 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center mb-5 group-hover:bg-stone-700 transition-colors">
              <LogIn className="w-6 h-6 text-stone-300" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Ya tengo cuenta</h3>
            <p className="text-stone-500 text-sm leading-relaxed flex-1 mb-6">
              Si ya eres cliente activo de Saborai, accede directamente con tu PIN de usuario.
            </p>
            <button
              onClick={onAlreadyHaveAccount}
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

  /* ── SUCCESS VIEW ─────────────────────────────────────────── */
  if (view === 'SUCCESS') {
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

  /* ── STEP 1: REGISTRATION ────────────────────────────────── */
  if (view === 'STEP1') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex items-center justify-center p-6">
        <div className="bg-stone-900/70 border border-stone-700/40 rounded-3xl p-7 sm:p-9 max-w-md w-full shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
          <button
            onClick={() => { setError(null); setView('WELCOME'); }}
            className="text-stone-500 hover:text-stone-300 text-sm mb-7 flex items-center gap-1.5 transition-colors"
          >
            ← Volver
          </button>

          <div className="flex items-center gap-3 mb-7">
            <div className="p-2 rounded-xl bg-[#a9b994]/15 border border-[#a9b994]/30">
              <Sparkles className="w-5 h-5 text-[#a9b994]" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white">Paso 1: Tus Datos</h2>
              <p className="text-xs text-stone-500">Prueba de 14 días · Sin cargo hoy</p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-xs text-red-400 mb-5">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleStep1} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">
                Nombre del Restaurante
              </label>
              <input
                type="text" required
                placeholder="Ej. Café & Bistro Escalante"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">
                Correo Electrónico
              </label>
              <input
                type="email" required
                placeholder="gerencia@restaurante.cr"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">
                Confirmar Correo
              </label>
              <input
                type="email" required
                placeholder="Vuelve a ingresar tu correo"
                value={ownerEmailConfirm}
                onChange={(e) => setOwnerEmailConfirm(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm transition-colors"
              />
            </div>
            <button
              type="submit"
              className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-[#a9b994]/15"
            >
              <span>Continuar al Pago Seguro</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── STEP 2: PAYMENT ─────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex items-center justify-center p-6">
      <div className="bg-stone-900/70 border border-stone-700/40 rounded-3xl p-7 sm:p-9 max-w-md w-full shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
        <button
          onClick={() => { setError(null); setIsProcessing(false); setView('STEP1'); }}
          disabled={isProcessing}
          className="text-stone-500 hover:text-stone-300 text-sm mb-7 flex items-center gap-1.5 transition-colors disabled:opacity-40"
        >
          ← Atrás
        </button>

        <div className="flex items-center gap-3 mb-7">
          <div className="p-2 rounded-xl bg-[#a9b994]/15 border border-[#a9b994]/30">
            <CreditCard className="w-5 h-5 text-[#a9b994]" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Paso 2: Pago Seguro</h2>
            <p className="text-xs text-stone-500">Tilopay · ₡0 durante los 14 días de prueba</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-xs text-red-400 mb-5">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handlePayment} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Número de Tarjeta
            </label>
            <input
              type="text" required maxLength={19}
              placeholder="4000 1234 5678 9010"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              disabled={isProcessing}
              className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm disabled:opacity-50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">Expira (MM / YY)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text" required maxLength={2} placeholder="MM"
                  value={cardExpMonth}
                  onChange={(e) => setCardExpMonth(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-3 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm text-center disabled:opacity-50 transition-colors"
                />
                <span className="text-stone-500">/</span>
                <input
                  type="text" required maxLength={2} placeholder="YY"
                  value={cardExpYear}
                  onChange={(e) => setCardExpYear(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-3 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm text-center disabled:opacity-50 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">CVV</label>
              <input
                type="password" required maxLength={4} placeholder="•••"
                value={cardCvv}
                onChange={(e) => setCardCvv(e.target.value)}
                disabled={isProcessing}
                className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm disabled:opacity-50 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">Nombre en Tarjeta</label>
            <input
              type="text" required
              placeholder="Como aparece en la tarjeta"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              disabled={isProcessing}
              className="w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm disabled:opacity-50 transition-colors"
            />
          </div>

          {/* Plan summary */}
          <div className="p-4 rounded-xl bg-[#a9b994]/8 border border-[#a9b994]/25 flex items-center justify-between">
            <div>
              <span className="font-bold text-white text-sm block">Plan Pro · 14 Días Gratis</span>
              <span className="text-stone-500 text-xs">Luego ₡45,000 / mes · Cancela cuando quieras</span>
            </div>
            <span className="text-[#a9b994] font-black text-lg">₡0</span>
          </div>

          <div className="flex items-start gap-2.5 text-xs text-stone-500 pb-1">
            <ShieldCheck className="w-4 h-4 text-[#a9b994] shrink-0 mt-0.5" />
            <span>Datos procesados de forma segura por Tilopay. Tu tarjeta es tokenizada y no se realiza ningún cobro durante el periodo de prueba.</span>
          </div>

          <button
            type="submit"
            disabled={isProcessing}
            className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-[#a9b994]/15"
          >
            {isProcessing ? (
              <span className="animate-pulse">Procesando con Tilopay...</span>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                <span>Activar Prueba Gratuita de 14 Días</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
