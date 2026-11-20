import {
  isValidCashShiftV2CaptureCashCommand,
  isValidCashShiftV2CaptureSinpeCommand,
  isValidCashShiftV2HeldLineResolutionCommand,
  isValidCashShiftV2OpenShiftCommand,
  isValidCashShiftV2OrderSyncCommand,
  type CashShiftV2BranchFiscalProfile,
  type CashShiftV2CaptureCashCommand,
  type CashShiftV2CaptureSinpeCommand,
  type CashShiftV2HeldLineResolutionCommand,
  type CashShiftV2CloseCommand,
  type CashShiftV2OpenShiftCommand,
  type CashShiftV2OrderSyncCommand,
  type CashShiftV2Role
} from '../../src/services/cashShiftV2Contract.ts';

export type CashShiftV2Operation = 'OPEN_SHIFT' | 'SYNC_ORDER' | 'CAPTURE_PAYMENT' | 'CLOSE_SHIFT' | 'HELD_LINE_RESOLUTION';
export type CashShiftV2RpcName =
  | 'pos_cash_v2_open_shift'
  | 'pos_cash_v2_sync_order'
  | 'pos_cash_v2_capture_payment'
  | 'pos_cash_v2_close_shift'
  | 'pos_cash_v2_resolve_held_line';

export interface CashShiftV2AuthenticatedActor {
  userId: string;
  tenantId?: string;
  employeeId?: string;
  role?: string;
}

export interface CashShiftV2BranchRecord {
  id: string;
  tenantId: string;
  active: boolean;
}

export interface CashShiftV2RegisterRecord {
  id: string;
  tenantId: string;
  branchId: string;
  active: boolean;
}

export interface CashShiftV2DailyOpeningRecord {
  businessDate: string;
  closed: boolean;
}

export interface CashShiftV2BranchModeRecord {
  state: 'OFF' | 'PREPARED' | 'ACTIVE' | 'QUIESCING' | 'FROZEN';
}

export interface CashShiftV2Repository {
  getBranch(tenantId: string, branchId: string): Promise<CashShiftV2BranchRecord | null>;
  getRegister(tenantId: string, branchId: string, cashRegisterId: string): Promise<CashShiftV2RegisterRecord | null>;
  getFiscalProfile(tenantId: string, branchId: string): Promise<CashShiftV2BranchFiscalProfile | null>;
  hasActiveMembership(tenantId: string, branchId: string, employeeId: string): Promise<boolean>;
  getDailyOpening(tenantId: string, branchId: string, cashRegisterId: string): Promise<CashShiftV2DailyOpeningRecord | null>;
  getBranchMode(tenantId: string, branchId: string): Promise<CashShiftV2BranchModeRecord | null>;
  rpc(name: CashShiftV2RpcName, args: Record<string, unknown>): Promise<{ data: unknown; error: null | { code?: string; message?: string } }>;
}

export class CashShiftV2ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CashShiftV2ServiceError';
    this.status = status;
    this.code = code;
  }
}

export type CashShiftV2WriteMode = 'OFF' | 'PREPARED' | 'ACTIVE' | 'QUIESCING' | 'FROZEN' | null;

export function isCashShiftV2RoutingEnabled(globalEnabled: boolean, routeEnabled: string | undefined): boolean {
  return globalEnabled && routeEnabled === 'true';
}

