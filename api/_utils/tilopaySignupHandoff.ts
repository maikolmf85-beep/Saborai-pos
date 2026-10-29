import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from './supabase.js';
import { getJwtSecret } from './security.js';
import {
  createHandoffReference,
  decryptHandoffPayload,
  encryptHandoffPayload,
  hashHandoffReference,
  isValidHandoffReference,
  type EncryptedHandoffPayload
} from './tilopayHandoffCrypto.js';
import { TILOPAY_SIGNUP_PLAN, isSupportedTilopayPlan } from './tilopayPlans.js';
import type {
  ClaimStatus,
  PurchaseStatus,
  TilopayPaymentIntent,
  TilopayPaymentStore
} from './tilopayPurchaseFlow.js';

const HANDOFF_TABLE = 'tilopay_signup_handoffs';
const HANDOFF_TTL_MS = 15 * 60 * 1000;

export interface TilopaySignupHandoff {
  email: string;
  password: string;
  name: string;
  phone: string;
  restaurantName: string;
  plan: string;
}

interface HandoffDatabaseRow {
  reference_hash: string;
  encrypted_payload: EncryptedHandoffPayload | null;
  expires_at: string;
  plan_id: string;
  amount: number | string;
  currency: string;
  order_number: string;
  payment_status: PurchaseStatus;
  payment_token_hash: string | null;
  payment_transaction_id: string | null;
  payment_result: { transactionId?: string } | null;
}

function isSignupHandoff(value: unknown): value is TilopaySignupHandoff {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.email === 'string' &&
    typeof record.password === 'string' && record.password.length >= 6 &&
    typeof record.name === 'string' &&
    typeof record.phone === 'string' &&
    typeof record.restaurantName === 'string' &&
    isSupportedTilopayPlan(record.plan);
}

function mapIntent(row: HandoffDatabaseRow, payload?: TilopaySignupHandoff): TilopayPaymentIntent {
  return {
    planId: row.plan_id,
    amount: row.amount,
    currency: row.currency,
    orderNumber: row.order_number,
    expiresAt: row.expires_at,
    paymentStatus: row.payment_status,
    paymentTokenHash: row.payment_token_hash,
    paymentTransactionId: row.payment_transaction_id,
    paymentResult: row.payment_result,
    customerEmail: payload?.email || null,
    customerFirstName: payload?.name || null
  };
}

function decryptPayload(row: HandoffDatabaseRow): TilopaySignupHandoff | null {
  if (!row.encrypted_payload) return null;
  let payload: unknown;
  try {
    payload = decryptHandoffPayload<unknown>(row.encrypted_payload, getJwtSecret());
  } catch {
    throw new Error('No se pudo validar el estado temporal del registro.');
  }
  return isSignupHandoff(payload) ? payload : null;
}

async function readIntentByHash(referenceHash: string): Promise<{ intent: TilopayPaymentIntent; payload: TilopaySignupHandoff | null } | null> {
  const { data, error } = await supabaseAdmin
    .from(HANDOFF_TABLE)
    .select('reference_hash,encrypted_payload,expires_at,plan_id,amount,currency,order_number,payment_status,payment_token_hash,payment_transaction_id,payment_result')
    .eq('reference_hash', referenceHash)
    .maybeSingle();

  if (error) throw new Error('No se pudo consultar la intención de compra.');
  if (!data) return null;
  const row = data as HandoffDatabaseRow;
  const payload = decryptPayload(row);
  return { intent: mapIntent(row, payload || undefined), payload };
}

export async function createTilopaySignupHandoff(payload: TilopaySignupHandoff): Promise<string> {
  if (!isSignupHandoff(payload) || payload.plan !== TILOPAY_SIGNUP_PLAN.id) {
    throw new Error('El plan de registro no está permitido.');
  }

  const reference = createHandoffReference();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS).toISOString();
  const encryptedPayload = encryptHandoffPayload(payload, getJwtSecret());
  const orderNumber = `SA${randomBytes(16).toString('hex').toUpperCase()}`;

  // Eliminar solo intenciones no cobradas y vencidas. Los resultados de pago se
  // conservan para que los reintentos del mismo reference sean idempotentes.
  await supabaseAdmin
    .from(HANDOFF_TABLE)
    .delete()
    .eq('payment_status', 'CREATED')
    .lte('expires_at', now.toISOString());

  const { error } = await supabaseAdmin
    .from(HANDOFF_TABLE)
    .insert({
      reference_hash: hashHandoffReference(reference),
      encrypted_payload: encryptedPayload,
      expires_at: expiresAt,
      plan_id: TILOPAY_SIGNUP_PLAN.id,
      amount: TILOPAY_SIGNUP_PLAN.amount,
      currency: TILOPAY_SIGNUP_PLAN.currency,
      order_number: orderNumber,
      payment_status: 'CREATED'
    });

  if (error) throw new Error('No se pudo iniciar el registro seguro.');
  return reference;
}

