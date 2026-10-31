import { createHash } from 'node:crypto';
import {
  hashHandoffReference,
  isValidHandoffReference
} from './tilopayHandoffCrypto.js';

export type PurchaseStatus = 'CREATED' | 'PROCESSING' | 'UNKNOWN' | 'SUCCEEDED' | 'DECLINED';
export type ClaimStatus = 'CLAIMED' | 'RECOVERY' | 'IN_PROGRESS' | 'SUCCEEDED' | 'DECLINED' | 'INVALID' | 'EXPIRED' | 'TOKEN_MISMATCH';

export interface TilopayPaymentIntent {
  planId: string;
  amount: number | string;
  currency: string;
  orderNumber: string;
  expiresAt: string;
  paymentStatus: PurchaseStatus;
  paymentTokenHash: string | null;
  paymentTransactionId: string | null;
  paymentResult: { transactionId?: string } | null;
  customerEmail: string | null;
  customerFirstName: string | null;
}

export interface TilopayConsultedTransaction {
  amount: string | number;
  currency: string;
  code: string | number;
  id_tilopay?: string | number;
  tilopayTransaction?: string | number;
  tpt?: string | number;
}

export interface TilopayPaymentStore {
  find(referenceHash: string): Promise<TilopayPaymentIntent | null>;
  reserveTokenization(referenceHash: string): Promise<boolean>;
  releaseTokenization(referenceHash: string): Promise<void>;
  claimPayment(referenceHash: string, tokenHash: string): Promise<{ status: ClaimStatus; intent?: TilopayPaymentIntent; expired?: boolean }>;
  recordPayment(
    referenceHash: string,
    tokenHash: string,
    status: 'SUCCEEDED' | 'DECLINED' | 'UNKNOWN',
    transactionId: string | null,
    result: { transactionId?: string } | null
  ): Promise<void>;
}

export interface TilopayPurchaseGateway {
  tokenize(input: { email: string; firstName: string; lastName: string; redirect: string }): Promise<string>;
  charge(input: { amount: string; currency: string; orderNumber: string; email: string; token: string }): Promise<void>;
  consult(orderNumber: string): Promise<TilopayConsultedTransaction | null>;
}

export class PurchaseIntentError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'PurchaseIntentError';
  }
}

