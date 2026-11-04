import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LayoutGrid,
  Pause,
  ShieldCheck,
  Sparkles,
  Store,
  UtensilsCrossed,
  Users
} from 'lucide-react';
import { TenantInfo, UserProfile } from '../types';

interface NyzaSetupGuideProps {
  isOpen: boolean;
  tenant: TenantInfo;
  currentUser: UserProfile;
  onPause: () => void;
  onComplete: () => void;
  onOpenStaff: () => void;
  onOpenZones: () => void;
  onOpenTableCreator: () => void;
  onOpenMenuImporter: () => void;
  onOpenHacienda: () => void;
}

interface SavedGuideProgress {
  started: boolean;
  paused: boolean;
  step: number;
}

const storageKey = (tenantId: string) => `saborai_setup_guide_v1:${tenantId}`;

function readProgress(tenantId: string): SavedGuideProgress {
  if (typeof window === 'undefined') return { started: false, paused: false, step: 0 };
  try {
    const saved = window.localStorage.getItem(storageKey(tenantId));
    if (!saved) return { started: false, paused: false, step: 0 };
    const parsed = JSON.parse(saved) as Partial<SavedGuideProgress>;
    return {
      started: parsed.started === true,
      paused: parsed.paused === true,
      step: Number.isInteger(parsed.step) ? Math.max(0, Math.min(4, parsed.step as number)) : 0
    };
  } catch {
    return { started: false, paused: false, step: 0 };
  }
}

function saveProgress(tenantId: string, progress: SavedGuideProgress) {
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(progress));
  } catch {
    // The guide remains usable if this browser blocks local storage.
  }
}

const setupSteps = [
  {
    title: 'Prepara tu equipo',
    icon: Users,
    description: 'La cuenta que registró el restaurante ya es Administrador. Desde aquí puedes agregar a las personas que usarán el POS.',
    instructions: [
      'Abre “Equipo de Trabajo & Permisos”.',
      'Registra nombre, rol y un PIN de cuatro dígitos para cada colaborador.'
    ],
    actionLabel: 'Abrir equipo',
    action: 'staff'
  },
  {
    title: 'Crea tus salones',
    icon: Store,
    description: 'Organiza el local por áreas, por ejemplo: Salón principal, Terraza o Barra.',
    instructions: [
      'Abre la gestión de salones desde el plano de mesas.',
      'Escribe el nombre de cada área y pulsa “Agregar”.'
    ],
    actionLabel: 'Abrir gestión de salones',
    action: 'zones'
  },
  {
    title: 'Dibuja el plano de mesas',
    icon: LayoutGrid,
    description: 'Agrega las mesas una por una y acomódalas para que el mapa se parezca a tu restaurante.',
    instructions: [
      'Pulsa “Agregar mesa”; define el nombre y el salón.',
      'En ese formulario elige la forma Circular, Cuadrada o Rectangular y la capacidad de 2, 4, 6 u 8 comensales.',
      'Abre el panel de detalles y activa “Editar plano”. Selecciona la mesa y pulsa “Girar”; después arrástrala hasta su lugar.'
    ],
    actionLabel: 'Agregar una mesa',
    action: 'table'
  },
  {
    title: 'Sube tu menú con IA',
    icon: UtensilsCrossed,
    description: 'Nyza puede leer una foto o un PDF de tu carta para preparar los platillos en el catálogo.',
    instructions: [
      'En “Platillos & Catálogo de Menú”, pulsa “Cargar con IA”.',
      'Sube un PDF o una imagen y revisa los resultados antes de guardarlos.'
    ],
    actionLabel: 'Abrir carga de menú con IA',
    action: 'menu'
  },
  {
    title: 'Configura Hacienda',
    icon: ShieldCheck,
    description: 'Este es el paso más técnico. Puedes dejarlo para cuando tengas a mano la información fiscal de tu negocio.',
    instructions: [
      'En “Ajustes del Sistema”, abre “Facturación Hacienda (ATV & .p12)”. Si necesitas revisar el nombre o régimen, entra a “Perfil & Régimen Tributario”.',
      'Completa los datos requeridos y prueba la conexión. Ten a mano las credenciales y el certificado; si te falta algún dato, consúltalo con tu contador.'
    ],
    actionLabel: 'Abrir configuración de Hacienda',
    action: 'hacienda'
  }
] as const;

