import type { KDSOrder, Table } from '../types';
import type { CashRegister, CashShift } from '../types/cashShift';

export function getTransferableZonesForBranch(
  registers: Pick<CashRegister, 'id' | 'branchCode' | 'linkedZone' | 'linkedZones'>[],
  shifts: Pick<CashShift, 'cashRegisterId' | 'linkedZone' | 'linkedZones' | 'status'>[],
  branchCode: string
): string[] {
  if (!branchCode) return [];
  const zones = new Set<string>();
  for (const shift of shifts) {
    if (shift.status !== 'OPEN' || !shift.cashRegisterId) continue;
    const register = registers.find(item => item.id === shift.cashRegisterId);
    if (!register || register.branchCode !== branchCode) continue;
    const shiftZones = shift.linkedZones?.length
      ? shift.linkedZones
      : shift.linkedZone
        ? [shift.linkedZone]
        : register.linkedZones?.length
          ? register.linkedZones
          : register.linkedZone
            ? [register.linkedZone]
            : [];
    shiftZones.map(zone => zone.trim()).filter(Boolean).forEach(zone => zones.add(zone));
  }
  return [...zones];
}

export interface TransferTableAccountResult {
  tables: Table[];
  sourceTable: Table;
  destinationTable: Table;
  kdsOrders: KDSOrder[];
}

/**
 * Move a whole open table account to an empty table in an authorized salon of the same branch.
 * The ActiveOrder is deliberately transferred unchanged, preserving its order
 * number, subaccounts, item array order and all item metadata.
 */
export function transferTableAccount(
  tables: Table[],
  kdsOrders: KDSOrder[],
  sourceTableId: string,
  destinationTableId: string,
  transferableZones: readonly string[]
): TransferTableAccountResult | null {
  const source = tables.find(table => table.id === sourceTableId);
  const destination = tables.find(table => table.id === destinationTableId);

  if (
    !source ||
    !destination ||
    source.id === destination.id ||
    !source.activeOrder ||
    !['OCCUPIED', 'PRE_CHECK'].includes(source.status) ||
    destination.status !== 'AVAILABLE' ||
    destination.activeOrder ||
    !transferableZones.includes(source.zone) ||
    !transferableZones.includes(destination.zone)
  ) {
    return null;
  }

  const movedOrder = source.activeOrder;
  const movedItemIds = new Set(movedOrder.items.map(item => item.id));
  const updatedSourceTable: Table = {
    ...source,
    status: 'AVAILABLE',
    activeOrder: undefined
  };
  const updatedDestinationTable: Table = {
    ...destination,
    status: source.status,
    activeOrder: movedOrder
  };
  const updatedTables = tables.map(table => table.id === source.id
    ? updatedSourceTable
    : table.id === destination.id
      ? updatedDestinationTable
      : table);
  const updatedKdsOrders = movedItemIds.size === 0
    ? kdsOrders
    : kdsOrders.map(order => order.items.some(item => item.id && movedItemIds.has(item.id))
      ? {
          ...order,
          tableNumber: destination.number,
          tableName: destination.name,
          server: movedOrder.server || order.server
        }
      : order);

  return {
    tables: updatedTables,
    sourceTable: updatedSourceTable,
    destinationTable: updatedDestinationTable,
    kdsOrders: updatedKdsOrders
  };
}
