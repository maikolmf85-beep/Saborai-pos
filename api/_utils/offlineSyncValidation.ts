export type OperationalScope = {
  branchId: string | null;
  cashRegisterId: string | null;
  cashShiftId: string | null;
  terminalId: string | null;
};

export type PersistedOrderScope = {
  branch_id: string | null;
  cash_register_id: string | null;
  cash_shift_id: string | null;
  terminal_id: string | null;
};

const SCOPE_FIELDS = [
  ['branchId', 'branch_id', 'sucursal'],
  ['cashRegisterId', 'cash_register_id', 'caja'],
  ['cashShiftId', 'cash_shift_id', 'turno'],
  ['terminalId', 'terminal_id', 'terminal']
] as const;

const TERMINAL_ORDER_STATUSES = new Set(['CLOSED', 'CANCELLED']);
const PAYABLE_ORDER_STATUSES = new Set(['OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED']);

export function assertOperationalScopeMatchesOrder(
  scope: OperationalScope,
  order: PersistedOrderScope
): void {
  for (const [scopeField, orderField, label] of SCOPE_FIELDS) {
    const requestedId = scope[scopeField];
    if (requestedId && requestedId !== order[orderField]) {
      throw new Error(`El alcance de ${label} no coincide con la orden.`);
    }
  }
}

export function isTerminalOrderStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_ORDER_STATUSES.has(status);
}

export function isPayableOrderStatus(status: unknown): boolean {
  return typeof status === 'string' && PAYABLE_ORDER_STATUSES.has(status);
}
