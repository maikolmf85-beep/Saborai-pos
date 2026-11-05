import { createHash } from 'node:crypto';

function stableUuid(value: string): string {
  const bytes = createHash('sha1').update(`saborai-pos:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeInventoryName(value: unknown): string {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function localIngredientId(value: unknown): string {
  return `ingredient:${encodeURIComponent(normalizeInventoryName(value)).slice(0, 180)}`;
}

export function cloudMenuItemId(tenantId: string, branchId: string, localMenuItemId: string): string {
  return stableUuid(`menu:${tenantId}:${branchId}:${localMenuItemId}`);
}

export function cloudIngredientId(tenantId: string, branchId: string, localId: string): string {
  return stableUuid(`ingredient:${tenantId}:${branchId}:${localId}`);
}
