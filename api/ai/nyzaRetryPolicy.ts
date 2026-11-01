export const NYZA_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] as const;
export const NYZA_GLOBAL_DEADLINE_MS = 12_000;
export const NYZA_RETRY_DELAY_MS = 900;
export const NYZA_MAX_ATTEMPTS_PER_MODEL = 2;

export type GeminiFailureClass = 'transient' | 'non-transient';

export type NyzaModelRequestResult<T> =
  | { kind: 'success'; model: string; value: T; attempts: number }
  | { kind: 'deadline'; attempts: number }
  | { kind: 'failure'; failureClass: GeminiFailureClass; attempts: number };

export interface NyzaRetryOptions {
  /** Only permits a shorter deadline than the production hard cap (useful for tests). */
  deadlineMs?: number;
  /** Only permits a shorter retry delay than the production policy. */
  retryDelayMs?: number;
  /** Primarily useful for deterministic policy tests. */
  models?: readonly string[];
}

const transientNetworkCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

const transientProviderCodes = new Set([
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE'
]);

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    chain.push(record);
    current = record.cause;
  }

  return chain;
}

function numericHttpStatus(value: unknown): number | null {
  const status = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function statusFrom(record: Record<string, unknown>): number | null {
  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : undefined;
  return numericHttpStatus(record.status)
    ?? numericHttpStatus(record.statusCode)
    ?? numericHttpStatus(response?.status);
}

/**
 * Fail closed: retry only explicit rate-limit/server, timeout, or network failures.
 * Any HTTP 4xx other than timeout/rate-limit (including auth, permission, invalid
 * input, and configuration errors) is non-transient and must not be retried.
 */
export function classifyGeminiError(error: unknown): GeminiFailureClass {
  const chain = errorChain(error);
  const statuses = chain.map(statusFrom).filter((status): status is number => status !== null);

  if (statuses.some(status => status >= 400 && status <= 499 && status !== 408 && status !== 429)) {
    return 'non-transient';
  }
  if (statuses.some(status => status === 408 || status === 429 || (status >= 500 && status <= 599))) {
    return 'transient';
  }

  for (const entry of chain) {
    const code = String(entry.code || '').toUpperCase();
    if (transientNetworkCodes.has(code) || transientProviderCodes.has(code)) return 'transient';

    const name = String(entry.name || '');
    if (name === 'TimeoutError' || name === 'AbortError') return 'transient';

    const message = typeof entry.message === 'string' ? entry.message : '';
    if (/fetch failed|network error|socket hang up|connection (?:reset|refused)|temporary failure in name resolution|\b(?:timed?\s*out|timeout|deadline exceeded)\b/i.test(message)) {
      return 'transient';
    }
  }

  return 'non-transient';
}

/** Clamp policy inputs so the total can never exceed the production deadline. */
export function resolveNyzaDeadlineMs(requestedMs?: number): number {
  if (requestedMs === undefined || !Number.isFinite(requestedMs)) return NYZA_GLOBAL_DEADLINE_MS;
  return Math.min(NYZA_GLOBAL_DEADLINE_MS, Math.max(1, Math.floor(requestedMs)));
}

function resolveRetryDelayMs(requestedMs?: number): number {
  if (requestedMs === undefined || !Number.isFinite(requestedMs)) return NYZA_RETRY_DELAY_MS;
  return Math.min(NYZA_RETRY_DELAY_MS, Math.max(0, Math.floor(requestedMs)));
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (delayMs <= 0) return Promise.resolve(true);

  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (continueRetrying: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(continueRetrying);
    };
    const onAbort = () => finish(false);

    timer = setTimeout(() => finish(!signal.aborted), delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs the primary and fallback models under one shared deadline. The active SDK
 * request receives the same AbortSignal; failures are never surfaced from here.
 */
export async function runNyzaModelRequests<T>(
  request: (model: string, signal: AbortSignal) => Promise<T>,
  options: NyzaRetryOptions = {}
): Promise<NyzaModelRequestResult<T>> {
  const models = options.models ?? NYZA_GEMINI_MODELS;
  const deadlineMs = resolveNyzaDeadlineMs(options.deadlineMs);
  const retryDelayMs = resolveRetryDelayMs(options.retryDelayMs);
  const controller = new AbortController();
  const deadlineAt = performance.now() + deadlineMs;
  const deadlineToken = Symbol('nyza-deadline-exceeded');
  let rejectDeadline: (reason: unknown) => void = () => {};
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  // The deadline promise is also used in a race; attach a handler for early returns.
  void deadlinePromise.catch(() => {});
  const deadlineTimer = setTimeout(() => {
    controller.abort();
    rejectDeadline(deadlineToken);
  }, deadlineMs);

  let attempts = 0;
  try {
    for (const model of models) {
      for (let modelAttempt = 0; modelAttempt < NYZA_MAX_ATTEMPTS_PER_MODEL; modelAttempt += 1) {
        if (controller.signal.aborted || performance.now() >= deadlineAt) {
          return { kind: 'deadline', attempts };
        }

        attempts += 1;
        try {
          const value = await Promise.race([
            Promise.resolve().then(() => request(model, controller.signal)),
            deadlinePromise
          ]);
          if (controller.signal.aborted || performance.now() >= deadlineAt) {
            return { kind: 'deadline', attempts };
          }
          return { kind: 'success', model, value, attempts };
        } catch (error) {
          if (error === deadlineToken || controller.signal.aborted || performance.now() >= deadlineAt) {
            return { kind: 'deadline', attempts };
          }

          if (classifyGeminiError(error) === 'non-transient') {
            return { kind: 'failure', failureClass: 'non-transient', attempts };
          }

          if (modelAttempt + 1 < NYZA_MAX_ATTEMPTS_PER_MODEL) {
            const remainingMs = Math.max(0, deadlineAt - performance.now());
            if (remainingMs <= retryDelayMs) return { kind: 'deadline', attempts };
            const canContinue = await waitForRetry(retryDelayMs, controller.signal);
            if (!canContinue || controller.signal.aborted || performance.now() >= deadlineAt) {
              return { kind: 'deadline', attempts };
            }
          }
        }
      }
    }

    return { kind: 'failure', failureClass: 'transient', attempts };
  } finally {
    clearTimeout(deadlineTimer);
  }
}
