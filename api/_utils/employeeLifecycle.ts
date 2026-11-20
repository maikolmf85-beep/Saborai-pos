import type { AuthContext } from './security.js';

export type EmployeeDeactivationRpcArgs = {
  p_tenant_id: string;
  p_employee_external_id: string;
  p_actor_user_id: string;
  p_actor_employee_id: string | null;
  p_reason: string;
  p_request_id: string;
};

export function buildEmployeeDeactivationRpcArgs(
  auth: Pick<AuthContext, 'userId' | 'employeeId'> & { tenantId: string },
  employeeExternalId: string,
  reason: string,
  requestId: string
): EmployeeDeactivationRpcArgs {
  return {
    p_tenant_id: auth.tenantId,
    p_employee_external_id: employeeExternalId,
    p_actor_user_id: auth.userId,
    p_actor_employee_id: auth.employeeId || null,
    p_reason: reason,
    p_request_id: requestId
  };
}

export function isSuccessfulEmployeeDeactivation(
  value: unknown,
  expectedEmployeeExternalId: string
): value is { success: true; deactivated: boolean; alreadyDeactivated: boolean; employeeId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.success === true
    && typeof result.deactivated === 'boolean'
    && typeof result.alreadyDeactivated === 'boolean'
    && result.employeeId === expectedEmployeeExternalId;
}

export interface EmployeeDeactivationHttpError {
  status: number;
  code: string;
  message: string;
}

const ERROR_RULES: Array<[string, number, string, string]> = [
  ['OWNER_EMPLOYEE_REMOVAL_NOT_ALLOWED', 403, 'OWNER_EMPLOYEE_REMOVAL_NOT_ALLOWED', 'La cuenta propietaria del restaurante no se puede eliminar como colaborador.'],
  ['SELF_EMPLOYEE_REMOVAL_NOT_ALLOWED', 403, 'SELF_EMPLOYEE_REMOVAL_NOT_ALLOWED', 'No puedes eliminar el colaborador con el que tienes la sesión abierta.'],
  ['ACTIVE_ADMIN_REQUIRED', 403, 'ACTIVE_ADMIN_REQUIRED', 'Solo un administrador activo puede eliminar colaboradores.'],
  ['ACTOR_TENANT_MISMATCH', 403, 'ACTOR_TENANT_MISMATCH', 'El colaborador no pertenece a este restaurante.'],
  ['ACTIVE_TENANT_OWNER_REQUIRED', 403, 'ACTIVE_TENANT_OWNER_REQUIRED', 'La cuenta propietaria del restaurante no está disponible.'],
  ['TENANT_SCOPE_REQUIRED', 403, 'TENANT_SCOPE_REQUIRED', 'No se pudo validar el restaurante de la sesión.'],
  ['EMPLOYEE_NOT_FOUND_IN_TENANT', 404, 'EMPLOYEE_NOT_FOUND_IN_TENANT', 'No se encontró ese colaborador en este restaurante.'],
  ['LAST_ACTIVE_ADMIN', 409, 'LAST_ACTIVE_ADMIN', 'No se puede eliminar al último administrador activo.'],
  ['EMPLOYEE_HAS_OPEN_V2_ORDER', 409, 'EMPLOYEE_HAS_OPEN_V2_ORDER', 'No se puede eliminar a este colaborador mientras tenga comandas abiertas.'],
  ['WAITER_HAS_OPEN_V2_ORDER', 409, 'EMPLOYEE_HAS_OPEN_V2_ORDER', 'No se puede eliminar a este colaborador mientras tenga comandas abiertas.'],
  ['WAITER_MEMBERSHIP_HAS_OPEN_V2_ORDER', 409, 'EMPLOYEE_HAS_OPEN_V2_ORDER', 'No se puede eliminar a este colaborador mientras tenga comandas abiertas.'],
  ['EMPLOYEE_STATUS_CHANGE_REQUIRES_LIFECYCLE_RPC', 409, 'EMPLOYEE_STATUS_CHANGE_REQUIRES_LIFECYCLE_RPC', 'No se pudo cambiar el acceso del colaborador desde la sincronización del padrón.'],
  ['INVALID_EMPLOYEE_REMOVAL_REQUEST', 400, 'INVALID_EMPLOYEE_REMOVAL_REQUEST', 'Los datos para eliminar al colaborador no son válidos.'],
  ['INVALID_EMPLOYEE_REMOVAL_REASON', 400, 'INVALID_EMPLOYEE_REMOVAL_REASON', 'El motivo de eliminación no es válido.']
];

export function mapEmployeeDeactivationError(error: unknown): EmployeeDeactivationHttpError {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const searchable = [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const rule = ERROR_RULES.find(([marker]) => searchable.includes(marker));
  if (rule) return { status: rule[1], code: rule[2], message: rule[3] };
  return {
    status: 503,
    code: 'EMPLOYEE_DEACTIVATION_FAILED',
    message: 'No se pudo eliminar al colaborador. Inténtalo de nuevo o contacta soporte.'
  };
}