export function isValidTilopayToken(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 2048 &&
    value.trim() === value &&
    /^[\x21-\x7E]+$/.test(value);
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function amountToMinorUnits(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  try {
    return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  } catch {
    return null;
  }
}

export function validateConsultedTransaction(
  transaction: TilopayConsultedTransaction,
  intent: Pick<TilopayPaymentIntent, 'amount' | 'currency'>
): boolean {
  const actualAmount = amountToMinorUnits(transaction.amount);
  const expectedAmount = amountToMinorUnits(intent.amount);
  return actualAmount !== null && expectedAmount !== null &&
    actualAmount === expectedAmount &&
    typeof transaction.currency === 'string' &&
    transaction.currency.trim().toUpperCase() === intent.currency.toUpperCase();
}

function transactionIdOf(transaction: TilopayConsultedTransaction, fallback: string): string {
  return String(transaction.id_tilopay || transaction.tilopayTransaction || transaction.tpt || fallback);
}

function cachedSuccess(intent: TilopayPaymentIntent) {
  const transactionId = intent.paymentResult?.transactionId || intent.paymentTransactionId;
  if (!transactionId) {
    throw new PurchaseIntentError('El resultado de pago guardado no es válido.', 409);
  }
  return {
    success: true as const,
    pending: false as const,
    transactionId,
    planId: intent.planId,
    amount: Number(intent.amount),
    currency: intent.currency,
    idempotent: true
  };
}

export async function tokenizeForPurchaseIntent(
  reference: unknown,
  redirect: string,
  store: TilopayPaymentStore,
  gateway: Pick<TilopayPurchaseGateway, 'tokenize'>
): Promise<string> {
  if (!isValidHandoffReference(reference)) {
    throw new PurchaseIntentError('La intención de compra no es válida o expiró.', 400);
  }
  const referenceHash = hashHandoffReference(reference);
  const intent = await store.find(referenceHash);
  if (!intent || !intent.customerEmail || !intent.customerFirstName ||
      intent.paymentStatus !== 'CREATED' || Date.parse(intent.expiresAt) <= Date.now()) {
    throw new PurchaseIntentError('La intención de compra no es válida o expiró.', 400);
  }
  if (!await store.reserveTokenization(referenceHash)) {
    throw new PurchaseIntentError('Se alcanzó el límite de intentos para esta intención.', 429);
  }

  try {
    return await gateway.tokenize({
      email: intent.customerEmail,
      firstName: intent.customerFirstName,
      lastName: 'Saborai',
      redirect
    });
  } catch (error) {
    try {
      await store.releaseTokenization(referenceHash);
    } catch {
      // Si falla también la compensación, se conserva el error del proveedor y se falla cerrado.
    }
    throw error;
  }
}

export async function subscribeToPurchaseIntent(
  reference: unknown,
  token: unknown,
  store: TilopayPaymentStore,
  gateway: TilopayPurchaseGateway
) {
  if (!isValidHandoffReference(reference)) {
    throw new PurchaseIntentError('La intención de compra no es válida o expiró.', 400);
  }
  if (!isValidTilopayToken(token)) {
    throw new PurchaseIntentError('El token de pago no es válido.', 400);
  }

  const referenceHash = hashHandoffReference(reference);
  const tokenHash = tokenDigest(token);
  const initialIntent = await store.find(referenceHash);
  if (!initialIntent) {
    throw new PurchaseIntentError('La intención de compra no es válida o expiró.', 400);
  }

  const claim = await store.claimPayment(referenceHash, tokenHash);
  const intent = claim.intent || initialIntent;
  switch (claim.status) {
    case 'INVALID':
      throw new PurchaseIntentError('La intención de compra no es válida o expiró.', 400);
    case 'EXPIRED':
      throw new PurchaseIntentError('La intención de compra expiró antes de procesarse.', 400);
    case 'TOKEN_MISMATCH':
      throw new PurchaseIntentError('Esta intención ya está vinculada a otro token de pago.', 409);
    case 'IN_PROGRESS':
      return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
    case 'SUCCEEDED':
      return cachedSuccess(intent);
    case 'DECLINED':
      throw new PurchaseIntentError('El pago asociado a esta intención ya fue rechazado.', 402);
  }

  if (claim.status === 'RECOVERY') {
    try {
      const previous = await gateway.consult(intent.orderNumber);
      if (previous) return await finalizeConsultedTransaction(previous, intent, referenceHash, tokenHash, store);
    } catch {
      await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
      return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
    }

    // Tilopay documents orderNumber as unique forever and specifically requires
    // consulting it after an ambiguous timeout before a retry. Never retry with a new number.
    if (claim.expired || !intent.customerEmail) {
      await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
      return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
    }
  }

  if (!intent.customerEmail) {
    await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
    return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
  }

  try {
    await gateway.charge({
      amount: Number(intent.amount).toFixed(2),
      currency: intent.currency,
      orderNumber: intent.orderNumber,
      email: intent.customerEmail,
      token
    });
  } catch {
    // The outcome may be ambiguous. Consult the already-persisted order number below.
  }

  let transaction: TilopayConsultedTransaction | null;
  try {
    transaction = await gateway.consult(intent.orderNumber);
  } catch {
    await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
    return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
  }
  if (!transaction) {
    await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
    return { success: false as const, pending: true, planId: intent.planId, amount: Number(intent.amount), currency: intent.currency };
  }

  return finalizeConsultedTransaction(transaction, intent, referenceHash, tokenHash, store);
}

async function finalizeConsultedTransaction(
  transaction: TilopayConsultedTransaction,
  intent: TilopayPaymentIntent,
  referenceHash: string,
  tokenHash: string,
  store: TilopayPaymentStore
) {
  if (!validateConsultedTransaction(transaction, intent)) {
    await store.recordPayment(referenceHash, tokenHash, 'UNKNOWN', null, null);
    throw new PurchaseIntentError('Tilopay devolvió un importe o una moneda distintos de la intención autorizada.', 502);
  }

  const transactionId = transactionIdOf(transaction, intent.orderNumber);
  if (String(transaction.code) !== '1') {
    await store.recordPayment(referenceHash, tokenHash, 'DECLINED', transactionId, { transactionId });
    throw new PurchaseIntentError('Tilopay no aprobó el pago.', 402);
  }

  await store.recordPayment(referenceHash, tokenHash, 'SUCCEEDED', transactionId, { transactionId });
  return {
    success: true as const,
    pending: false as const,
    transactionId,
    planId: intent.planId,
    amount: Number(intent.amount),
    currency: intent.currency,
    idempotent: false
  };
}
