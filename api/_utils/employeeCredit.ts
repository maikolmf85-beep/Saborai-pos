export type EmployeeCreditTransactionType = 'CHARGE' | 'PAYMENT';

export interface EmployeeCreditRecordInput {
  tenantId: string;
  employeeId: string;
  type: EmployeeCreditTransactionType;
  amount: number;
  idempotencyKey: string;
  orderId?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface EmployeeCreditRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface EmployeeCreditRecordResult {
  accountId: string;
  transactionId: string;
  employeeId: string;
  employeeName: string;
  type: EmployeeCreditTransactionType;
  amount: number;
  balanceAfter: number;
  reference: string | null;
  idempotencyKey: string;
  createdAt: string;
  alreadyApplied: boolean;
}

export function normalizeCreditAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 999999999999.99) {
    throw new Error('El monto del crédito debe ser mayor que cero y válido.');
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (rounded <= 0) throw new Error('El monto del crédito debe ser mayor que cero.');
  return rounded;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} es inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} es inválido.`);
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('El detalle del crédito es inválido.');
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error('El detalle del crédito es inválido.');
  return normalized;
}

export function normalizeEmployeeCreditRecordInput(value: unknown): EmployeeCreditRecordInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La operación de crédito es inválida.');
  }
  const input = value as Record<string, unknown>;
  const type = input.type;
  if (type !== 'CHARGE' && type !== 'PAYMENT') throw new Error('El tipo de movimiento no es válido.');

  const orderId = input.orderId === undefined || input.orderId === null || input.orderId === ''
    ? null
    : requiredText(input.orderId, 'El identificador de orden', 80);

  return {
    tenantId: requiredText(input.tenantId, 'El tenant', 80),
    employeeId: requiredText(input.employeeId, 'El colaborador', 120),
    type,
    amount: normalizeCreditAmount(input.amount),
    idempotencyKey: requiredText(input.idempotencyKey, 'La clave de idempotencia', 200),
    orderId,
    reference: optionalText(input.reference, 200),
    notes: optionalText(input.notes, 500),
    createdBy: requiredText(input.createdBy, 'El usuario', 120)
  };
}

export async function recordEmployeeCreditTransaction(
  client: EmployeeCreditRpcClient,
  rawInput: unknown
): Promise<EmployeeCreditRecordResult> {
  const input = normalizeEmployeeCreditRecordInput(rawInput);
  const { data, error } = await client.rpc('apply_employee_credit_transaction', {
    p_tenant_id: input.tenantId,
    p_employee_id: input.employeeId,
    p_transaction_type: input.type,
    p_amount: input.amount,
    p_idempotency_key: input.idempotencyKey,
    p_order_id: input.orderId,
    p_reference: input.reference,
    p_notes: input.notes,
    p_created_by: input.createdBy
  });

  if (error) {
    const message = typeof error.message === 'string' ? error.message : '';
    if (/saldo|límite|limite/i.test(message)) throw new Error(message);
    throw new Error('No se pudo guardar el movimiento de crédito del colaborador.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('El servidor no confirmó el movimiento de crédito.');
  const result = row as Record<string, unknown>;
  const amount = Number(result.amount);
  const balanceAfter = Number(result.balance_after);
  if (typeof result.account_id !== 'string' || typeof result.transaction_id !== 'string'
    || typeof result.employee_id !== 'string' || typeof result.employee_name !== 'string'
    || (result.transaction_type !== 'CHARGE' && result.transaction_type !== 'PAYMENT')
    || !Number.isFinite(amount) || !Number.isFinite(balanceAfter)
    || typeof result.idempotency_key !== 'string' || typeof result.created_at !== 'string') {
    throw new Error('El servidor devolvió un movimiento de crédito incompleto.');
  }
  return {
    accountId: result.account_id,
    transactionId: result.transaction_id,
    employeeId: result.employee_id,
    employeeName: result.employee_name,
    type: result.transaction_type,
    amount,
    balanceAfter,
    reference: typeof result.reference === 'string' ? result.reference : null,
    idempotencyKey: result.idempotency_key,
    createdAt: result.created_at,
    alreadyApplied: result.already_applied === true
  };
}
