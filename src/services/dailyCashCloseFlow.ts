import type { DailyCashStatus } from '../types/cashShift';
import type { DailyCashCloseTarget } from './cashControlSync';

export interface PendingDailyCashSyncItem {
  action: string;
}

export async function closeDailyCashAfterSync<T>(options: {
  tenantId: string;
  registerId: string;
  status: DailyCashStatus | null;
  openTablesCount: number;
  syncPending: (tenantId: string) => Promise<unknown>;
  getPendingItems: (tenantId: string) => Promise<PendingDailyCashSyncItem[]>;
  flushCloudSync: (target: DailyCashCloseTarget) => Promise<unknown>;
  closeRemotely: (target: DailyCashCloseTarget) => Promise<T>;
  commitLocally: (result: T) => void;
}): Promise<T> {
  const { tenantId, registerId, status, openTablesCount } = options;
  if (!status?.isOpen || status.isClosed) {
    throw new Error('Primero debe abrirse la caja del día antes de cerrarla.');
  }
  if (openTablesCount > 0) {
    throw new Error(`No se puede cerrar la caja del día: ${openTablesCount} mesa(s) tienen una comanda abierta.`);
  }
  if (!tenantId) throw new Error('No se pudo confirmar el restaurante para cerrar la caja del día.');
  if (!registerId || !status.registerId || !status.businessDate || !status.timezone) {
    throw new Error('No se pudo confirmar la caja, la fecha local o la sucursal para cerrar el día.');
  }

  await options.syncPending(tenantId);
  const pendingPayments = (await options.getPendingItems(tenantId))
    .filter(item => item.action === 'PAYMENT');
  if (pendingPayments.length > 0) {
    throw new Error('Hay cobros pendientes de sincronizar. Sincronízalos antes de cerrar para incluir todas las operaciones del día.');
  }

  const target: DailyCashCloseTarget = {
    kind: 'daily',
    tenantId,
    registerId,
    cloudRegisterId: status.registerId,
    businessDate: status.businessDate,
    timezone: status.timezone
  };
  await options.flushCloudSync(target);

  const result = await options.closeRemotely(target);
  options.commitLocally(result);
  return result;
}
