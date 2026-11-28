import { useEffect, useRef, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import {
  consumeUpdateActivated,
  markUpdateActivated,
  watchForActiveController,
  watchServiceWorkerUpdateDownload
} from '../services/pwaUpdateFlow';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaLifecycle() {
  const isPosHost = window.location.hostname === 'pos.saborai.site'
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  const [updateReady, setUpdateReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateSucceeded, setUpdateSucceeded] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const serviceWorkerRegistration = useRef<ServiceWorkerRegistration | null>(null);
  const updateInFlight = useRef(false);

  useEffect(() => {
    if (!isPosHost) return;

    let disposed = false;
    let stopWatchingDownload: (() => void) | null = null;
    let successToastShowTimer: number | undefined;
    let successToastTimer: number | undefined;

    try {
      const hadActivatedUpdate = consumeUpdateActivated(window.sessionStorage);
      if (hadActivatedUpdate && navigator.serviceWorker.controller?.state === 'activated') {
        successToastShowTimer = window.setTimeout(() => {
          setUpdateSucceeded(true);
          successToastTimer = window.setTimeout(() => setUpdateSucceeded(false), 7000);
        }, 0);
      }
    } catch (error) {
      console.warn('[SaborAI] No se pudo recuperar la notificación de actualización:', error);
    }

    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setIsDownloading(false);
        setUpdateReady(true);
        setUpdateFailed(false);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (disposed || !registration) return;
        serviceWorkerRegistration.current = registration;
        stopWatchingDownload = watchServiceWorkerUpdateDownload(
          registration,
          () => Boolean(navigator.serviceWorker.controller),
          downloading => {
            setIsDownloading(downloading);
            if (downloading) setOfflineReady(false);
          }
        );
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
    return () => {
      disposed = true;
      stopWatchingDownload?.();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      if (successToastShowTimer !== undefined) window.clearTimeout(successToastShowTimer);
      if (successToastTimer !== undefined) window.clearTimeout(successToastTimer);
      updateServiceWorker.current = null;
      serviceWorkerRegistration.current = null;
    };
  }, [isPosHost]);

  const update = async () => {
    const registration = serviceWorkerRegistration.current;
    const updateWorker = registration?.waiting;
    const updateApp = updateServiceWorker.current;
    if (!updateWorker || !updateApp || updateInFlight.current) return;

    updateInFlight.current = true;
    setIsUpdating(true);
    setUpdateFailed(false);

    let finished = false;
    let stopWatchingActivation = () => {};
    const finishAsFailed = () => {
      if (finished) return;
      finished = true;
      stopWatchingActivation();
      updateInFlight.current = false;
      setIsUpdating(false);
      setUpdateFailed(true);
    };
    const timeout = window.setTimeout(finishAsFailed, 45000);

    stopWatchingActivation = watchForActiveController(updateWorker, navigator.serviceWorker, () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      try {
        markUpdateActivated(window.sessionStorage);
      } catch (error) {
        // The update is still applied; storage failure only prevents the post-reload toast.
        console.warn('[SaborAI] No se pudo guardar la confirmación de actualización:', error);
      }
      window.location.reload();
    });

    try {
      // Leave the reload to our activation check so success is recorded only for this worker.
      await updateApp(false);
    } catch (error) {
      console.warn('[SaborAI] No se pudo aplicar la actualización:', error);
      window.clearTimeout(timeout);
      finishAsFailed();
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

      {isDownloading && !updateReady && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[100] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-xl">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Download aria-hidden="true" className="h-4 w-4 text-[#588157]" />
            <span>Descargando actualización…</span>
          </div>
          <div role="progressbar" aria-label="Descarga de actualización en curso" aria-valuetext="Progreso indeterminado" className="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div className="saborai-update-progress h-full w-1/3 rounded-full bg-[#588157]" />
          </div>
        </div>
      )}

      {(updateReady || offlineReady) && !isDownloading && (
        <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-xl">
          <div className="min-w-0 flex-1">
            <span>{updateReady ? 'Hay una nueva versión de Saborai.' : 'Saborai está lista para usarse sin conexión.'}</span>
            {updateReady && updateFailed && (
              <p role="alert" className="mt-1 text-xs text-rose-700">No se pudo confirmar la actualización. Inténtalo de nuevo.</p>
            )}
          </div>
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

      {updateSucceeded && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[110] flex max-w-sm items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-xl">
          <Check aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>Saborai actualizado con éxito</span>
          <button type="button" onClick={() => setUpdateSucceeded(false)} aria-label="Cerrar notificación" className="ml-1 rounded p-1 text-stone-500 hover:bg-stone-100">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
