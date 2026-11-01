// Backend checks this matrix against the persisted account or employee role, never a client-sent role.
// Employee identity is reloaded from the tenant-scoped roster for each request.
export const ROLE_PERMISSIONS = {
  haciendaSettings: ['ADMIN'],
  haciendaOperations: ['ADMIN', 'CAJERO'],
  haciendaHistory: ['ADMIN', 'CAJERO'],
  cashShiftCloseOverride: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
  offlineSync: {
    UPDATE_TABLE: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    TRANSFER_TABLE_ITEM: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    OPEN_CASH_SHIFT: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    CLOSE_CASH_SHIFT: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    PAYMENT: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    DEDUCT_INVENTORY: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    EMIT_INVOICE: ['ADMIN', 'CAJERO']
  }
} as const;

export function hasRolePermission(role: unknown, allowedRoles: readonly string[]): boolean {
  return typeof role === 'string' && allowedRoles.includes(role);
}
