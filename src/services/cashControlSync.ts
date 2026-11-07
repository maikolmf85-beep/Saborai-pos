import type { CashShift } from '../types/cashShift';

export type RemoteShiftStatus = 'OPEN' | 'CLOSED' | 'VOIDED';

export interface ClosedShiftUpdateResult {
  data: unknown | null;
  error: { message?: string } | null;
}

const CASH_TERMINAL_ASSIGNMENT_PREFIX = 'No se pudo asignar este dispositivo a la caja';

export interface CashShiftCloseTarget {
  shiftId: string;
  registerId: string;
}

interface CashTerminalAssignmentConflictReference {
  localRegisterId?: string;
}

interface ConfirmedCashControlSnapshot {
  registers: Array<{ id: string; tenant_id: string; legacy_id?: string | null; is_active?: boolean }>;
  shifts: Array<{ id: string; tenant_id: string; legacy_id?: string | null; status: string; cash_register_id: string }>;
}

export function isOnlyTerminalAssignmentConflictForRegister(
  conflicts: string[],
  terminalAssignmentConflict: CashTerminalAssignmentConflictReference | undefined,
  registerId: string
): boolean {
  return Boolean(
    registerId
    && terminalAssignmentConflict?.localRegisterId === registerId
    && conflicts.length === 1
    && conflicts[0].toLowerCase().startsWith(CASH_TERMINAL_ASSIGNMENT_PREFIX.toLowerCase())
  );
}

export function isConfirmedOpenShiftForRegister(
  snapshot: ConfirmedCashControlSnapshot,
  tenantId: string,
  target: CashShiftCloseTarget,
  remoteRegisterId: string
): boolean {
  const register = snapshot.registers.find(candidate =>
    candidate.id === remoteRegisterId
    && candidate.tenant_id === tenantId
    && (candidate.legacy_id || candidate.id) === target.registerId
    && candidate.is_active !== false
  );
  if (!register) return false;

  const shift = snapshot.shifts.find(candidate =>
    candidate.id === target.shiftId || candidate.legacy_id === target.shiftId
  );
  return Boolean(
    shift
    && shift.tenant_id === tenantId
    && shift.status === 'OPEN'
    && shift.cash_register_id === register.id
  );
}

export async function commitAfterSuccessfulRemoteClose<T>(
  closeRemotely: () => Promise<T>,
  commitLocally: (result: T) => void
): Promise<T> {
  const result = await closeRemotely();
  commitLocally(result);
  return result;
}

export async function attemptCashTerminalAssignment<T>(
  assign: () => Promise<unknown>,
  inspectConflict: (error: unknown) => Promise<T | undefined>
): Promise<{ assignedTerminal: boolean; conflicts: string[]; terminalAssignmentConflict?: T }> {
  try {
    await assign();
    return { assignedTerminal: true, conflicts: [] };
  } catch (error) {
    const terminalAssignmentConflict = await inspectConflict(error);
    return {
      assignedTerminal: false,
      conflicts: [formatCashTerminalAssignmentConflict(error)],
      ...(terminalAssignmentConflict ? { terminalAssignmentConflict } : {})
    };
  }
}

export function formatCashTerminalAssignmentConflict(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  if (!message) return CASH_TERMINAL_ASSIGNMENT_PREFIX;
  return message.toLowerCase().startsWith(CASH_TERMINAL_ASSIGNMENT_PREFIX.toLowerCase())
    ? message
    : `${CASH_TERMINAL_ASSIGNMENT_PREFIX}: ${message}`;
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
