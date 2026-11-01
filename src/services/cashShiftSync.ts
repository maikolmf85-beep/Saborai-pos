import type { CashShift } from '../types/cashShift';
import { localDB } from './db';
import { createOperationId, PosCloudSyncError, posCloudService } from './posCloudService';

export type CashShiftSyncAction = 'OPEN_CASH_SHIFT' | 'CLOSE_CASH_SHIFT';
export type CashShiftSyncOutcome = 'SYNCED' | 'QUEUED' | 'CONFLICT';

export interface CashShiftSyncPayload {
  shiftId: string;
  cashRegisterId: string;
  shiftNumber: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  initialFloat: number;
  expectedCash: number;
  countedCash?: number;
  countedCards?: number;
  countedSinpe?: number;
  difference?: number;
  notes?: string;
  linkedZones: string[];
  participants: NonNullable<CashShift['participants']>;
  movements: CashShift['movements'];
  systemSummary: CashShift['systemSummary'];
  cashBreakdown?: CashShift['cashBreakdown'];
  dataphonesBreakdown?: CashShift['dataphonesBreakdown'];
  differenceReason?: string;
  zReportGenerated: boolean;
}

export function buildCashShiftSyncPayload(
  shift: CashShift,
  action: CashShiftSyncAction
): CashShiftSyncPayload {
  const linkedZones = Array.isArray(shift.linkedZones) && shift.linkedZones.length > 0
    ? shift.linkedZones.filter(zone => typeof zone === 'string' && zone.trim()).map(zone => zone.trim())
    : shift.linkedZone?.trim() ? [shift.linkedZone.trim()] : [];

  return {
    shiftId: shift.id,
    cashRegisterId: shift.cashRegisterId || '',
    shiftNumber: shift.shiftNumber,
    status: action === 'OPEN_CASH_SHIFT' ? 'OPEN' : 'CLOSED',
    openedAt: shift.openedAt,
    closedAt: action === 'CLOSE_CASH_SHIFT' ? shift.closedAt : undefined,
    initialFloat: shift.initialCashFloat || 0,
    expectedCash: shift.systemSummary?.expectedCashInDrawer || 0,
    countedCash: action === 'CLOSE_CASH_SHIFT' ? shift.countedCash : undefined,
    countedCards: action === 'CLOSE_CASH_SHIFT' ? shift.countedCards : undefined,
    countedSinpe: action === 'CLOSE_CASH_SHIFT' ? shift.countedSinpe : undefined,
    difference: action === 'CLOSE_CASH_SHIFT' ? shift.cashDifference : undefined,
    notes: shift.notes || '',
    linkedZones,
    participants: Array.isArray(shift.participants) ? shift.participants : [],
    movements: Array.isArray(shift.movements) ? shift.movements : [],
    systemSummary: shift.systemSummary,
    cashBreakdown: action === 'CLOSE_CASH_SHIFT' ? shift.cashBreakdown : undefined,
    dataphonesBreakdown: action === 'CLOSE_CASH_SHIFT' ? shift.dataphonesBreakdown : undefined,
    differenceReason: action === 'CLOSE_CASH_SHIFT' ? shift.differenceReason : undefined,
    zReportGenerated: action === 'CLOSE_CASH_SHIFT' && Boolean(shift.zReportGenerated)
  };
}

const TERMINAL_SHIFT_SYNC_CODES = new Set([
  'CASH_SHIFT_SYNC_REJECTED',
  'CASH_SHIFT_NOT_OPEN',
  'ORDER_SYNC_REJECTED'
]);

export async function syncCashShiftChange(
  action: CashShiftSyncAction,
  shift: CashShift,
  tenantId: string
): Promise<{ outcome: CashShiftSyncOutcome; error?: Error }> {
  const payload = buildCashShiftSyncPayload(shift, action);
  const operationId = createOperationId(action);
  const description = `${action === 'OPEN_CASH_SHIFT' ? 'Apertura' : 'Cierre'} del turno #${shift.shiftNumber}`;

  const pendingLifecycle = action === 'CLOSE_CASH_SHIFT'
    ? await localDB.hasPendingCashShiftLifecycleAction(tenantId, shift.id)
    : false;
  if (!localDB.isOnline() || pendingLifecycle) {
    await localDB.enqueueOfflineAction(action, payload, description, tenantId, operationId);
    return { outcome: 'QUEUED' };
  }

  try {
    await posCloudService.syncOperation(action, payload as unknown as Record<string, unknown>, tenantId, operationId);
    return { outcome: 'SYNCED' };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const isConflict = error instanceof PosCloudSyncError && TERMINAL_SHIFT_SYNC_CODES.has(error.code || '');
    await localDB.enqueueOfflineAction(action, payload, description, tenantId, operationId, {
      mayHaveBeenSent: !isConflict,
      conflict: isConflict,
      lastError: isConflict ? error.message : undefined
    });
    return { outcome: isConflict ? 'CONFLICT' : 'QUEUED', error };
  }
}
