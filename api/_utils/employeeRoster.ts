import type { AuthContext } from './security.js';

export type EmployeeRosterReadMode = 'operational' | 'contacts';

export type EmployeeRosterReadAccess =
  | { allowed: false; status: 401 | 403; error: string }
  | { allowed: true; tenantId: string; userId: string; includeContacts: boolean };

export function authorizeEmployeeRosterRead(
  auth: AuthContext | null,
  mode: EmployeeRosterReadMode
): EmployeeRosterReadAccess {
  if (!auth) return { allowed: false, status: 401, error: 'No autorizado.' };
  if (!auth.tenantId) {
    return { allowed: false, status: 403, error: 'La sesión no tiene un tenant asociado.' };
  }
  if (mode === 'contacts' && auth.role !== 'ADMIN') {
    return { allowed: false, status: 403, error: 'No tienes permisos para realizar esta operación.' };
  }
  return {
    allowed: true,
    tenantId: auth.tenantId,
    userId: auth.userId,
    includeContacts: mode === 'contacts'
  };
}

interface EmployeeRow {
  external_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  is_active: boolean;
}

interface OwnerRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  restaurant_name?: string | null;
  role: string;
  active: boolean;
}

export function buildEmployeeRosterPayload(
  access: Extract<EmployeeRosterReadAccess, { allowed: true }>,
  owner: OwnerRow,
  employees: EmployeeRow[]
) {
  const ownerProfile = {
    id: owner.id,
    name: owner.name,
    ...(access.includeContacts ? {
      email: owner.email || '',
      phone: owner.phone || '',
      restaurantName: owner.restaurant_name || ''
    } : {}),
    role: owner.role,
    active: owner.active
  };
  const roster = employees.map(employee => ({
    id: employee.external_id,
    name: employee.name,
    ...(access.includeContacts ? {
      email: employee.email || '',
      phone: employee.phone || '',
      restaurantName: owner.restaurant_name || ''
    } : {}),
    role: employee.role,
    active: employee.is_active
  }));

  return {
    success: true,
    tenantId: access.tenantId,
    owner: ownerProfile,
    employees: roster
  };
}
