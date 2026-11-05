import type { TableItem } from '../types';

export function createDispatchOperationId(tenantId: string, orderNumber: string, lineItemId: string): string {
  return `dispatch:${tenantId}:${orderNumber}:${lineItemId}`.slice(0, 160);
}

export function getUndispatchedItems<T extends Pick<TableItem, 'inventoryDeductedAtDispatch'>>(items: T[]): T[] {
  return items.filter(item => item.inventoryDeductedAtDispatch !== true);
}

export function toInventoryDispatchItem(item: Pick<TableItem, 'id' | 'menuItemId' | 'name' | 'quantity'>) {
  return {
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.name,
    quantity: item.quantity
  };
}