export async function getTilopaySignupHandoff(reference: unknown): Promise<TilopaySignupHandoff | null> {
  if (!isValidHandoffReference(reference)) return null;
  const record = await readIntentByHash(hashHandoffReference(reference));
  if (!record || !record.payload || Date.parse(record.intent.expiresAt) <= Date.now()) return null;
  return record.payload;
}

export async function consumeTilopaySignupHandoff(reference: unknown): Promise<TilopaySignupHandoff | null> {
  if (!isValidHandoffReference(reference)) return null;

  const referenceHash = hashHandoffReference(reference);
  const record = await readIntentByHash(referenceHash);
  if (!record?.payload || Date.parse(record.intent.expiresAt) <= Date.now()) return null;

  // Retener el registro mínimo de pago permite responder reintentos con el
  // mismo resultado, pero borrar el password y los demás datos de registro.
  const { data, error } = await supabaseAdmin
    .from(HANDOFF_TABLE)
    .update({ encrypted_payload: null, signup_consumed_at: new Date().toISOString() })
    .eq('reference_hash', referenceHash)
    .is('signup_consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('reference_hash')
    .maybeSingle();

  if (error) throw new Error('No se pudo consumir el estado temporal del registro.');
  return data ? record.payload : null;
}

export async function getTilopayPaymentIntent(reference: unknown): Promise<TilopayPaymentIntent | null> {
  if (!isValidHandoffReference(reference)) return null;
  const record = await readIntentByHash(hashHandoffReference(reference));
  return record?.intent || null;
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] && typeof data[0] === 'object') ? data[0] as Record<string, unknown> : null;
  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

function rpcIntent(row: Record<string, unknown>, fallback?: TilopayPaymentIntent): TilopayPaymentIntent {
  return {
    planId: String(row.plan_id ?? fallback?.planId ?? ''),
    amount: (row.amount ?? fallback?.amount ?? 0) as number | string,
    currency: String(row.currency ?? fallback?.currency ?? ''),
    orderNumber: String(row.order_number ?? fallback?.orderNumber ?? ''),
    expiresAt: String(row.expires_at ?? fallback?.expiresAt ?? ''),
    paymentStatus: String(row.payment_status ?? fallback?.paymentStatus ?? 'CREATED') as PurchaseStatus,
    paymentTokenHash: (row.payment_token_hash ?? fallback?.paymentTokenHash ?? null) as string | null,
    paymentTransactionId: (row.payment_transaction_id ?? fallback?.paymentTransactionId ?? null) as string | null,
    paymentResult: (row.payment_result ?? fallback?.paymentResult ?? null) as { transactionId?: string } | null,
    customerEmail: fallback?.customerEmail || null,
    customerFirstName: fallback?.customerFirstName || null
  };
}

export const tilopayPaymentStore: TilopayPaymentStore = {
  async find(referenceHash) {
    const record = await readIntentByHash(referenceHash);
    return record?.intent || null;
  },

  async reserveTokenization(referenceHash) {
    const { data, error } = await supabaseAdmin.rpc('reserve_tilopay_tokenization', {
      p_reference_hash: referenceHash
    });
    if (error) throw new Error('No se pudo validar el límite de tokenización.');
    return data === true;
  },

  async releaseTokenization(referenceHash) {
    const { data, error } = await supabaseAdmin.rpc('release_tilopay_tokenization', {
      p_reference_hash: referenceHash
    });
    if (error || data !== true) throw new Error('No se pudo liberar el intento de tokenización.');
  },

  async claimPayment(referenceHash, tokenHash) {
    const fallback = await this.find(referenceHash);
    const { data, error } = await supabaseAdmin.rpc('claim_tilopay_signup_payment', {
      p_reference_hash: referenceHash,
      p_token_hash: tokenHash
    });
    if (error) throw new Error('No se pudo reservar la operación de pago.');
    const row = firstRpcRow(data);
    if (!row) return { status: 'INVALID' };
    const status = String(row.claim_status) as ClaimStatus;
    return {
      status,
      intent: rpcIntent(row, fallback || undefined),
      expired: row.is_expired === true
    };
  },

  async recordPayment(referenceHash, tokenHash, status, transactionId, result) {
    const { data, error } = await supabaseAdmin.rpc('record_tilopay_signup_payment', {
      p_reference_hash: referenceHash,
      p_token_hash: tokenHash,
      p_payment_status: status,
      p_transaction_id: transactionId,
      p_payment_result: result
    });
    if (error || data !== true) throw new Error('No se pudo guardar el resultado de Tilopay.');
  }
};
