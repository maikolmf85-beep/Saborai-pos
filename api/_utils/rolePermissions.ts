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
    EMIT_INVOICE: ['ADMIN', 'CAJERO']
  },
  directWrites: {
    SAVE_TABLE_LAYOUT: ['ADMIN'],
    SEED_TABLE_LAYOUT: ['ADMIN'],
    UPSERT_TABLE_RESERVATION: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    DELETE_TABLE_RESERVATION: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    CASH_CONTROL_SYNC: ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'],
    CASH_CONTROL_IMPORT: ['ADMIN']
  }
} as const;

export function hasRolePermission(role: unknown, allowedRoles: readonly string[]): boolean {
  return typeof role === 'string' && allowedRoles.includes(role);
}