/** Routes a write by authoritative branch mode; V2 failures are never retried through legacy. */
export async function dispatchCashShiftV2AwareWrite<T>(input: {
  action: string;
  mode: CashShiftV2WriteMode;
  v2Enabled: boolean;
  legacy(): Promise<T>;
  v2(): Promise<T>;
}): Promise<{ path: 'LEGACY' | 'V2'; result: T }> {
  const { action, mode, v2Enabled, legacy, v2 } = input;
  if (mode === 'OFF' || mode === 'PREPARED') {
    return { path: 'LEGACY', result: await legacy() };
  }
  if (mode === null) {
    throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_MODE_UNKNOWN', `${action} fue bloqueada: no se pudo determinar el modo de la sucursal.`);
  }
  if (mode === 'ACTIVE') {
    if (!v2Enabled) {
      throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_DISABLED', `${action} fue bloqueada: V2 está deshabilitado para esta sucursal; no se aplicó fallback legacy.`);
    }
    return { path: 'V2', result: await v2() };
  }
  throw new CashShiftV2ServiceError(409, 'CASH_SHIFT_V2_TRANSITION', `${action} fue bloqueada mientras la sucursal V2 está en transición o congelada.`);
}

interface CashShiftV2RequestEnvelope {
  action?: unknown;
  branchId?: unknown;
  cashRegisterId?: unknown;
  idempotencyKey?: unknown;
  tenantId?: unknown;
  actorUserId?: unknown;
  actorEmployeeId?: unknown;
  payload?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPLOYEE_ROLES = new Set<CashShiftV2Role>(['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER']);
const CASH_CONTROL_ROLES = new Set(['ADMIN', 'CAJERO', 'SALONERO_CAJA']);
const ORDER_ROLES = new Set(['ADMIN', 'CAJERO', 'SALONERO', 'SALONERO_CAJA', 'WAITER']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CashShiftV2ServiceError(400, 'INVALID_REQUEST', 'La carga contiene un número no finito.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) throw new CashShiftV2ServiceError(400, 'INVALID_REQUEST', 'La carga no es JSON canónico válido.');
  const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

function digestPayload(operation: CashShiftV2Operation, payload: Record<string, unknown>): Record<string, unknown> {
  if (operation !== 'SYNC_ORDER' || !Object.prototype.hasOwnProperty.call(payload, 'currentWaiterPin')) return payload;
  const { currentWaiterPin: _excludedPin, ...safePayload } = payload;
  return safePayload;
}

async function requestDigest(operation: CashShiftV2Operation, branchId: string, registerId: string, businessDate: string, payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ operation, branchId, registerId, businessDate, payload: digestPayload(operation, payload) }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function readAmount(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(?:\.\d{1,5})?$/.test(value)) return null;
  return value;
}

function amountRespectsTenderCurrency(value: string, currency: 'CRC' | 'USD'): boolean {
  const fraction = value.split('.')[1] ?? '';
  return currency === 'CRC' ? /^0*$/.test(fraction)
    : fraction.length <= 2 || [...fraction.slice(2)].every(digit => digit === '0');
}

function validProfile(profile: CashShiftV2BranchFiscalProfile | null, tenantId: string, branchId: string): profile is CashShiftV2BranchFiscalProfile {
  return !!profile && profile.authority === 'SERVER' && profile.tenantId === tenantId && profile.branchId === branchId
    && profile.priceBasis === 'EXCLUSIVE_OF_VAT'
    && (profile.taxRegime === 'IVA_13' || profile.taxRegime === 'IVA_0');
}

function operationFrom(value: unknown): CashShiftV2Operation {
  if (value === 'OPEN_SHIFT' || value === 'SYNC_ORDER' || value === 'CAPTURE_PAYMENT'
    || value === 'CLOSE_SHIFT' || value === 'HELD_LINE_RESOLUTION') return value;
  throw new CashShiftV2ServiceError(400, 'UNSUPPORTED_OPERATION', 'Operación V2 no permitida.');
}

function actorRole(auth: CashShiftV2AuthenticatedActor): CashShiftV2Role | 'OWNER' {
  if (!auth.employeeId) return 'OWNER';
  if (typeof auth.role !== 'string' || !EMPLOYEE_ROLES.has(auth.role as CashShiftV2Role)) {
    throw new CashShiftV2ServiceError(403, 'INVALID_EMPLOYEE_ROLE', 'El rol de empleado no permite operar V2.');
  }
  return auth.role as CashShiftV2Role;
}

function assertRole(
  operation: CashShiftV2Operation,
  role: CashShiftV2Role | 'OWNER',
  payload: Record<string, unknown>,
  branchCurrency: 'CRC' | 'USD'
): void {
  if (role === 'OWNER') {
    if (operation === 'HELD_LINE_RESOLUTION') {
      throw new CashShiftV2ServiceError(403, 'ROLE_NOT_ALLOWED', 'La resolución de líneas retenidas requiere ADMIN o CAJERO.');
    }
    if (operation === 'CAPTURE_PAYMENT' && payload.method === 'SINPE') {
      throw new CashShiftV2ServiceError(403, 'ROLE_NOT_ALLOWED', 'La evidencia SINPE requiere un actor ADMIN o CAJERO.');
    }
    if (operation === 'CAPTURE_PAYMENT' && payload.method === 'CASH'
      && payload.sourceCurrency !== branchCurrency) {
      throw new CashShiftV2ServiceError(403, 'FX_CASHIER_REQUIRED', 'La conversión de moneda solo puede confirmarla un CAJERO.');
    }
    return;
  }
  const allowed = operation === 'SYNC_ORDER' ? ORDER_ROLES : CASH_CONTROL_ROLES;
  if (!allowed.has(role)) throw new CashShiftV2ServiceError(403, 'ROLE_NOT_ALLOWED', 'El rol no permite esta operación V2.');
  if (operation === 'HELD_LINE_RESOLUTION' && role !== 'ADMIN' && role !== 'CAJERO') {
    throw new CashShiftV2ServiceError(403, 'ROLE_NOT_ALLOWED', 'La resolución de líneas retenidas requiere ADMIN o CAJERO.');
  }
  if (operation === 'CAPTURE_PAYMENT' && payload.method === 'SINPE' && role !== 'ADMIN' && role !== 'CAJERO') {
    throw new CashShiftV2ServiceError(403, 'ROLE_NOT_ALLOWED', 'La evidencia SINPE requiere un actor ADMIN o CAJERO.');
  }
  if (operation === 'CAPTURE_PAYMENT' && payload.method === 'CASH') {
    const sourceCurrency = payload.sourceCurrency;
    if (sourceCurrency !== branchCurrency && role !== 'CAJERO') {
      throw new CashShiftV2ServiceError(403, 'FX_CASHIER_REQUIRED', 'La conversión de moneda solo puede confirmarla un CAJERO.');
    }
  }
}

function commandFor(
  operation: CashShiftV2Operation,
  scope: { tenantId: string; branchId: string; cashRegisterId: string; businessDate: string },
  payload: Record<string, unknown>,
  idempotencyKey: string,
  requestSha256: string,
  branchCurrency: 'CRC' | 'USD'
): { rpc: CashShiftV2RpcName; command: Record<string, unknown> } {
  const request = { idempotencyKey, requestSha256 };
  if (operation === 'OPEN_SHIFT') {
    const command: CashShiftV2OpenShiftCommand = {
      scope, logicalShift: payload.logicalShift as 1 | 2,
      openingFloat: String(payload.openingFloat ?? ''), request
    };
    if (!isValidCashShiftV2OpenShiftCommand(command)
      || !amountRespectsTenderCurrency(command.openingFloat, branchCurrency)) {
      throw new CashShiftV2ServiceError(400, 'INVALID_OPEN_SHIFT', 'La apertura de turno no cumple el contrato decimal V2.');
    }
    return { rpc: 'pos_cash_v2_open_shift', command: command as unknown as Record<string, unknown> };
  }
  if (operation === 'SYNC_ORDER') {
    const command: CashShiftV2OrderSyncCommand = {
      scope, sessionId: String(payload.sessionId ?? ''),
      ...(payload.orderId === undefined ? {} : { orderId: String(payload.orderId) }),
      tableId: String(payload.tableId ?? ''), tableName: String(payload.tableName ?? ''),
      waiterEmployeeId: String(payload.waiterEmployeeId ?? ''),
      ...(payload.currentWaiterPin === undefined ? {} : { currentWaiterPin: payload.currentWaiterPin as string }),
      lines: Array.isArray(payload.lines) ? payload.lines as CashShiftV2OrderSyncCommand['lines'] : [],
      request
    };
    if (!isValidCashShiftV2OrderSyncCommand(command)) {
      throw new CashShiftV2ServiceError(400, 'INVALID_ORDER_SYNC', 'La sincronización de orden no cumple el contrato V2.');
    }
    return { rpc: 'pos_cash_v2_sync_order', command: command as unknown as Record<string, unknown> };
  }
  if (operation === 'CAPTURE_PAYMENT') {
    if (payload.method === 'CASH') {
      const command: CashShiftV2CaptureCashCommand = {
        scope, orderId: String(payload.orderId ?? ''), receivingSessionId: String(payload.receivingSessionId ?? ''),
        sourceAmount: String(payload.sourceAmount ?? ''), sourceCurrency: payload.sourceCurrency as 'CRC' | 'USD',
        branchCurrency, explicitCashConfirmation: payload.explicitCashConfirmation as true,
        ...(payload.fx === undefined ? {} : { fx: payload.fx as CashShiftV2CaptureCashCommand['fx'] }), request
      };
      if (!isValidCashShiftV2CaptureCashCommand(command)) {
        throw new CashShiftV2ServiceError(400, 'INVALID_CASH_PAYMENT', 'El cobro CASH no cumple el contrato V2.');
      }
      return { rpc: 'pos_cash_v2_capture_payment', command: { ...command, method: 'CASH' } };
    }
    if (payload.method === 'SINPE') {
      const command: CashShiftV2CaptureSinpeCommand = {
        scope, orderId: String(payload.orderId ?? ''), receivingSessionId: String(payload.receivingSessionId ?? ''),
        amount: String(payload.amount ?? ''), currency: payload.currency as 'CRC' | 'USD', branchCurrency,
        externalReference: String(payload.externalReference ?? ''),
        explicitEvidenceConfirmation: payload.explicitEvidenceConfirmation as true, request
      };
      if (!isValidCashShiftV2CaptureSinpeCommand(command)) {
        throw new CashShiftV2ServiceError(400, 'INVALID_SINPE_PAYMENT', 'La evidencia SINPE no cumple el contrato V2.');
      }
      return { rpc: 'pos_cash_v2_capture_payment', command: { ...command, method: 'SINPE' } };
    }
    throw new CashShiftV2ServiceError(400, 'PAYMENT_METHOD_NOT_ALLOWED', 'V2 solo admite líneas CASH o SINPE.');
  }

  if (operation === 'HELD_LINE_RESOLUTION') {
    const command: CashShiftV2HeldLineResolutionCommand = {
      scope,
      orderId: String(payload.orderId ?? ''),
      lineId: String(payload.lineId ?? ''),
      resolution: payload.resolution as CashShiftV2HeldLineResolutionCommand['resolution'],
      ...(payload.linkedMenuItemId === undefined ? {} : { linkedMenuItemId: String(payload.linkedMenuItemId) }),
      ...(payload.reason === undefined ? {} : { reason: String(payload.reason) }),
      ...(payload.explicitConfirmation === undefined ? {} : { explicitConfirmation: payload.explicitConfirmation as true }),
      request
    };
    if (!isValidCashShiftV2HeldLineResolutionCommand(command)) {
      throw new CashShiftV2ServiceError(400, 'INVALID_HELD_LINE_RESOLUTION', 'La resolución de la línea retenida no cumple el contrato V2.');
    }
    return { rpc: 'pos_cash_v2_resolve_held_line', command: command as unknown as Record<string, unknown> };
  }

  const count = readAmount(payload.countedCash);
  const sessionId = payload.sessionId;
  const logicalShift = payload.logicalShift;
  if (!count || !amountRespectsTenderCurrency(count, branchCurrency) || !isNonEmptyString(sessionId)
    || (logicalShift !== 1 && logicalShift !== 2)) {
    throw new CashShiftV2ServiceError(400, 'INVALID_CLOSE_SHIFT', 'El cierre no cumple el contrato de monto, sesión y turno V2.');
  }
  const command: CashShiftV2CloseCommand = {
    scope, sessionId, logicalShift, countedCash: count, request
  };
  return { rpc: 'pos_cash_v2_close_shift', command: command as unknown as Record<string, unknown> };
}

function rpcArguments(
  auth: CashShiftV2AuthenticatedActor,
  role: CashShiftV2Role | 'OWNER',
  scope: { tenantId: string; branchId: string; cashRegisterId: string; businessDate: string },
  idempotencyKey: string,
  requestSha256: string,
  command: Record<string, unknown>
): Record<string, unknown> {
  return {
    p_tenant_id: scope.tenantId,
    p_branch_id: scope.branchId,
    p_cash_register_id: scope.cashRegisterId,
    p_business_date: scope.businessDate,
    p_actor_user_id: auth.userId,
    p_actor_employee_id: auth.employeeId || null,
    p_actor_role: role,
    p_idempotency_key: idempotencyKey,
    p_request_sha256: requestSha256,
    p_command: command
  };
}

/**
 * API-side authorization and DTO boundary. SQL RPCs must repeat branch, membership,
 * profile, lock, idempotency and audit checks within their own transaction.
 */
export async function executeCashShiftV2Operation(
  auth: CashShiftV2AuthenticatedActor,
  request: CashShiftV2RequestEnvelope,
  repository: CashShiftV2Repository
): Promise<unknown> {
  if (!auth || !isNonEmptyString(auth.userId) || !isNonEmptyString(auth.tenantId)) {
    throw new CashShiftV2ServiceError(401, 'UNAUTHENTICATED', 'La sesión no tiene tenant autenticado.');
  }
  if (request.tenantId !== undefined || request.actorUserId !== undefined || request.actorEmployeeId !== undefined) {
    throw new CashShiftV2ServiceError(400, 'CLIENT_ACTOR_FORBIDDEN', 'Tenant y actor se derivan exclusivamente de la sesión autenticada.');
  }
  const operation = operationFrom(request.action);
  if (!isNonEmptyString(request.branchId) || !UUID_RE.test(request.branchId)
    || !isNonEmptyString(request.cashRegisterId) || !UUID_RE.test(request.cashRegisterId)
    || !isNonEmptyString(request.idempotencyKey) || request.idempotencyKey.length > 200
    || !isRecord(request.payload)) {
    throw new CashShiftV2ServiceError(400, 'INVALID_ENVELOPE', 'La operación requiere sucursal, caja, clave idempotente y payload válidos.');
  }
  const role = actorRole(auth);
  const allowedPayloadKeys: Record<CashShiftV2Operation, readonly string[]> = {
    OPEN_SHIFT: ['logicalShift', 'openingFloat'],
    SYNC_ORDER: ['sessionId', 'orderId', 'tableId', 'tableName', 'waiterEmployeeId', 'currentWaiterPin', 'lines'],
    CAPTURE_PAYMENT: ['method', 'orderId', 'receivingSessionId', 'sourceAmount', 'sourceCurrency', 'explicitCashConfirmation', 'fx', 'amount', 'currency', 'externalReference', 'explicitEvidenceConfirmation'],
    CLOSE_SHIFT: ['sessionId', 'logicalShift', 'countedCash'],
    HELD_LINE_RESOLUTION: ['orderId', 'lineId', 'resolution', 'linkedMenuItemId', 'reason', 'explicitConfirmation']
  };
  if (Object.keys(request.payload).some(key => !allowedPayloadKeys[operation].includes(key))) {
    throw new CashShiftV2ServiceError(400, 'UNKNOWN_PAYLOAD_FIELD', 'La carga contiene campos no permitidos.');
  }

  const [branch, register, profile, branchMode, opening] = await Promise.all([
    repository.getBranch(auth.tenantId, request.branchId),
    repository.getRegister(auth.tenantId, request.branchId, request.cashRegisterId),
    repository.getFiscalProfile(auth.tenantId, request.branchId),
    repository.getBranchMode(auth.tenantId, request.branchId),
    repository.getDailyOpening(auth.tenantId, request.branchId, request.cashRegisterId)
  ]);
  if (!branch || !branch.active || branch.id !== request.branchId || branch.tenantId !== auth.tenantId) {
    throw new CashShiftV2ServiceError(404, 'BRANCH_NOT_AVAILABLE', 'No existe una sucursal activa para esta operación.');
  }
  if (!register || !register.active || register.tenantId !== auth.tenantId || register.branchId !== branch.id
    || register.id !== request.cashRegisterId) {
    throw new CashShiftV2ServiceError(404, 'REGISTER_NOT_AVAILABLE', 'No existe una caja activa en la sucursal indicada.');
  }
  if (!validProfile(profile, auth.tenantId, branch.id)) {
    throw new CashShiftV2ServiceError(409, 'FISCAL_PROFILE_MISSING', 'V2 requiere perfil fiscal explícito y moneda coincidente por sucursal.');
  }
  assertRole(operation, role, request.payload, profile.currency);
  if (!branchMode || branchMode.state !== 'ACTIVE') {
    throw new CashShiftV2ServiceError(409, 'BRANCH_V2_NOT_ACTIVE', 'La sucursal no está habilitada para operaciones V2.');
  }
  if (!opening || opening.closed || !/^\d{4}-\d{2}-\d{2}$/.test(opening.businessDate)) {
    throw new CashShiftV2ServiceError(409, 'DAILY_OPENING_REQUIRED', 'La caja requiere una apertura diaria vigente; se conserva su fecha de negocio original.');
  }
  if (auth.employeeId && !await repository.hasActiveMembership(auth.tenantId, branch.id, auth.employeeId)) {
    throw new CashShiftV2ServiceError(403, 'BRANCH_MEMBERSHIP_REQUIRED', 'El empleado no tiene membresía activa en esta sucursal.');
  }

  const scope = {
    tenantId: auth.tenantId,
    branchId: branch.id,
    cashRegisterId: register.id,
    businessDate: opening.businessDate
  };
  const requestSha256 = await requestDigest(operation, branch.id, register.id, opening.businessDate, request.payload);
  const { rpc, command } = commandFor(operation, scope, request.payload, request.idempotencyKey, requestSha256, profile.currency);
  const result = await repository.rpc(rpc, rpcArguments(auth, role, scope, request.idempotencyKey, requestSha256, command));
  if (result.error) {
    if (result.error.code === 'PGRST202' || result.error.code === '42883' || result.error.code === '42P01') {
      throw new CashShiftV2ServiceError(503, 'V2_BACKEND_NOT_READY', 'El backend V2 aún no está desplegado; no se aplicó fallback legacy.');
    }
    throw new CashShiftV2ServiceError(409, 'V2_OPERATION_REJECTED', 'La operación fue rechazada por las validaciones transaccionales del backend V2.');
  }
  if (result.data === null || result.data === undefined) {
    throw new CashShiftV2ServiceError(502, 'V2_INVALID_RPC_RESPONSE', 'El backend V2 no confirmó el resultado de la operación.');
  }
  return result.data;
}

export function getCashShiftV2RequestDigestForTest(
  operation: CashShiftV2Operation,
  branchId: string,
  registerId: string,
  businessDate: string,
  payload: Record<string, unknown>
): Promise<string> {
  return requestDigest(operation, branchId, registerId, businessDate, payload);
}
