import type { Table, UserProfile } from '../types';

const TABLE_WAITER_ROLES = new Set<UserProfile['role']>([
  'SALONERO',
  'WAITER',
  'SALONERO_CAJA',
  'CAJERO',
  'ADMIN'
]);

export const getTableAssigneeRoleLabel = (role: UserProfile['role']): string => {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'CAJERO':
      return 'Cajero';
    case 'SALONERO_CAJA':
      return 'Salonero con Caja';
    case 'SALONERO':
    case 'WAITER':
    default:
      return 'Salonero';
  }
};

export const isAssignableTableWaiter = (staff: UserProfile): boolean =>
  staff.active !== false && TABLE_WAITER_ROLES.has(staff.role);

export const getAssignableTableWaiters = (
  staffList: UserProfile[],
  currentUser?: UserProfile | null
): UserProfile[] => {
  const candidates = currentUser ? [...staffList, currentUser] : staffList;
  const seenIds = new Set<string>();

  return candidates.filter((staff) => {
    if (!isAssignableTableWaiter(staff) || seenIds.has(staff.id)) return false;
    seenIds.add(staff.id);
    return true;
  });
};

export const assignTableWaiter = (
  table: Table,
  waiter: UserProfile,
  defaults: { orderNumber?: string; openedAt?: string } = {}
): Table => ({
  ...table,
  status: table.status === 'AVAILABLE' ? 'OCCUPIED' : table.status,
  activeOrder: {
    ...(table.activeOrder || {}),
    orderNumber: table.activeOrder?.orderNumber || defaults.orderNumber || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    server: waiter.name,
    openedAt: table.activeOrder?.openedAt || defaults.openedAt || new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
    subAccounts: table.activeOrder?.subAccounts || [{ id: 1, name: 'Cuenta 1' }],
    items: table.activeOrder?.items || []
  }
});
