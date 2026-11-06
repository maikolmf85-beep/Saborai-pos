// Backend checks this matrix against the persisted account or employee role, never a client-sent role.
// Employee identity is reloaded from the tenant-scoped roster for each request.
export const ROLE_PERMISSIONS = {
  haciendaSettings: ['ADMIN'],
  haciendaOperations: ['ADMIN', 'CAJERO'],
  haciendaHistory: ['ADMIN', 'CAJERO'],
  offlineSync: {
    UPDATE_TABLE: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    PAYMENT: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    DEDUCT_INVENTORY: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    DISPATCH_INVENTORY: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    LOAD_INVENTORY_CONFIG: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    SAVE_INVENTORY_CONFIG: ['ADMIN', 'CAJERO'],
    ADJUST_INVENTORY: ['ADMIN', 'CAJERO'],
    EMIT_INVOICE: ['ADMIN', 'CAJERO'],
    CLOSE_CASH_SHIFT: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    CLOSE_DAILY_CASH: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    GET_DAILY_CASH_STATUS: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    OPEN_DAILY_CASH: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    IMPORT_CASH_SHIFT: ['ADMIN', 'CAJERO', 'SALONERO_CAJA'],
    ASSIGN_CASH_TERMINAL: ['ADMIN', 'CAJERO', 'SALONERO_CAJA']
  }
} as const;

export function hasRolePermission(role: unknown, allowedRoles: readonly string[]): boolean {
  return typeof role === 'string' && allowedRoles.includes(role);
}
