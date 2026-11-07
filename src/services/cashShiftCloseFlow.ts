import type { CashShift } from '../types/cashShift';
import type { CashShiftCloseTarget } from './cashControlSync';

export type CashShiftCloseState = Pick<CashShift, 'id' | 'status' | 'cashRegisterId'>;

export interface PendingCashSyncItem {
  action: string;
}

export async function closeCashShiftAfterSync<T>(options: {
  tenantId: string;
  registerId: string;
  shift: CashShiftCloseState | null;
  syncPending: (tenantId: string) => Promise<unknown>;
  getPendingItems: (tenantId: string) => Promise<PendingCashSyncItem[]>;
  flushCloudSync: (target: CashShiftCloseTarget) => Promise<unknown>;
  getActiveShift: (registerId: string) => CashShiftCloseState | null;
  closeShift: () => Promise<T>;
}): Promise<T> {
  const { tenantId, registerId, shift } = options;
  if (!tenantId) throw new Error('No se pudo confirmar el restaurante para cerrar el turno.');
  if (!registerId || !shift || shift.status !== 'OPEN' || shift.cashRegisterId !== registerId) {
    throw new Error('No se puede confirmar el turno abierto asociado a la caja seleccionada. Actualiza el estado e inténtalo de nuevo.');
  }

  await options.syncPending(tenantId);
  const pendingPayments = (await options.getPendingItems(tenantId))
    .filter(item => item.action === 'PAYMENT');
  if (pendingPayments.length > 0) {
    throw new Error('Hay cobros pendientes de sincronizar. Conecta el dispositivo y sincronízalos antes de cerrar para conservar su atribución al turno.');
  }

  const target: CashShiftCloseTarget = { kind: 'shift', shiftId: shift.id, registerId };
  await options.flushCloudSync(target);

  const confirmedLocalShift = options.getActiveShift(registerId);
  if (!confirmedLocalShift
    || confirmedLocalShift.id !== target.shiftId
    || confirmedLocalShift.status !== 'OPEN'
    || confirmedLocalShift.cashRegisterId !== registerId) {
    throw new Error('No se pudo confirmar que el mismo turno siga abierto en la caja seleccionada. Actualiza el estado e inténtalo de nuevo.');
  }

  return options.closeShift();
}
