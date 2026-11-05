import type { CashShift } from '../types/cashShift';

export type RemoteShiftStatus = 'OPEN' | 'CLOSED' | 'VOIDED';

export interface ClosedShiftUpdateResult {
  data: unknown | null;
  error: { message?: string } | null;
}

/** A cloud snapshot is stale if a local mutation happened while it was loading. */
export function shouldApplyCloudSnapshot(startRevision: number, currentRevision: number): boolean {
  return startRevision === currentRevision;
}

/** A matching DGT code is a conflict unless it is the same cloud register. */
export function isUnrelatedRegisterCodeMatch(
  localId: string,
  legacyMatchId: string | undefined,
  codeMatchId: string | undefined
): boolean {
  if (!codeMatchId) return false;
  return legacyMatchId ? codeMatchId !== legacyMatchId : codeMatchId !== localId;
}

/** Close only a remote OPEN row; never reopen a row based on stale local state. */
export function shouldSyncClosedShift(existingStatus: RemoteShiftStatus, localStatus: CashShift['status']): boolean {
  return existingStatus === 'OPEN' && localStatus === 'CLOSED';
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export function buildClosedShiftCloudPayload(shift: CashShift): Record<string, unknown> {
  return {
    status: 'CLOSED',
    legacy_id: shift.id,
    ...(isUuid(shift.closedBy?.userId) ? { closed_by: shift.closedBy.userId } : {}),
    expected_cash: shift.systemSummary?.expectedCashInDrawer || 0,
    counted_cash: shift.countedCash ?? null,
    difference: shift.cashDifference ?? null,
    closed_at: shift.closedAt || null,
    notes: shift.notes || null,
    participants: shift.participants || [],
    movements: shift.movements || [],
    system_summary: shift.systemSummary || {},
    cash_breakdown: shift.cashBreakdown || null,
    counted_cards: shift.countedCards ?? null,
    dataphones_breakdown: shift.dataphonesBreakdown || null,
    counted_sinpe: shift.countedSinpe ?? null,
    difference_reason: shift.differenceReason || null,
    z_report_generated: Boolean(shift.zReportGenerated)
  };
}

export async function updateClosedShiftIfNeeded(
  existingStatus: RemoteShiftStatus,
  remoteId: string,
  localShift: CashShift,
  update: (id: string, payload: Record<string, unknown>) => Promise<ClosedShiftUpdateResult>
): Promise<boolean> {
  if (!shouldSyncClosedShift(existingStatus, localShift.status)) return false;

  const result = await update(remoteId, buildClosedShiftCloudPayload(localShift));
  if (result.error) {
    throw new Error(result.error.message || 'La actualización del turno cerrado falló.');
  }
  if (!result.data) {
    throw new Error('No se confirmó la actualización del turno cerrado en la nube.');
  }
  return true;
}
