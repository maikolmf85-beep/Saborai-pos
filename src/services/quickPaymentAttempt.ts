export type QuickPaymentEffect = 'employeeCredit' | 'cashShift' | 'inventory' | 'cashDrawer';

export interface QuickPaymentAttempt {
  fingerprint: string;
  operationId: string;
  clave: string;
  consecutivo: string;
  emissionDate: string;
  effects: Partial<Record<QuickPaymentEffect, true>>;
  storageKey: string;
}

interface StoredQuickPaymentAttempt extends Omit<QuickPaymentAttempt, 'storageKey'> {}

export function quickPaymentOperationIds(tenantId: string, operationId: string) {
  const prefix = `quick-payment:${tenantId}:${operationId}`;
  return {
    prepare: `${prefix}:00-order-prepare`,
    payment: `${prefix}:01-payment`,
    inventory: `${prefix}:02-inventory`,
    invoice: `${prefix}:03-invoice`,
    complete: `${prefix}:04-order-complete`
  };
}

export function shouldApplyQuickPaymentLocalEffects(isLocalDemo: boolean, paymentConfirmed: boolean): boolean {
  return isLocalDemo || paymentConfirmed;
}

function readStoredAttempt(storageKey: string): StoredQuickPaymentAttempt | null {
  const raw = globalThis.localStorage?.getItem(storageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredQuickPaymentAttempt>;
    if (typeof value.fingerprint !== 'string'
      || typeof value.operationId !== 'string'
      || typeof value.clave !== 'string'
      || typeof value.consecutivo !== 'string'
      || typeof value.emissionDate !== 'string'
      || !value.effects || typeof value.effects !== 'object') {
      throw new Error('El intento anterior de QuickPayment está incompleto.');
    }
    return value as StoredQuickPaymentAttempt;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'No se pudo recuperar el intento anterior de QuickPayment.');
  }
}

export function getQuickPaymentAttemptByOperationId(operationId: string): QuickPaymentAttempt | null {
  const storage = globalThis.localStorage;
  if (!operationId || !storage || typeof storage.key !== 'function') return null;
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey?.startsWith('saborai_quick_payment_attempt_')) continue;
    try {
      const stored = readStoredAttempt(storageKey);
      if (stored?.operationId === operationId) return { ...stored, storageKey };
    } catch {
      // Un intento local malformado no debe impedir procesar otros cobros confirmados.
    }
  }
  return null;
}

export async function getOrCreateQuickPaymentAttempt(
  seed: unknown,
  createInvoice: () => { clave: string; consecutivo: string; emissionDate: string }
): Promise<QuickPaymentAttempt> {
  if (!globalThis.localStorage) throw new Error('No hay almacenamiento local seguro para identificar este cobro.');
  if (!globalThis.crypto?.subtle || !globalThis.crypto.randomUUID) {
    throw new Error('Este dispositivo no puede crear una clave segura para reintentar el cobro.');
  }

  const serializedSeed = JSON.stringify(seed);
  if (!serializedSeed) throw new Error('No se pudo identificar el contenido de este cobro.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializedSeed));
  const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const storageKey = `saborai_quick_payment_attempt_${fingerprint}`;
  const existing = readStoredAttempt(storageKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('El intento almacenado no coincide con esta venta.');
    return { ...existing, storageKey };
  }

  const invoice = createInvoice();
  const stored: StoredQuickPaymentAttempt = {
    fingerprint,
    operationId: globalThis.crypto.randomUUID(),
    clave: invoice.clave,
    consecutivo: invoice.consecutivo,
    emissionDate: invoice.emissionDate,
    effects: {}
  };
  const serializedAttempt = JSON.stringify(stored);
  globalThis.localStorage.setItem(storageKey, serializedAttempt);
  if (globalThis.localStorage.getItem(storageKey) !== serializedAttempt) {
    throw new Error('No se pudo guardar la clave idempotente del cobro; no se registró el pago.');
  }
  return { ...stored, storageKey };
}

export function isQuickPaymentEffectApplied(attempt: QuickPaymentAttempt, effect: QuickPaymentEffect): boolean {
  return readStoredAttempt(attempt.storageKey)?.effects[effect] === true;
}

export function markQuickPaymentEffectApplied(attempt: QuickPaymentAttempt, effect: QuickPaymentEffect): QuickPaymentAttempt {
  const stored = readStoredAttempt(attempt.storageKey);
  if (!stored || stored.operationId !== attempt.operationId || stored.fingerprint !== attempt.fingerprint) {
    throw new Error('No se pudo confirmar el estado local de este cobro.');
  }
  if (stored.effects[effect]) return { ...stored, storageKey: attempt.storageKey };
  const updated: StoredQuickPaymentAttempt = {
    ...stored,
    effects: { ...stored.effects, [effect]: true }
  };
  const serialized = JSON.stringify(updated);
  globalThis.localStorage.setItem(attempt.storageKey, serialized);
  if (globalThis.localStorage.getItem(attempt.storageKey) !== serialized) {
    throw new Error('No se pudo guardar la protección contra efectos locales duplicados.');
  }
  return { ...updated, storageKey: attempt.storageKey };
}

export function clearQuickPaymentAttempt(storageKey: string): void {
  globalThis.localStorage?.removeItem(storageKey);
}
