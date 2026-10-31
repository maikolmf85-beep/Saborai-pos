import type { AuthContext } from './security.js';

export const EMPLOYEE_ROLES = ['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'] as const;
export type EmployeeRole = typeof EMPLOYEE_ROLES[number];

export interface NormalizedEmployeeRosterEntry {
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: EmployeeRole;
  active: boolean;
  pin: string | null;
}

export function isEmployeeRole(role: unknown): role is EmployeeRole {
  return typeof role === 'string' && EMPLOYEE_ROLES.includes(role as EmployeeRole);
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} es inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} es inválido.`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} es inválido.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`${label} es inválido.`);
  return normalized;
}

export function normalizeEmployeeRoster(value: unknown): NormalizedEmployeeRosterEntry[] {
  if (!Array.isArray(value)) throw new Error('El padrón de empleados debe ser una lista.');
  if (value.length > 250) throw new Error('El padrón supera el máximo de 250 colaboradores.');

  const seenIds = new Set<string>();
  return value.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('El padrón contiene un colaborador inválido.');
    }

    const externalId = requiredText(raw.id, 'El identificador del colaborador', 120);
    if (seenIds.has(externalId)) throw new Error('El padrón contiene identificadores duplicados.');
    seenIds.add(externalId);

    const name = requiredText(raw.name, 'El nombre del colaborador', 120);
    if (!isEmployeeRole(raw.role)) throw new Error('El rol del colaborador no es válido.');

    const email = optionalText(raw.email, 'El correo del colaborador', 320)?.toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('El correo del colaborador no es válido.');
    }
    const phone = optionalText(raw.phone, 'El teléfono del colaborador', 40);

    let pin: string | null = null;
    if (raw.pin !== undefined && raw.pin !== null && raw.pin !== '') {
      if (typeof raw.pin !== 'string' || !/^\d{4}$/.test(raw.pin.trim())) {
        throw new Error('El PIN del colaborador debe tener cuatro dígitos.');
      }
      pin = raw.pin.trim();
    }

    if (raw.active !== undefined && typeof raw.active !== 'boolean') {
      throw new Error('El estado del colaborador no es válido.');
    }

    return { externalId, name, email, phone, role: raw.role, active: raw.active !== false, pin };
  });
}

export interface EmployeeSessionOwner {
  id: string;
  email: string;
  active?: boolean | null;
}

export interface EmployeeSessionTenant {
  id: string;
  user_id: string;
}

export interface EmployeeSessionRecord {
  id: string;
  tenant_id: string;
  external_id: string;
  name: string;
  email?: string | null;
  role: unknown;
  is_active?: boolean | null;
}

export function buildEmployeeAuthContext(
  employee: EmployeeSessionRecord | null | undefined,
  tenant: EmployeeSessionTenant | null | undefined,
  owner: EmployeeSessionOwner | null | undefined
): AuthContext | null {
  if (!employee || !tenant || !owner) return null;
  if (employee.is_active === false || owner.active === false) return null;
  if (!employee.id || !employee.external_id || employee.tenant_id !== tenant.id || tenant.user_id !== owner.id) return null;
  if (!isEmployeeRole(employee.role)) return null;

  return {
    userId: owner.id,
    email: typeof employee.email === 'string' && employee.email ? employee.email : owner.email,
    role: employee.role,
    tenantId: tenant.id,
    employeeId: employee.id,
    employeeExternalId: employee.external_id,
    employeeName: employee.name
  };
}

export function buildEmployeeTokenClaims(
  employee: Pick<EmployeeSessionRecord, 'id'>,
  tenant: EmployeeSessionTenant,
  owner: EmployeeSessionOwner
) {
  return {
    userId: owner.id,
    email: owner.email,
    identityType: 'employee',
    employeeId: employee.id,
    tenantId: tenant.id
  };
}

export function employeeSessionActorMatches(
  actorUserId: unknown,
  actorEmployeeId: unknown,
  auth: Pick<AuthContext, 'userId' | 'employeeId'>
): boolean {
  if (actorUserId !== auth.userId) return false;
  if (actorEmployeeId === null) return !auth.employeeId;
  return typeof actorEmployeeId === 'string' && actorEmployeeId === auth.employeeId;
}