export const NyzaSetupGuide: React.FC<NyzaSetupGuideProps> = ({
  isOpen,
  tenant,
  currentUser,
  onPause,
  onComplete,
  onOpenStaff,
  onOpenZones,
  onOpenTableCreator,
  onOpenMenuImporter,
  onOpenHacienda
}) => {
  const [initialProgress] = useState(() => readProgress(tenant.id));
  const [step, setStep] = useState(initialProgress.step);
  const [showWelcome, setShowWelcome] = useState(!initialProgress.started);
  const welcomeDialogRef = useRef<HTMLElement | null>(null);
  const onPauseRef = useRef(onPause);

  useEffect(() => {
    onPauseRef.current = onPause;
  }, [onPause]);

  const persistStep = (nextStep: number) => {
    setStep(nextStep);
    saveProgress(tenant.id, { started: true, paused: false, step: nextStep });
  };

  const handleBegin = () => {
    setShowWelcome(false);
    saveProgress(tenant.id, { started: true, paused: false, step });
  };

  const handlePause = () => {
    setShowWelcome(false);
    saveProgress(tenant.id, { started: true, paused: true, step });
    onPause();
  };

  const handleSkip = () => {
    try {
      window.localStorage.removeItem(storageKey(tenant.id));
    } catch {
      // Completion is still handled by the parent if storage is unavailable.
    }
    onComplete();
  };

  const handleNext = () => {
    if (step >= setupSteps.length - 1) {
      handleSkip();
      return;
    }
    persistStep(step + 1);
  };

  const handleBack = () => {
    if (step === 0) {
      setShowWelcome(true);
      saveProgress(tenant.id, { started: false, paused: false, step: 0 });
      return;
    }
    persistStep(step - 1);
  };

  const handleOpenAction = () => {
    switch (setupSteps[step].action) {
      case 'staff': onOpenStaff(); break;
      case 'zones': onOpenZones(); break;
      case 'table': onOpenTableCreator(); break;
      case 'menu': onOpenMenuImporter(); break;
      case 'hacienda': onOpenHacienda(); break;
    }
  };

  useEffect(() => {
    if (!isOpen || !showWelcome) return;
    const dialog = welcomeDialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    ));
    focusable[focusable.length - 1]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowWelcome(false);
        saveProgress(tenant.id, { started: true, paused: true, step });
        onPauseRef.current();
        return;
      }
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && currentIndex === 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => document.removeEventListener('keydown', handleDialogKeyDown);
  }, [isOpen, showWelcome, tenant.id, step]);

  if (!isOpen) return null;

  const currentStep = setupSteps[step];
  const StepIcon = currentStep.icon;

  if (showWelcome) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm">
        <section
          ref={welcomeDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="nyza-welcome-title"
          className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-2xl shadow-black/30"
        >
          <div className="bg-gradient-to-br from-[#f3f6f0] via-white to-[#e7eee2] px-6 py-7 sm:px-9 sm:py-9">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-900 text-[#cbd8be] shadow-lg shadow-stone-900/15">
                <Sparkles className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#588157]">SaborAI · Tu compañera de inicio</p>
                <p className="mt-0.5 text-sm font-bold text-stone-800">Nyza</p>
              </div>
            </div>
            <h1 id="nyza-welcome-title" className="text-3xl font-black tracking-tight text-stone-900 sm:text-4xl">
              ¡Hola, {currentUser.name.split(' ')[0] || 'bienvenido'}!
            </h1>
            <p className="mt-3 max-w-md text-base leading-relaxed text-stone-600">
              Qué bueno tenerte por aquí. Te acompaño a preparar tu restaurante paso a paso; son cinco cosas sencillas y puedes hacerlas a tu ritmo.
            </p>
            <div className="mt-6 flex flex-wrap gap-2" aria-label="Cinco pasos de configuración">
              {setupSteps.map((item, index) => (
                <span key={item.title} className="rounded-full border border-[#a9b994]/50 bg-white/80 px-3 py-1.5 text-xs font-semibold text-stone-700">
                  {index + 1}. {item.title.replace('Prepara tu ', '').replace('Dibuja el ', '').replace('Sube tu ', '').replace('Configura ', '')}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-stone-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-9">
            <div className="flex items-center gap-4">
              <button type="button" onClick={handlePause} className="text-sm font-semibold text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline">
                Configurar después
              </button>
              <button type="button" onClick={handleSkip} className="text-sm font-semibold text-stone-400 underline-offset-4 hover:text-stone-700 hover:underline">
                Omitir guía
              </button>
            </div>
            <button type="button" onClick={handleBegin} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157] focus-visible:ring-offset-2">
              Empezar guía <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <aside
      aria-label="Guía de configuración de Nyza"
      className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-3 z-40 w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-950/20 sm:bottom-5 sm:right-5"
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-900 text-[#cbd8be]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-stone-900">Nyza · Guía de inicio</p>
            <p className="text-[10px] font-semibold text-stone-500">Paso {step + 1} de {setupSteps.length}</p>
          </div>
        </div>
        <button type="button" onClick={handlePause} aria-label="Pausar la guía y continuar después" title="Pausar y continuar después" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
          <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pausar
        </button>
      </div>

      <div className="px-4 pb-4 pt-3.5 sm:px-5">
        <div className="mb-3 flex gap-1.5" role="progressbar" aria-label={`Progreso de la guía: paso ${step + 1} de ${setupSteps.length}`} aria-valuemin={1} aria-valuemax={setupSteps.length} aria-valuenow={step + 1}>
          {setupSteps.map((item, index) => (
            <span key={item.title} aria-hidden="true" className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-[#588157]' : 'bg-stone-200'}`} />
          ))}
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e7eee2] text-[#3b5d3c]">
            <StepIcon className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black leading-snug text-stone-900">{currentStep.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{currentStep.description}</p>
          </div>
        </div>

        <ol className="mt-3 space-y-2">
          {currentStep.instructions.map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-2 text-xs leading-relaxed text-stone-700">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f1f5ed] text-[10px] font-black text-[#588157]">{index + 1}</span>
              <span>{instruction}</span>
            </li>
          ))}
        </ol>

        <button type="button" onClick={handleOpenAction} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#3b3733] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157] focus-visible:ring-offset-2">
          {currentStep.actionLabel} <ArrowRight className="h-3.5 w-3.5 text-[#cbd8be]" aria-hidden="true" />
        </button>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
          <button type="button" onClick={handleBack} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Atrás
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSkip} className="min-h-10 rounded-lg px-2 text-xs font-semibold text-stone-400 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
              Omitir guía
            </button>
            <button type="button" onClick={handleNext} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#e7eee2] px-3 text-xs font-bold text-stone-800 transition-colors hover:bg-[#dce7d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
              {step === setupSteps.length - 1 ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Terminar</> : <>Siguiente <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></>}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
