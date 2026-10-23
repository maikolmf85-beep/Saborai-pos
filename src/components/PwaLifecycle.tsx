import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaLifecycle() {
  const isPosHost = window.location.hostname === 'pos.saborai.site'
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const [updateReady, setUpdateReady] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!isPosHost) return;

    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateReady(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisterError(error: unknown) {
        console.warn('[SaborAI] No se pudo registrar el Service Worker:', error);
      }
    });

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [isPosHost]);

  const update = async () => {
    if (!updateServiceWorker.current || isUpdating) return;
    setIsUpdating(true);
    try {
      // Activa el worker que está esperando y recarga después de controlarlo.
      await updateServiceWorker.current(true);
      setUpdateReady(false);
    } catch (error) {
      console.warn('[SaborAI] No se pudo aplicar la actualización:', error);
      setIsUpdating(false);
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  if (!isPosHost) return null;

  return (
    <>
      {installEvent && (
        <button
          type="button"
          onClick={install}
          className="fixed bottom-4 left-4 z-[100] rounded-full bg-stone-900 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-stone-700"
        >
          Instalar Saborai
        </button>
      )}

      {(updateReady || offlineReady) && (
        <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-xl">
          <span>{updateReady ? 'Hay una nueva versión de Saborai.' : 'Saborai está lista para usarse sin conexión.'}</span>
          {updateReady ? (
            <button type="button" onClick={update} disabled={isUpdating} className="shrink-0 rounded-lg bg-stone-900 px-3 py-2 font-semibold text-white disabled:cursor-wait disabled:opacity-60">
              {isUpdating ? 'Actualizando…' : 'Actualizar'}
            </button>
          ) : (
            <button type="button" onClick={() => setOfflineReady(false)} className="shrink-0 rounded-lg px-2 py-1 font-semibold text-stone-600 hover:bg-stone-100">
              Cerrar
            </button>
          )}
        </div>
      )}
    </>
  );
}
