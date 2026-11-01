import type { KDSOrder, Table, TableItem } from '../types';

export interface TransferOrderItemResult {
  tables: Table[];
  sourceTable: Table;
  destinationTable: Table;
  movedItem: TableItem;
  kdsOrders: KDSOrder[];
}

function createUniqueId(prefix: string, existingIds: Set<string>): string {
  let id = '';
  do {
    const randomPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    id = `${prefix}_${Date.now()}_${randomPart}`;
  } while (existingIds.has(id));
  return id;
}

function moveKdsItem(
  orders: KDSOrder[],
  sourceItem: TableItem,
  movedItem: TableItem,
  quantity: number,
  destinationTable: Table
): { orders: KDSOrder[]; movedItem: TableItem } {
  if (!sourceItem.kdsOrderId) return { orders, movedItem };

  const sourceOrderIndex = orders.findIndex(order => order.id === sourceItem.kdsOrderId);
  if (sourceOrderIndex < 0) return { orders, movedItem };

  const sourceOrder = orders[sourceOrderIndex];
  const sourceKdsItemIndex = sourceOrder.items.findIndex(item => item.id === sourceItem.id);
  if (sourceKdsItemIndex < 0) return { orders, movedItem };

  const sourceKdsItem = sourceOrder.items[sourceKdsItemIndex];
  const remainingKdsQuantity = sourceKdsItem.quantity - quantity;
  const updatedSourceItems = remainingKdsQuantity > 0
    ? sourceOrder.items.map((item, index) => index === sourceKdsItemIndex
      ? { ...item, quantity: remainingKdsQuantity }
      : item)
    : sourceOrder.items.filter((_, index) => index !== sourceKdsItemIndex);

  const transferOrderIds = new Set(orders.map(order => order.id));
  const transferOrderId = createUniqueId('kds_transfer', transferOrderIds);
  const destinationKdsItem = {
    ...sourceKdsItem,
    id: movedItem.id,
    quantity
  };
  const transferOrder: KDSOrder = {
    ...sourceOrder,
    id: transferOrderId,
    tableNumber: destinationTable.number,
    tableName: destinationTable.name,
    server: destinationTable.activeOrder?.server || sourceOrder.server,
    items: [destinationKdsItem],
    isTransfer: true
  };

  const nextOrders = orders.flatMap((order, index) => {
    if (index !== sourceOrderIndex) return [order];
    if (updatedSourceItems.length === 0) return [];
    return [{ ...order, items: updatedSourceItems }];
  });
  nextOrders.push(transferOrder);

  return {
    orders: nextOrders,
    movedItem: { ...movedItem, kdsOrderId: transferOrderId }
  };
}

/**
 * Moves a product line between already-open table orders. It deliberately does
 * not open or close tables: those lifecycle rules remain with the POS flow.
 */
export function transferOrderItemAcrossTables(
  tables: Table[],
  kdsOrders: KDSOrder[],
  sourceTable: Table,
  destinationTableId: string,
  itemId: string,
  quantity: number
): TransferOrderItemResult | null {
  const sourceOrder = sourceTable.activeOrder;
  const destinationFromTables = tables.find(table => table.id === destinationTableId);

  if (
    !sourceOrder ||
    !destinationFromTables ||
    sourceTable.id === destinationFromTables.id ||
    !destinationFromTables.activeOrder ||
    !['OCCUPIED', 'PRE_CHECK'].includes(destinationFromTables.status) ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    return null;
  }

  const sourceItem = sourceOrder.items.find(item => item.id === itemId);
  if (!sourceItem || quantity > sourceItem.quantity) return null;

  const destinationSubAccounts = destinationFromTables.activeOrder.subAccounts?.length
    ? destinationFromTables.activeOrder.subAccounts
    : [{ id: 1, name: 'Cuenta 1' }];
  const destinationAccount = destinationSubAccounts[0];
  const existingItemIds = new Set(
    tables.flatMap(table => table.activeOrder?.items.map(item => item.id) || [])
  );
  sourceOrder.items.forEach(item => existingItemIds.add(item.id));

  const movedItemId = quantity === sourceItem.quantity
    ? sourceItem.id
    : createUniqueId('item_transfer', existingItemIds);
  const baseMovedItem: TableItem = {
    ...sourceItem,
    id: movedItemId,
    quantity,
    subAccountId: destinationAccount.id,
    dinerName: destinationAccount.name
  };
  const { orders: nextKdsOrders, movedItem } = moveKdsItem(
    kdsOrders,
    sourceItem,
    baseMovedItem,
    quantity,
    destinationFromTables
  );

  const sourceItems = quantity === sourceItem.quantity
    ? sourceOrder.items.filter(item => item.id !== sourceItem.id)
    : sourceOrder.items.map(item => item.id === sourceItem.id
      ? { ...item, quantity: item.quantity - quantity }
      : item);
  const updatedSourceTable: Table = {
    ...sourceTable,
    activeOrder: { ...sourceOrder, items: sourceItems }
  };
  const updatedDestinationTable: Table = {
    ...destinationFromTables,
    activeOrder: {
      ...destinationFromTables.activeOrder,
      subAccounts: destinationSubAccounts,
      items: [...destinationFromTables.activeOrder.items, movedItem]
    }
  };

  const nextTables = tables.map(table => table.id === destinationTableId
    ? updatedDestinationTable
    : table.id === sourceTable.id
      ? updatedSourceTable
      : table);
  if (!tables.some(table => table.id === sourceTable.id)) nextTables.push(updatedSourceTable);

  return {
    tables: nextTables,
    sourceTable: updatedSourceTable,
    destinationTable: updatedDestinationTable,
    movedItem,
    kdsOrders: nextKdsOrders
  };
}
