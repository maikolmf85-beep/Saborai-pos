import type { UserProfile } from '../types';

export interface EmployeeSessionResult {
  token: string;
  user: UserProfile;
  employeeSession: boolean;
  accountUserId: string;
  employeeId: string;
}

function currentToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
}

async function readResponse(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo validar la sesión del colaborador.');
  return data;
}

export function isCloudTenantId(tenantId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId);
}

export function withoutEmployeePin<T extends { pin?: string }>(member: T): Omit<T, 'pin'> {
  const { pin: _pin, ...safeMember } = member;
  return safeMember;
}

export async function syncEmployeeRoster(tenantId: string, employees: UserProfile[]): Promise<void> {
  const token = currentToken();
  if (!token) throw new Error('No hay una sesión autenticada para sincronizar el padrón.');

  const response = await fetch('/api/auth/employee-roster', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      tenantId,
      employees: employees.map(member => ({
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        role: member.role,
        active: member.active !== false,
        ...(typeof member.pin === 'string' && member.pin.trim() ? { pin: member.pin.trim() } : {})
      }))
    })
  });
  await readResponse(response);
}

export async function fetchEmployeeRoster(tenantId: string): Promise<UserProfile[]> {
  const token = currentToken();
  if (!token) throw new Error('No hay una sesión autenticada para cargar el padrón.');
  const response = await fetch('/api/auth/employee-roster', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await readResponse(response);
  if (data.tenantId !== tenantId || !data.owner || !Array.isArray(data.employees)) {
    throw new Error('El servidor devolvió un padrón para otro tenant o incompleto.');
  }
  const mapProfile = (member: any): UserProfile => ({
    id: String(member.id || ''),
    name: String(member.name || ''),
    email: String(member.email || ''),
    phone: String(member.phone || ''),
    restaurantName: String(member.restaurantName || ''),
    role: member.role,
    active: member.active !== false
  });
  return [mapProfile(data.owner), ...data.employees.map(mapProfile)].filter(member => Boolean(member.id));
}

export async function createEmployeeSession(
  tenantId: string,
  employeeId: string,
  pin?: string
): Promise<EmployeeSessionResult> {
  const token = currentToken();
  const response = await fetch('/api/auth/employee-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && !pin ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ tenantId, employeeId, ...(pin ? { pin } : {}) })
  });
  const data = await readResponse(response);
  if (typeof data.token !== 'string' || !data.user || typeof data.user.id !== 'string'
    || typeof data.accountUserId !== 'string' || typeof data.employeeId !== 'string') {
    throw new Error('El servidor no devolvió una sesión válida para el colaborador.');
  }
  const user: UserProfile = {
    id: data.user.id,
    name: String(data.user.name || ''),
    email: String(data.user.email || ''),
    phone: String(data.user.phone || ''),
    restaurantName: String(data.user.restaurant_name || ''),
    role: data.user.role,
    active: data.user.active !== false
  };
  return {
    token: data.token,
    user,
    employeeSession: data.employeeSession === true,
    accountUserId: data.accountUserId,
    employeeId: data.employeeId
  };
}
