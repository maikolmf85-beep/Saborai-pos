import { isHaciendaOperationLock, isHaciendaOperationLockStale } from './haciendaOperationLock.js';

export interface HaciendaInvoiceSnapshot {
  tenantId: string;
  branchId: string;
  clave: string;
  haciendaStatus: string;
  errorMessage: string | null;
}

export interface HaciendaInvoiceUpdateResult {
  updated: boolean;
  error: any | null;
}

export function canReserveHaciendaSubmission(
  snapshot: HaciendaInvoiceSnapshot | null,
  action: 'emit' | 'resend',
  rejectionConfirmedByDgt: boolean
): boolean {
  if (!snapshot) return action === 'emit';
  if (isHaciendaOperationLock(snapshot.errorMessage)) return false;
  if (snapshot.haciendaStatus === 'PENDING') return action === 'emit';
  return snapshot.haciendaStatus === 'REJECTED' && action === 'resend' && rejectionConfirmedByDgt;
}

/** Compare-and-set sobre el estado y error_message actuales de una factura. */
export async function updateHaciendaInvoiceIfSnapshot(
  client: any,
  snapshot: HaciendaInvoiceSnapshot,
  updates: Record<string, unknown>
): Promise<HaciendaInvoiceUpdateResult> {
  try {
    let query = client.from('pos_invoices').update(updates)
      .eq('tenant_id', snapshot.tenantId)
      .eq('branch_id', snapshot.branchId)
      .eq('clave', snapshot.clave)
      .eq('hacienda_status', snapshot.haciendaStatus);
    query = snapshot.errorMessage === null
      ? query.is('error_message', null)
      : query.eq('error_message', snapshot.errorMessage);
    const { data, error } = await query.select('clave').maybeSingle();
    return { updated: Boolean(data), error: error || null };
  } catch (error) {
    return { updated: false, error };
  }
}

/** Reclama una fila para consultar DGT; un lock fresco nunca se pisa. */
export async function claimHaciendaOperationLock(
  client: any,
  snapshot: HaciendaInvoiceSnapshot,
  lockToken: string,
  now = Date.now()
): Promise<HaciendaInvoiceUpdateResult> {
  if (isHaciendaOperationLock(snapshot.errorMessage) && !isHaciendaOperationLockStale(snapshot.errorMessage, now)) {
    return { updated: false, error: null };
  }
  return updateHaciendaInvoiceIfSnapshot(client, snapshot, {
    hacienda_status: 'PROCESSING',
    error_message: lockToken,
    accepted_at: null
  });
}

/** Finaliza una operación solo si la solicitud todavía posee su token de lock. */
export async function finishHaciendaOperationLock(
  client: any,
  tenantId: string,
  branchId: string,
  clave: string,
  lockToken: string,
  updates: Record<string, unknown>
): Promise<HaciendaInvoiceUpdateResult> {
  return updateHaciendaInvoiceIfSnapshot(client, {
    tenantId,
    branchId,
    clave,
    haciendaStatus: 'PROCESSING',
    errorMessage: lockToken
  }, updates);
}
