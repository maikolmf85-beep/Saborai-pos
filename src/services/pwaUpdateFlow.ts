type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface ServiceWorkerLike extends EventTargetLike {
  readonly state: string;
}

export interface ServiceWorkerRegistrationLike extends EventTargetLike {
  readonly installing: ServiceWorkerLike | null;
}

export interface ServiceWorkerContainerLike extends EventTargetLike {
  readonly controller: ServiceWorkerLike | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const UPDATE_SUCCESS_SESSION_KEY = 'saborai:pwa-update-success';
const UPDATE_ACTIVATED_VALUE = 'activated';

/**
 * Exposes only the service worker's real install lifecycle. The browser does not
 * report byte-level precache progress through this API, so callers must render
 * an indeterminate indicator rather than a fabricated percentage.
 */
export function watchServiceWorkerUpdateDownload(
  registration: ServiceWorkerRegistrationLike,
  hasExistingController: () => boolean,
  onDownloadingChange: (downloading: boolean) => void,
): () => void {
  let watchedWorker: ServiceWorkerLike | null = null;
  let stateChangeHandler: EventListener | null = null;
  let stopped = false;

  const stopWatchingWorker = () => {
    if (watchedWorker && stateChangeHandler) {
      watchedWorker.removeEventListener('statechange', stateChangeHandler);
    }
    watchedWorker = null;
    stateChangeHandler = null;
  };

  const watchInstallingWorker = () => {
    if (stopped || !hasExistingController()) return;
    const worker = registration.installing;
    if (!worker || worker === watchedWorker) return;

    stopWatchingWorker();
    watchedWorker = worker;

    const handleStateChange: EventListener = () => {
      if (worker.state === 'installing') {
        onDownloadingChange(true);
        return;
      }

      if (worker.state === 'installed' || worker.state === 'redundant' || worker.state === 'activated') {
        onDownloadingChange(false);
        worker.removeEventListener('statechange', handleStateChange);
        if (watchedWorker === worker) {
          watchedWorker = null;
          stateChangeHandler = null;
        }
      }
    };

    stateChangeHandler = handleStateChange;
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange(new Event('statechange'));
  };

  registration.addEventListener('updatefound', watchInstallingWorker);
  watchInstallingWorker();

  return () => {
    if (stopped) return;
    stopped = true;
    registration.removeEventListener('updatefound', watchInstallingWorker);
    stopWatchingWorker();
    onDownloadingChange(false);
  };
}

/** Calls onActivated once only after the requested worker is active and controls the page. */
export function watchForActiveController(
  targetWorker: ServiceWorkerLike,
  serviceWorkerContainer: ServiceWorkerContainerLike,
  onActivated: () => void,
): () => void {
  let settled = false;

  const cleanup = () => {
    targetWorker.removeEventListener('statechange', checkActivation);
    serviceWorkerContainer.removeEventListener('controllerchange', checkActivation);
  };

  const checkActivation: EventListener = () => {
    if (settled || targetWorker.state !== 'activated' || serviceWorkerContainer.controller !== targetWorker) return;
    settled = true;
    cleanup();
    onActivated();
  };

  targetWorker.addEventListener('statechange', checkActivation);
  serviceWorkerContainer.addEventListener('controllerchange', checkActivation);
  checkActivation(new Event('statechange'));

  return cleanup;
}

export function markUpdateActivated(storage: StorageLike): void {
  storage.setItem(UPDATE_SUCCESS_SESSION_KEY, UPDATE_ACTIVATED_VALUE);
}

/** Consumes the success marker so a successful-update toast cannot loop on reload. */
export function consumeUpdateActivated(storage: StorageLike): boolean {
  if (storage.getItem(UPDATE_SUCCESS_SESSION_KEY) !== UPDATE_ACTIVATED_VALUE) return false;
  storage.removeItem(UPDATE_SUCCESS_SESSION_KEY);
  return true;
}
