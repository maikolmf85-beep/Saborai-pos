/**
 * Contratos de dominio para la futura migración de turnos por caja.
 *
 * Sigue aislado de App, API, UI y servicios legacy. No contiene I/O, SQL ni RPC.
 * Las funciones puras no autorizan operaciones ni convierten un cálculo local en
 * evidencia de servidor; las mutaciones reales requieren RPC transaccionales.
 */
export const CASH_SHIFT_V2_ENABLED = false as const;

export type CashShiftV2Number = 1 | 2;
export type CashShiftV2Currency = 'CRC' | 'USD';
export type CashShiftV2TaxRegime = 'IVA_13' | 'IVA_0';
export type CashShiftV2TaxRate = '0.0000' | '0.0100' | '0.0200' | '0.0400' | '0.1300';
/** Importe fiscal exacto a cinco decimales; no representa por sí solo tender pagable. */
export type CashShiftV2Amount = string;
/** Tender validado por moneda: CRC entero y USD a centavos. */
export type CashShiftV2TenderAmount = string;
export type CashShiftV2PaymentMethod = 'CASH' | 'SINPE';
export type CashShiftV2PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
export type CashShiftV2Role = 'ADMIN' | 'SALONERO' | 'CAJERO' | 'SALONERO_CAJA' | 'WAITER';
export type CashShiftV2PrivilegedRole = 'ADMIN' | 'CAJERO';

const AMOUNT_DIGITS = 5;
const QUANTITY_DIGITS = 3;
const RATE_DIGITS = 4;
const AMOUNT_SCALE = 100_000n;
const QUANTITY_SCALE = 1_000n;
const RATE_SCALE = 10_000n;
const MAX_AMOUNT_UNITS = 10n ** 18n;
const SERVICE_RATE = '0.1000' as const;
const TAX_RATES: readonly CashShiftV2TaxRate[] = [
  '0.0000', '0.0100', '0.0200', '0.0400', '0.1300'
];

/** La jornada corresponde a la apertura diaria original, no al día del cierre. */
export interface CashShiftV2Scope {
  tenantId: string;
  branchId: string;
  cashRegisterId: string;
  businessDate: string;
}

/** Perfil explícito por sucursal. Ausente o nulo siempre bloquea V2. */
export interface CashShiftV2BranchFiscalProfile {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  taxRegime: CashShiftV2TaxRegime;
  currency: CashShiftV2Currency;
  priceBasis: 'EXCLUSIVE_OF_VAT';
}

export interface CashShiftV2IdempotencyRequest {
  idempotencyKey: string;
  /** SHA-256 canónico de la carga validada por el servidor. */
  requestSha256: string;
}

export interface CashShiftV2ActorContext {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  userId: string;
  employeeId: string | null;
  role: CashShiftV2Role | 'OWNER';
  activeBranchMembership: boolean;
}

export interface CashShiftV2EmployeeBranchMembership {
  tenantId: string;
  branchId: string;
  employeeId: string;
  status: 'ACTIVE' | 'REVOKED';
  grantedAt: string;
  revokedAt?: string;
}

/** Montos se transportan como decimal string, nunca como binary floating point. */
export interface CashShiftV2OrderLineInput {
  lineId: string;
  menuItemId: string | null;
  itemName: string;
  quantity: string;
  /** Precio unitario antes de IVA, con hasta cinco decimales. */
  unitPrice: CashShiftV2Amount;
  taxRate: CashShiftV2TaxRate;
  resolutionState?: 'VALID' | 'PRICE_REVIEW' | 'MISSING_ITEM' | 'VOIDED';
  voidReason?: string;
}

export interface CashShiftV2CalculatedOrderLine extends CashShiftV2OrderLineInput {
  lineSubtotal: CashShiftV2Amount;
  lineVat: CashShiftV2Amount;
  lineTotal: CashShiftV2Amount;
}

export interface CashShiftV2TaxBreakdown {
  taxRate: CashShiftV2TaxRate;
  taxableSubtotal: CashShiftV2Amount;
  vatAmount: CashShiftV2Amount;
}

export interface CashShiftV2CalculatedOrderFinancials {
  currency: CashShiftV2Currency;
  taxRegime: CashShiftV2TaxRegime;
  priceBasis: 'EXCLUSIVE_OF_VAT';
  subtotal: CashShiftV2Amount;
  vatTotal: CashShiftV2Amount;
  serviceRate: typeof SERVICE_RATE;
  /** Servicio calculado una vez sobre el subtotal agregado, antes de IVA. */
  serviceAmount: CashShiftV2Amount;
  /** Conserva cinco decimales: no se redondea al colón ni al centavo. */
  total: CashShiftV2Amount;
  lines: CashShiftV2CalculatedOrderLine[];
  taxBreakdown: CashShiftV2TaxBreakdown[];
}

export interface CashShiftV2ServerOrderFinancials {
  authority: 'SERVER';
  branchFiscalProfile: CashShiftV2BranchFiscalProfile;
  financials: CashShiftV2CalculatedOrderFinancials;
  authorizedPaidAmount: CashShiftV2Amount;
  balanceAmount: CashShiftV2Amount;
}

export interface CashShiftV2FiscalInvoiceProjection {
  authority: 'SERVER';
  currency: CashShiftV2Currency;
  subtotal: CashShiftV2Amount;
  taxBreakdown: CashShiftV2TaxBreakdown[];
  vatTotal: CashShiftV2Amount;
  serviceRate: typeof SERVICE_RATE;
  serviceAmount: CashShiftV2Amount;
  /** Copia directa de financials.total; el serializador XML no recalcula. */
  totalComprobante: CashShiftV2Amount;
  lines: CashShiftV2CalculatedOrderLine[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCashShiftV2Scope(value: unknown): value is CashShiftV2Scope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<CashShiftV2Scope>;
  if (!isNonEmptyString(scope.tenantId) || !isNonEmptyString(scope.branchId)
    || !isNonEmptyString(scope.cashRegisterId) || typeof scope.businessDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)) return false;
  const date = new Date(`${scope.businessDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === scope.businessDate;
}

function sameCashShiftV2Scope(left: CashShiftV2Scope, right: CashShiftV2Scope): boolean {
  return left.tenantId === right.tenantId && left.branchId === right.branchId
    && left.cashRegisterId === right.cashRegisterId && left.businessDate === right.businessDate;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function pow10(digits: number): bigint {
  return 10n ** BigInt(digits);
}

function parseDecimal(value: unknown, scaleDigits: number, maxIntegerDigits: number): bigint | null {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || match[1].length > maxIntegerDigits) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > scaleDigits) return null;
  try {
    return BigInt(match[1]) * pow10(scaleDigits)
      + BigInt((fraction || '').padEnd(scaleDigits, '0') || '0');
  } catch {
    return null;
  }
}

function formatDecimal(value: bigint, scaleDigits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = pow10(scaleDigits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(scaleDigits, '0');
  return `${negative ? '-' : ''}${whole.toString()}${scaleDigits === 0 ? '' : `.${fraction}`}`;
}
function formatTender(value: bigint, currency: CashShiftV2Currency): CashShiftV2TenderAmount {
  const scaleDigits = currency === 'CRC' ? 0 : 2;
  return formatDecimal(value / paymentMinorQuantum(currency), scaleDigits);
}
function parseAmount(value: unknown): bigint | null {
  return parseDecimal(value, AMOUNT_DIGITS, 13);
}

/** Quantum de pago expresado en unidades numeric(18,5): CRC 1 colón, USD 0.01. */
function paymentMinorQuantum(currency: CashShiftV2Currency): bigint {
  return currency === 'CRC' ? AMOUNT_SCALE : pow10(AMOUNT_DIGITS - 2);
}

function isPaymentMinorAmount(value: bigint, currency: CashShiftV2Currency): boolean {
  return value >= 0n && value % paymentMinorQuantum(currency) === 0n;
}

function floorPaymentAmount(value: bigint, currency: CashShiftV2Currency): bigint {
  const quantum = paymentMinorQuantum(currency);
  return (value / quantum) * quantum;
}

/** Redondea directamente el producto FX a la unidad mínima destino, sin doble redondeo fiscal. */
function convertPaymentAmount(source: bigint, rate: bigint, targetCurrency: CashShiftV2Currency): bigint {
  const quantum = paymentMinorQuantum(targetCurrency);
  return roundDivideHalfUp(source * rate, AMOUNT_SCALE * quantum) * quantum;
}

function parseQuantity(value: unknown): bigint | null {
  return parseDecimal(value, QUANTITY_DIGITS, 9);
}

function parseRate(value: unknown): bigint | null {
  return parseDecimal(value, RATE_DIGITS, 1);
}

function isRepresentableAmount(value: bigint): boolean {
  return value >= 0n && value < MAX_AMOUNT_UNITS;
}

function roundDivideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('La operación requiere valores no negativos.');
  return (numerator + denominator / 2n) / denominator;
}

function multiplyAmountByRate(amount: bigint, rate: bigint): bigint {
  return roundDivideHalfUp(amount * rate, RATE_SCALE);
}

function isCurrency(value: unknown): value is CashShiftV2Currency {
  return value === 'CRC' || value === 'USD';
}

function isTaxRate(value: unknown): value is CashShiftV2TaxRate {
  return typeof value === 'string' && TAX_RATES.includes(value as CashShiftV2TaxRate);
}

function isValidProfile(
  profile: CashShiftV2BranchFiscalProfile | null | undefined
): profile is CashShiftV2BranchFiscalProfile {
  return !!profile && profile.authority === 'SERVER'
    && isNonEmptyString(profile.tenantId) && isNonEmptyString(profile.branchId)
    && (profile.taxRegime === 'IVA_13' || profile.taxRegime === 'IVA_0')
    && isCurrency(profile.currency) && profile.priceBasis === 'EXCLUSIVE_OF_VAT';
}

function isRateAllowedForProfile(rate: CashShiftV2TaxRate, profile: CashShiftV2BranchFiscalProfile): boolean {
  return profile.taxRegime === 'IVA_13' || rate === '0.0000';
}

function sameFiscalProfile(a: CashShiftV2BranchFiscalProfile, b: CashShiftV2BranchFiscalProfile): boolean {
  return a.authority === b.authority && a.tenantId === b.tenantId && a.branchId === b.branchId
    && a.taxRegime === b.taxRegime && a.currency === b.currency && a.priceBasis === b.priceBasis;
}

function sameCalculatedFinancials(
  expected: CashShiftV2CalculatedOrderFinancials,
  actual: CashShiftV2CalculatedOrderFinancials
): boolean {
  if (expected.currency !== actual.currency || expected.taxRegime !== actual.taxRegime
    || expected.priceBasis !== actual.priceBasis || expected.subtotal !== actual.subtotal
    || expected.vatTotal !== actual.vatTotal || expected.serviceRate !== actual.serviceRate
    || expected.serviceAmount !== actual.serviceAmount || expected.total !== actual.total
    || expected.lines.length !== actual.lines.length || expected.taxBreakdown.length !== actual.taxBreakdown.length) return false;
  const linesMatch = expected.lines.every((line, index) => {
    const other = actual.lines[index];
    return !!other && line.lineId === other.lineId && line.menuItemId === other.menuItemId
      && line.itemName === other.itemName && line.quantity === other.quantity
      && line.unitPrice === other.unitPrice && line.taxRate === other.taxRate
      && line.resolutionState === other.resolutionState && line.voidReason === other.voidReason
      && line.lineSubtotal === other.lineSubtotal && line.lineVat === other.lineVat
      && line.lineTotal === other.lineTotal;
  });
  const taxMatches = expected.taxBreakdown.every((entry, index) => {
    const other = actual.taxBreakdown[index];
    return !!other && entry.taxRate === other.taxRate
      && entry.taxableSubtotal === other.taxableSubtotal && entry.vatAmount === other.vatAmount;
  });
  return linesMatch && taxMatches;
}

function isValidIdempotencyRequest(request: CashShiftV2IdempotencyRequest): boolean {
  return isNonEmptyString(request.idempotencyKey) && request.idempotencyKey.length <= 200
    && /^[0-9a-f]{64}$/.test(request.requestSha256);
}

/**
 * IVA se calcula por línea y el servicio del 10% una sola vez sobre subtotal
 * pre-IVA. Redondeo decimal half-up a cinco decimales, sin Number/float.
 */
export function calculateCashShiftV2OrderFinancials(
  profile: CashShiftV2BranchFiscalProfile | null | undefined,
  lines: readonly CashShiftV2OrderLineInput[]
): CashShiftV2CalculatedOrderFinancials {
  if (!isValidProfile(profile)) throw new Error('V2 requiere perfil fiscal explícito y válido por sucursal.');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('La orden requiere al menos una línea válida.');

  const seenLineIds = new Set<string>();
  let subtotalUnits = 0n;
  let vatUnits = 0n;
  const breakdownByRate = new Map<CashShiftV2TaxRate, { subtotal: bigint; vat: bigint }>();
  const calculatedLines: CashShiftV2CalculatedOrderLine[] = [];

  for (const line of lines) {
    if (!isNonEmptyString(line.lineId) || seenLineIds.has(line.lineId)
      || !isNonEmptyString(line.itemName)) {
      throw new Error('La línea fiscal está incompleta o duplicada.');
    }
    if (!isTaxRate(line.taxRate)) throw new Error('La tasa de IVA del artículo no es válida.');
    seenLineIds.add(line.lineId);
    if (line.resolutionState === 'VOIDED') {
      if (!isNonEmptyString(line.voidReason)) throw new Error('Un ítem anulado requiere motivo.');
      continue;
    }
    if (line.resolutionState === 'PRICE_REVIEW' || line.resolutionState === 'MISSING_ITEM'
      || line.menuItemId === null || !isNonEmptyString(line.menuItemId)) {
      throw new Error('La orden queda retenida hasta resolver precio o vincular/anular el ítem.');
    }
    if (line.resolutionState !== undefined && line.resolutionState !== 'VALID') {
      throw new Error('Estado de línea V2 no válido.');
    }
    if (!isRateAllowedForProfile(line.taxRate, profile)) {
      throw new Error('La tasa de IVA del artículo no está permitida por el perfil fiscal de la sucursal.');
    }
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parseAmount(line.unitPrice);
    const rate = parseRate(line.taxRate);
    if (quantity === null || quantity <= 0n || unitPrice === null || unitPrice < 0n || rate === null) {
      throw new Error('Cantidad, precio o tasa decimal inválidos.');
    }
    const lineSubtotal = roundDivideHalfUp(quantity * unitPrice, QUANTITY_SCALE);
    const lineVat = multiplyAmountByRate(lineSubtotal, rate);
    const lineTotal = lineSubtotal + lineVat;
    if (!isRepresentableAmount(lineSubtotal) || !isRepresentableAmount(lineVat) || !isRepresentableAmount(lineTotal)) {
      throw new Error('El importe de la línea excede numeric(18,5).');
    }
    subtotalUnits += lineSubtotal;
    vatUnits += lineVat;
    const current = breakdownByRate.get(line.taxRate) ?? { subtotal: 0n, vat: 0n };
    current.subtotal += lineSubtotal;
    current.vat += lineVat;
    breakdownByRate.set(line.taxRate, current);
    calculatedLines.push({
      ...line,
      resolutionState: 'VALID',
      lineSubtotal: formatDecimal(lineSubtotal, AMOUNT_DIGITS),
      lineVat: formatDecimal(lineVat, AMOUNT_DIGITS),
      lineTotal: formatDecimal(lineTotal, AMOUNT_DIGITS)
    });
  }

  if (calculatedLines.length === 0) throw new Error('La orden no tiene líneas facturables.');
  const serviceUnits = multiplyAmountByRate(subtotalUnits, parseRate(SERVICE_RATE)!);
  const totalUnits = subtotalUnits + vatUnits + serviceUnits;
  if (!isRepresentableAmount(subtotalUnits) || !isRepresentableAmount(vatUnits)
    || !isRepresentableAmount(serviceUnits) || !isRepresentableAmount(totalUnits)) {
    throw new Error('Los totales de la orden exceden numeric(18,5).');
  }
  const taxBreakdown = [...breakdownByRate.entries()]
    .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB))
    .map(([taxRate, value]) => ({
      taxRate,
      taxableSubtotal: formatDecimal(value.subtotal, AMOUNT_DIGITS),
      vatAmount: formatDecimal(value.vat, AMOUNT_DIGITS)
    }));
  return {
    currency: profile.currency,
    taxRegime: profile.taxRegime,
    priceBasis: profile.priceBasis,
    subtotal: formatDecimal(subtotalUnits, AMOUNT_DIGITS),
    vatTotal: formatDecimal(vatUnits, AMOUNT_DIGITS),
    serviceRate: SERVICE_RATE,
    serviceAmount: formatDecimal(serviceUnits, AMOUNT_DIGITS),
    total: formatDecimal(totalUnits, AMOUNT_DIGITS),
    lines: calculatedLines,
    taxBreakdown
  };
}

/** Valida que un DTO server coincida con el cálculo decimal y su perfil. */
export function isValidCashShiftV2ServerOrderFinancials(value: CashShiftV2ServerOrderFinancials): boolean {
  if (!value || value.authority !== 'SERVER' || !isValidProfile(value.branchFiscalProfile)
    || !value.financials || !Array.isArray(value.financials.lines)) return false;
  let expected: CashShiftV2CalculatedOrderFinancials;
  try {
    expected = calculateCashShiftV2OrderFinancials(value.branchFiscalProfile, value.financials.lines);
  } catch {
    return false;
  }
  if (!sameCalculatedFinancials(expected, value.financials)) return false;
  const paid = parseAmount(value.authorizedPaidAmount);
  const balance = parseAmount(value.balanceAmount);
  const total = parseAmount(value.financials.total);
  return paid !== null && balance !== null && total !== null && paid >= 0n && balance >= 0n
    && paid + balance === total;
}

/** El XML recibe una proyección; su serializador no recalcula importes. */
export function createCashShiftV2FiscalInvoiceProjection(
  value: CashShiftV2ServerOrderFinancials
): CashShiftV2FiscalInvoiceProjection {
  if (!isValidCashShiftV2ServerOrderFinancials(value)) {
    throw new Error('La factura requiere totales fiscales autoritativos verificados por servidor.');
  }
  const totals = value.financials;
  return {
    authority: 'SERVER', currency: totals.currency, subtotal: totals.subtotal,
    taxBreakdown: totals.taxBreakdown.map(item => ({ ...item })), vatTotal: totals.vatTotal,
    serviceRate: totals.serviceRate, serviceAmount: totals.serviceAmount,
    totalComprobante: totals.total, lines: totals.lines.map(line => ({ ...line }))
  };
}

export type CashShiftV2ActivationBlockerCode =
  | 'FISCAL_PROFILE_MISSING' | 'MEMBERSHIP_MISSING' | 'LEGACY_OPEN_SHIFT'
  | 'UNATTRIBUTED_LEGACY_ORDER' | 'UNATTRIBUTED_LEGACY_PAYMENT' | 'UNRECONCILED_PAYMENT'
  | 'PENDING_PAYMENT' | 'HELD_ORDER' | 'OFFLINE_PRICE_MISMATCH' | 'MISSING_ITEM' | 'UNVERIFIED_WAITER';

export interface CashShiftV2ActivationPreflight {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  currentState: 'OFF' | 'PREPARED' | 'ACTIVE' | 'QUIESCING' | 'FROZEN';
  fiscalProfile: CashShiftV2BranchFiscalProfile | null;
  unresolvedLegacyOrders: number;
  unresolvedLegacyPayments: number;
  legacyOpenShifts: number;
  missingActiveMemberships: number;
  blockers: Array<{ code: CashShiftV2ActivationBlockerCode; entityId?: string }>;
  ready: boolean;
}

/** Liga sesión lógica a pos_cash_shifts.id sin reinterpretar shift_number legacy. */
export interface CashShiftV2Session extends CashShiftV2Scope {
  sessionId: string;
  posCashShiftId: string;
  logicalShift: CashShiftV2Number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  openingFloat: CashShiftV2Amount;
  countedCash?: CashShiftV2Amount;
}

/** Evidencia del scope de la sesión que recibió un pago, devuelta por el servidor. */
export interface CashShiftV2ReceivingSessionReference extends CashShiftV2Scope {
  authority: 'SERVER';
  sessionId: string;
  logicalShift: CashShiftV2Number;
}

/** Evidencia autoritativa de sesión usada para calcular arqueo y efectivo esperado. */
export interface CashShiftV2SessionReconciliationEvidence extends CashShiftV2ReceivingSessionReference {
  openingFloat: CashShiftV2Amount;
}

function isValidCashShiftV2ReceivingSessionReference(
  value: unknown
): value is CashShiftV2ReceivingSessionReference {
  if (!value || typeof value !== 'object') return false;
  if ((value as Partial<CashShiftV2ReceivingSessionReference>).authority !== 'SERVER'
    || !isValidCashShiftV2Scope(value)) return false;
  const session = value as Partial<CashShiftV2ReceivingSessionReference>;
  return isNonEmptyString(session.sessionId) && (session.logicalShift === 1 || session.logicalShift === 2);
}

/** La mesa pertenece a sucursal/jornada; no se asigna artificialmente a una caja. */
export interface CashShiftV2OccupiedTableSnapshot {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  businessDate: string;
  tableId: string;
  /** Opcional si el origen identifica caja; el cierre T2 sigue siendo branch-wide. */
  cashRegisterId?: string;
}

export interface CashShiftV2CloseSnapshotEvidence {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  coverage: 'REGISTER' | 'COMPLETE_BRANCH_BUSINESS_DATE';
  session: CashShiftV2SessionReconciliationEvidence;
}

export interface CashShiftV2DailyOpeningIdentity {
  businessDate: string;
  openedAt: string;
  openedByActorId: string;
}

export interface CashShiftV2DailyCloseRequest {
  businessDate: string;
  closedAt: string;
  closedByActorId: string;
}

export interface CashShiftV2OrderWaiter {
  employeeId: string;
  name: string;
}

/** El origen se conserva; servingSessionId puede pasar de T1 a T2. */
export interface CashShiftV2OpenOrderSnapshot extends CashShiftV2Scope {
  source: 'SERVER';
  orderId: string;
  tableId: string;
  tableName: string;
  originSessionId: string;
  servingSessionId: string;
  waiter: CashShiftV2OrderWaiter;
  totals: CashShiftV2CalculatedOrderFinancials;
  authorizedPaidAmount: CashShiftV2Amount;
  balanceAmount: CashShiftV2Amount;
  capturedAt: string;
}

export interface CashShiftV2OpenOrderInput extends CashShiftV2Scope {
  orderId: string;
  tableId: string;
  tableName: string;
  originSessionId: string;
  servingSessionId: string;
  waiter: CashShiftV2OrderWaiter;
  serverFinancials: CashShiftV2ServerOrderFinancials;
  capturedAt: string;
}

export function createCashShiftV2OpenOrderSnapshot(input: CashShiftV2OpenOrderInput): CashShiftV2OpenOrderSnapshot {
  if (!isNonEmptyString(input.tenantId) || !isNonEmptyString(input.branchId)
    || !isNonEmptyString(input.cashRegisterId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)
    || !isNonEmptyString(input.orderId) || !isNonEmptyString(input.tableId)
    || !isNonEmptyString(input.tableName) || !isNonEmptyString(input.originSessionId)
    || !isNonEmptyString(input.servingSessionId) || !isNonEmptyString(input.waiter.employeeId)
    || !isNonEmptyString(input.waiter.name) || !isValidTimestamp(input.capturedAt)
    || !isValidCashShiftV2ServerOrderFinancials(input.serverFinancials)
    || input.serverFinancials.branchFiscalProfile.tenantId !== input.tenantId
    || input.serverFinancials.branchFiscalProfile.branchId !== input.branchId) {
    throw new Error('Snapshot incompleto o sin finanzas fiscales verificadas por servidor.');
  }
  return {
    tenantId: input.tenantId, branchId: input.branchId, cashRegisterId: input.cashRegisterId,
    businessDate: input.businessDate, source: 'SERVER', orderId: input.orderId,
    tableId: input.tableId, tableName: input.tableName,
    originSessionId: input.originSessionId, servingSessionId: input.servingSessionId,
    waiter: { ...input.waiter }, totals: structuredClone(input.serverFinancials.financials),
    authorizedPaidAmount: input.serverFinancials.authorizedPaidAmount,
    balanceAmount: input.serverFinancials.balanceAmount, capturedAt: input.capturedAt
  };
}

function sameOrderSessionScope(order: CashShiftV2OpenOrderSnapshot, session: CashShiftV2Session): boolean {
  return order.tenantId === session.tenantId && order.branchId === session.branchId
    && order.cashRegisterId === session.cashRegisterId && order.businessDate === session.businessDate;
}

/** Cambia solo la sesión que atiende/cobra; origen T1 queda intacto. */
export function handoffCashShiftV2OpenOrderToSecondShift(
  order: CashShiftV2OpenOrderSnapshot,
  sourceSession: CashShiftV2Session,
  targetSession: CashShiftV2Session
): CashShiftV2OpenOrderSnapshot {
  if (sourceSession.logicalShift !== 1 || targetSession.logicalShift !== 2
    || order.servingSessionId !== sourceSession.sessionId || !sameOrderSessionScope(order, sourceSession)
    || !sameBranchDay(order, targetSession) || sourceSession.status !== 'CLOSED'
    || !isValidTimestamp(sourceSession.closedAt) || targetSession.status !== 'OPEN'
    || Date.parse(targetSession.openedAt) < Date.parse(sourceSession.closedAt)) {
    throw new Error('El traspaso requiere sesiones T1/T2 abiertas de la misma sucursal y jornada.');
  }
  return { ...structuredClone(order), servingSessionId: targetSession.sessionId };
}

function sameBranchDay(order: CashShiftV2OpenOrderSnapshot, session: CashShiftV2Session): boolean {
  return order.tenantId === session.tenantId && order.branchId === session.branchId
    && order.businessDate === session.businessDate;
}

/** Valida sesiones únicas por caja y la barrera T1 a nivel de sucursal. */
export function isValidCashShiftV2SessionSet(
  scope: Pick<CashShiftV2Scope, 'tenantId' | 'branchId' | 'businessDate'>,
  sessions: readonly CashShiftV2Session[]
): boolean {
  if (!isNonEmptyString(scope.tenantId) || !isNonEmptyString(scope.branchId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate) || !Array.isArray(sessions)) return false;
  const byRegister = new Map<string, Map<CashShiftV2Number, CashShiftV2Session>>();
  const ids = new Set<string>();
  const legacyShiftIds = new Set<string>();
  for (const session of sessions) {
    const opening = parseAmount(session.openingFloat);
    if (session.tenantId !== scope.tenantId || session.branchId !== scope.branchId
      || session.businessDate !== scope.businessDate || !isNonEmptyString(session.sessionId)
      || ids.has(session.sessionId) || !isNonEmptyString(session.posCashShiftId)
      || legacyShiftIds.has(session.posCashShiftId)
      || !isNonEmptyString(session.cashRegisterId) || (session.logicalShift !== 1 && session.logicalShift !== 2)
      || !['OPEN', 'CLOSING', 'CLOSED'].includes(session.status) || !isValidTimestamp(session.openedAt)
      || opening === null || opening < 0n) return false;
    const sessionsForRegister = byRegister.get(session.cashRegisterId)
      ?? new Map<CashShiftV2Number, CashShiftV2Session>();
    if (sessionsForRegister.has(session.logicalShift)) return false;
    if (session.status === 'CLOSED') {
      const counted = parseAmount(session.countedCash);
      if (!isValidTimestamp(session.closedAt) || Date.parse(session.closedAt) <= Date.parse(session.openedAt)
        || counted === null || counted < 0n) return false;
    } else if (session.closedAt !== undefined || session.countedCash !== undefined) return false;
    ids.add(session.sessionId);
    legacyShiftIds.add(session.posCashShiftId);
    sessionsForRegister.set(session.logicalShift, session);
    byRegister.set(session.cashRegisterId, sessionsForRegister);
  }
  const hasT2 = [...byRegister.values()].some(register => register.has(2));
  if (hasT2 && sessions.some(session => session.logicalShift === 1 && session.status !== 'CLOSED')) return false;
  for (const register of byRegister.values()) {
    const second = register.get(2);
    if (!second) continue;
    const first = register.get(1);
    const counted = first ? parseAmount(first.countedCash) : null;
    const secondFloat = parseAmount(second.openingFloat);
    if (!first || first.status !== 'CLOSED' || !isValidTimestamp(first.closedAt)
      || counted === null || secondFloat === null || secondFloat !== counted
      || Date.parse(second.openedAt) < Date.parse(first.closedAt!)) return false;
  }
  return true;
}

export interface CashShiftV2AuthoritativeSnapshot {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  sessionCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE';
  ledgerCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE';
  branchRegisterIds: string[];
  fiscalProfile: CashShiftV2BranchFiscalProfile | null;
  shifts: CashShiftV2Session[];
  openOrders: CashShiftV2OpenOrderSnapshot[];
  payments: CashShiftV2Payment[];
  occupiedTablesWithoutOrder: CashShiftV2OccupiedTableSnapshot[];
  unresolvedLegacyEntities: string[];
  heldOrderIds: string[];
  dailyOpening: CashShiftV2DailyOpeningIdentity;
}

export type CashShiftV2SecondShiftOpeningBlockerCode =
  | 'INCOMPLETE_BRANCH_SNAPSHOT' | 'INVALID_BRANCH_SESSION_SET' | 'FISCAL_PROFILE_MISSING'
  | 'UNRESOLVED_LEGACY_ENTITY' | 'HELD_ORDER' | 'FIRST_SHIFT_MISSING' | 'FIRST_SHIFT_NOT_CLOSED'
  | 'BRANCH_FIRST_SHIFT_NOT_CLOSED' | 'SECOND_SHIFT_ALREADY_EXISTS'
  | 'INCOMPLETE_BRANCH_REGISTER_ROSTER' | 'INVALID_CUTOVER_ORDER' | 'INVALID_CUTOVER_PAYMENT'
  | 'ORPHAN_OCCUPIED_TABLE';

export interface CashShiftV2SecondShiftOpeningDecision {
  eligible: boolean;
  blockers: Array<{ code: CashShiftV2SecondShiftOpeningBlockerCode; entityId: string }>;
  openingFloat?: CashShiftV2Amount;
  /** Ordenes T1 del registro objetivo que el RPC debe reasignar atómicamente a la sesión T2. */
  openOrderHandoffs: CashShiftV2OpenOrderSnapshot[];
}

export function evaluateCashShiftV2SecondShiftOpening(
  snapshot: CashShiftV2AuthoritativeSnapshot,
  cashRegisterId: string
): CashShiftV2SecondShiftOpeningDecision {
  const fail = (code: CashShiftV2SecondShiftOpeningBlockerCode): CashShiftV2SecondShiftOpeningDecision => ({
    eligible: false, blockers: [{ code, entityId: cashRegisterId || '' }], openOrderHandoffs: []
  });
  if (!snapshot || snapshot.authority !== 'SERVER' || snapshot.sessionCoverage !== 'COMPLETE_BRANCH_BUSINESS_DATE'
    || snapshot.ledgerCoverage !== 'COMPLETE_BRANCH_BUSINESS_DATE'
    || !snapshot.scope || snapshot.scope.cashRegisterId !== cashRegisterId || !isNonEmptyString(cashRegisterId)
    || !isNonEmptyString(snapshot.scope.tenantId) || !isNonEmptyString(snapshot.scope.branchId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.scope.businessDate)
    || !isValidTimestamp(snapshot.dailyOpening?.openedAt)
    || snapshot.dailyOpening?.businessDate !== snapshot.scope.businessDate
    || !isNonEmptyString(snapshot.dailyOpening?.openedByActorId)
    || !Array.isArray(snapshot.branchRegisterIds) || snapshot.branchRegisterIds.length === 0
    || !Array.isArray(snapshot.shifts) || !Array.isArray(snapshot.openOrders)
    || !Array.isArray(snapshot.payments) || !Array.isArray(snapshot.occupiedTablesWithoutOrder)
    || !Array.isArray(snapshot.unresolvedLegacyEntities) || !Array.isArray(snapshot.heldOrderIds)) {
    return fail('INCOMPLETE_BRANCH_SNAPSHOT');
  }
  const branchRegisterIds = new Set(snapshot.branchRegisterIds);
  if (branchRegisterIds.size !== snapshot.branchRegisterIds.length
    || snapshot.branchRegisterIds.some(id => !isNonEmptyString(id))
    || snapshot.shifts.some(session => !branchRegisterIds.has(session.cashRegisterId))
    || snapshot.branchRegisterIds.some(id => !snapshot.shifts.some(session =>
      session.cashRegisterId === id && session.logicalShift === 1))) {
    return fail('INCOMPLETE_BRANCH_REGISTER_ROSTER');
  }
  if (!isValidProfile(snapshot.fiscalProfile) || snapshot.fiscalProfile.tenantId !== snapshot.scope.tenantId
    || snapshot.fiscalProfile.branchId !== snapshot.scope.branchId) return fail('FISCAL_PROFILE_MISSING');
  const branchDay = {
    tenantId: snapshot.scope.tenantId, branchId: snapshot.scope.branchId, businessDate: snapshot.scope.businessDate
  };
  if (!isValidCashShiftV2SessionSet(branchDay, snapshot.shifts)) return fail('INVALID_BRANCH_SESSION_SET');
  const blockers: CashShiftV2SecondShiftOpeningDecision['blockers'] = [];
  for (const id of snapshot.unresolvedLegacyEntities) blockers.push({ code: 'UNRESOLVED_LEGACY_ENTITY', entityId: id });
  for (const id of snapshot.heldOrderIds) blockers.push({ code: 'HELD_ORDER', entityId: id });
  const sessionsForRegister = snapshot.shifts.filter(session => session.cashRegisterId === cashRegisterId);
  const first = sessionsForRegister.find(session => session.logicalShift === 1);
  if (!first) blockers.push({ code: 'FIRST_SHIFT_MISSING', entityId: cashRegisterId });
  else if (first.status !== 'CLOSED') blockers.push({ code: 'FIRST_SHIFT_NOT_CLOSED', entityId: first.sessionId });
  for (const session of snapshot.shifts) {
    if (session.logicalShift === 1 && session.status !== 'CLOSED' && session.cashRegisterId !== cashRegisterId) {
      blockers.push({ code: 'BRANCH_FIRST_SHIFT_NOT_CLOSED', entityId: session.sessionId });
    }
  }
  if (sessionsForRegister.some(session => session.logicalShift === 2)) {
    blockers.push({ code: 'SECOND_SHIFT_ALREADY_EXISTS', entityId: cashRegisterId });
  }
  const sessionsById = new Map(snapshot.shifts.map(session => [session.sessionId, session]));
  const openOrderIds = new Set<string>();
  for (const order of snapshot.openOrders) {
    const origin = sessionsById.get(order?.originSessionId);
    const serving = sessionsById.get(order?.servingSessionId);
    const orderTotal = parseAmount(order?.totals?.total);
    const orderPaid = parseAmount(order?.authorizedPaidAmount);
    const orderBalance = parseAmount(order?.balanceAmount);
    if (!order || order.source !== 'SERVER' || !isNonEmptyString(order.orderId)
      || openOrderIds.has(order.orderId) || !isNonEmptyString(order.tableId)
      || order.tenantId !== branchDay.tenantId || order.branchId !== branchDay.branchId
      || order.businessDate !== branchDay.businessDate || !branchRegisterIds.has(order.cashRegisterId)
      || !isValidTimestamp(order.capturedAt) || !isNonEmptyString(order.waiter?.employeeId)
      || !isNonEmptyString(order.waiter?.name) || !origin || origin.logicalShift !== 1
      || origin.status !== 'CLOSED' || origin.cashRegisterId !== order.cashRegisterId
      || !serving || serving.tenantId !== branchDay.tenantId || serving.branchId !== branchDay.branchId
      || serving.businessDate !== branchDay.businessDate || serving.cashRegisterId !== order.cashRegisterId
      || (serving.logicalShift === 2 && serving.status !== 'OPEN')
      || orderTotal === null || orderPaid === null || orderBalance === null || orderBalance <= 0n
      || orderPaid + orderBalance !== orderTotal) {
      blockers.push({ code: 'INVALID_CUTOVER_ORDER', entityId: isNonEmptyString(order?.orderId) ? order.orderId : '' });
      continue;
    }
    openOrderIds.add(order.orderId);
  }
  const paymentIds = new Set<string>();
  for (const payment of snapshot.payments) {
    const receiving = payment?.receivingSession;
    const session = receiving ? sessionsById.get(receiving.sessionId) : undefined;
    if (!payment || payment.authority !== 'SERVER' || !isNonEmptyString(payment.id)
      || paymentIds.has(payment.id) || !isNonEmptyString(payment.orderId)
      || payment.tenantId !== branchDay.tenantId || payment.branchId !== branchDay.branchId
      || !session || !isValidCashShiftV2ReceivingSessionReference(receiving)
      || receiving.sessionId !== payment.receivingSessionId || receiving.logicalShift !== session.logicalShift
      || receiving.tenantId !== session.tenantId || receiving.branchId !== session.branchId
      || receiving.businessDate !== session.businessDate
      || receiving.cashRegisterId !== session.cashRegisterId || payment.branchCurrency !== snapshot.fiscalProfile.currency
      || (payment.status === 'AUTHORIZED' && !isCashShiftV2PaymentCountable(payment))
      || !['AUTHORIZED', 'FAILED', 'CANCELLED'].includes(payment.status)) {
      blockers.push({ code: 'INVALID_CUTOVER_PAYMENT', entityId: isNonEmptyString(payment?.id) ? payment.id : '' });
      continue;
    }
    paymentIds.add(payment.id);
  }
  for (const table of snapshot.occupiedTablesWithoutOrder) {
    if (!table || table.authority !== 'SERVER' || table.tenantId !== branchDay.tenantId
      || table.branchId !== branchDay.branchId || table.businessDate !== branchDay.businessDate
      || !isNonEmptyString(table.tableId)
      || (table.cashRegisterId !== undefined && !branchRegisterIds.has(table.cashRegisterId))) {
      blockers.push({ code: 'INCOMPLETE_BRANCH_SNAPSHOT', entityId: isNonEmptyString(table?.tableId) ? table.tableId : '' });
    } else {
      blockers.push({ code: 'ORPHAN_OCCUPIED_TABLE', entityId: table.tableId });
    }
  }
  const eligible = blockers.length === 0 && first?.status === 'CLOSED';
  const openOrderHandoffs = eligible
    ? structuredClone(snapshot.openOrders.filter(order => order.cashRegisterId === cashRegisterId
      && order.servingSessionId === first?.sessionId))
    : [];
  return {
    eligible, blockers, openOrderHandoffs,
    ...(eligible ? { openingFloat: first.countedCash } : {})
  };
}

export function deriveCashShiftV2SecondShiftOpeningFloat(
  snapshot: CashShiftV2AuthoritativeSnapshot,
  cashRegisterId: string
): CashShiftV2Amount {
  const decision = evaluateCashShiftV2SecondShiftOpening(snapshot, cashRegisterId);
  if (!decision.eligible || decision.openingFloat === undefined) {
    throw new Error('No se puede heredar el efectivo: cierre sesiones T1 y resuelva bloqueos con snapshot completo.');
  }
  return decision.openingFloat;
}

export interface CashShiftV2FxConfirmation {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  employeeId: string;
  role: 'CAJERO';
  actorId: string;
  sessionActorId: string;
  sessionRole: 'CAJERO';
  activeBranchMembership: true;
  sourceCurrency: CashShiftV2Currency;
  targetCurrency: CashShiftV2Currency;
  /** Unidades destino por una unidad origen. */
  rate: CashShiftV2Amount;
  confirmedAt: string;
}

function isValidFxActorBinding(fx: CashShiftV2FxConfirmation): boolean {
  return isNonEmptyString(fx.employeeId) && fx.employeeId === fx.actorId
    && fx.actorId === fx.sessionActorId && fx.role === 'CAJERO'
    && fx.sessionRole === fx.role;
}

export interface CashShiftV2PaymentAllocationInput {
  tenantId: string;
  branchId: string;
  method: unknown;
  sourceAmount: CashShiftV2TenderAmount;
  sourceCurrency: CashShiftV2Currency;
  branchCurrency: CashShiftV2Currency;
  /** Saldo fiscal autoritativo a cinco decimales; no se redondea a la unidad mínima. */
  remainingBalance: CashShiftV2Amount;
  fxConfirmation?: CashShiftV2FxConfirmation;
}

export interface CashShiftV2PaymentAllocation {
  sourceAmount: CashShiftV2TenderAmount;
  sourceCurrency: CashShiftV2Currency;
  targetCurrency: CashShiftV2Currency;
  fxRate: CashShiftV2Amount;
  convertedAmount: CashShiftV2TenderAmount;
  appliedAmount: CashShiftV2TenderAmount;
  changeAmount: CashShiftV2TenderAmount;
}

/** Convierte efectivo recibido, aplica solo el saldo y devuelve vuelto en moneda sucursal. */
export function calculateCashShiftV2PaymentAllocation(
  input: CashShiftV2PaymentAllocationInput
): CashShiftV2PaymentAllocation {
  if (input.method !== 'CASH' && input.method !== 'SINPE') {
    throw new Error('V2 solo admite líneas CASH o SINPE; CARD, MIXED y CREDIT quedan fuera.');
  }
  if (!isNonEmptyString(input.tenantId) || !isNonEmptyString(input.branchId)
    || !isCurrency(input.sourceCurrency) || !isCurrency(input.branchCurrency)) {
    throw new Error('Pago sin tenant, sucursal o moneda válida.');
  }
  const source = parseAmount(input.sourceAmount);
  const balance = parseAmount(input.remainingBalance);
  if (source === null || source <= 0n || balance === null || balance <= 0n) {
    throw new Error('Monto recibido y saldo deben ser decimales positivos válidos.');
  }
  if (!isPaymentMinorAmount(source, input.sourceCurrency)) {
    throw new Error('El monto recibido debe respetar la unidad mínima de su moneda.');
  }
  let rate: bigint;
  if (input.sourceCurrency === input.branchCurrency) {
    if (input.fxConfirmation) throw new Error('Una operación sin conversión no debe incluir confirmación FX.');
    rate = AMOUNT_SCALE;
  } else {
    const fx = input.fxConfirmation;
    const parsedRate = fx ? parseAmount(fx.rate) : null;
    if (input.method !== 'CASH' || !fx || fx.authority !== 'SERVER'
      || fx.tenantId !== input.tenantId || fx.branchId !== input.branchId
      || !isValidFxActorBinding(fx) || fx.activeBranchMembership !== true
      || fx.sourceCurrency !== input.sourceCurrency || fx.targetCurrency !== input.branchCurrency
      || !isValidTimestamp(fx.confirmedAt) || parsedRate === null || parsedRate <= 0n) {
      throw new Error('FX requiere tasa confirmada por CAJERO con membresía activa en sucursal.');
    }
    rate = parsedRate;
  }
  const converted = convertPaymentAmount(source, rate, input.branchCurrency);
  if (converted <= 0n || !isRepresentableAmount(converted)) {
    throw new Error('El pago convertido es cero a precisión de moneda o excede numeric(18,5).');
  }
  if (input.method === 'SINPE' && converted > balance) {
    throw new Error('SINPE no admite vuelto: el monto debe ser menor o igual al saldo.');
  }
  const payableBalance = floorPaymentAmount(balance, input.branchCurrency);
  const applied = converted < payableBalance ? converted : payableBalance;
  if (applied <= 0n) throw new Error('El saldo exacto no admite un importe liquidable en la moneda de sucursal.');
  const change = converted - applied;
  return {
    sourceAmount: formatTender(source, input.sourceCurrency), sourceCurrency: input.sourceCurrency,
    targetCurrency: input.branchCurrency, fxRate: formatDecimal(rate, AMOUNT_DIGITS),
    convertedAmount: formatTender(converted, input.branchCurrency),
    appliedAmount: formatTender(applied, input.branchCurrency),
    changeAmount: formatTender(change, input.branchCurrency)
  };
}

export interface CashShiftV2CashConfirmation {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  actorId: string;
  actorRole: CashShiftV2Role;
  activeBranchMembership: true;
  canConfirmCash: true;
  sessionActorId: string;
  sessionRole: CashShiftV2Role;
  confirmedAt: string;
}

export interface CashShiftV2SinpeEvidence {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  actorId: string;
  actorRole: CashShiftV2PrivilegedRole;
  activeBranchMembership: true;
  externalReference: string;
  recordedAt: string;
  appendOnly: true;
}

/** Registro de pago devuelto por servidor: no es payload de autorización. */
export interface CashShiftV2Payment {
  authority: 'SERVER';
  id: string;
  request: CashShiftV2IdempotencyRequest;
  tenantId: string;
  branchId: string;
  orderId: string;
  receivingSessionId: string;
  receivingSession: CashShiftV2ReceivingSessionReference;
  method: CashShiftV2PaymentMethod;
  status: CashShiftV2PaymentStatus;
  sourceAmount: CashShiftV2TenderAmount;
  sourceCurrency: CashShiftV2Currency;
  branchCurrency: CashShiftV2Currency;
  targetCurrency: CashShiftV2Currency;
  fxRate: CashShiftV2Amount;
  convertedAmount: CashShiftV2TenderAmount;
  appliedAmount: CashShiftV2TenderAmount;
  changeAmount: CashShiftV2TenderAmount;
  fxConfirmation?: CashShiftV2FxConfirmation;
  cashConfirmation?: CashShiftV2CashConfirmation;
  sinpeEvidence?: CashShiftV2SinpeEvidence;
  authorizedAt?: string;
}

function isValidPaymentArithmetic(payment: CashShiftV2Payment): boolean {
  if (!isValidIdempotencyRequest(payment.request)
    || !isValidCashShiftV2ReceivingSessionReference(payment.receivingSession)
    || payment.receivingSession.sessionId !== payment.receivingSessionId
    || payment.tenantId !== payment.receivingSession.tenantId
    || payment.branchId !== payment.receivingSession.branchId || !isCurrency(payment.sourceCurrency)
    || !isCurrency(payment.branchCurrency) || !isCurrency(payment.targetCurrency)
    || payment.targetCurrency !== payment.branchCurrency) return false;
  const source = parseAmount(payment.sourceAmount);
  const rate = parseAmount(payment.fxRate);
  const converted = parseAmount(payment.convertedAmount);
  const applied = parseAmount(payment.appliedAmount);
  const change = parseAmount(payment.changeAmount);
  if (source === null || source <= 0n || !isPaymentMinorAmount(source, payment.sourceCurrency)
    || rate === null || rate <= 0n || converted === null || applied === null || change === null
    || !isPaymentMinorAmount(converted, payment.targetCurrency)
    || !isPaymentMinorAmount(applied, payment.targetCurrency)
    || !isPaymentMinorAmount(change, payment.targetCurrency)
    || converted !== convertPaymentAmount(source, rate, payment.targetCurrency)
    || applied + change !== converted) return false;
  if (payment.sourceCurrency === payment.targetCurrency) {
    if (rate !== AMOUNT_SCALE) return false;
  } else {
    const fx = payment.fxConfirmation;
    if (payment.method !== 'CASH' || !fx || fx.authority !== 'SERVER'
      || fx.tenantId !== payment.tenantId || fx.branchId !== payment.branchId
      || !isValidFxActorBinding(fx) || fx.activeBranchMembership !== true
      || fx.sourceCurrency !== payment.sourceCurrency
      || fx.targetCurrency !== payment.targetCurrency || fx.rate !== payment.fxRate
      || !isValidTimestamp(fx.confirmedAt)) return false;
  }
  if (payment.method === 'SINPE' && (payment.sourceCurrency !== payment.targetCurrency
    || change !== 0n || applied !== converted)) return false;
  return true;
}

/** Lee evidencia ya persistida; nunca promueve PENDING ni modifica el pago. */
export function isCashShiftV2PaymentCountable(payment: CashShiftV2Payment): boolean {
  if (!payment || payment.authority !== 'SERVER' || !isNonEmptyString(payment.id)
    || !isNonEmptyString(payment.orderId) || !isNonEmptyString(payment.receivingSessionId)
    || !isNonEmptyString(payment.tenantId) || !isNonEmptyString(payment.branchId)
    || payment.status !== 'AUTHORIZED' || !isValidTimestamp(payment.authorizedAt)
    || !isValidPaymentArithmetic(payment)) return false;
  const applied = parseAmount(payment.appliedAmount);
  if (applied === null || applied <= 0n || !isPaymentMinorAmount(applied, payment.targetCurrency)) return false;
  if (payment.method === 'CASH') {
    const confirmation = payment.cashConfirmation;
    return !!confirmation && confirmation.authority === 'SERVER'
      && confirmation.tenantId === payment.tenantId && confirmation.branchId === payment.branchId
      && confirmation.activeBranchMembership === true && confirmation.canConfirmCash === true
      && isNonEmptyString(confirmation.actorId) && confirmation.actorId === confirmation.sessionActorId
      && confirmation.actorRole === confirmation.sessionRole && isValidTimestamp(confirmation.confirmedAt);
  }
  if (payment.method === 'SINPE') {
    const evidence = payment.sinpeEvidence;
    return payment.fxRate === '1.00000' && parseAmount(payment.changeAmount) === 0n
      && !!evidence && evidence.authority === 'SERVER' && evidence.tenantId === payment.tenantId
      && evidence.branchId === payment.branchId && (evidence.actorRole === 'ADMIN' || evidence.actorRole === 'CAJERO')
      && evidence.activeBranchMembership === true && evidence.appendOnly === true
      && isNonEmptyString(evidence.actorId) && isNonEmptyString(evidence.externalReference)
      && isValidTimestamp(evidence.recordedAt);
  }
  return false;
}

export interface CashShiftV2SessionReconciliation {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  sessionId: string;
  logicalShift: CashShiftV2Number;
  currency: CashShiftV2Currency;
  openingFloat: CashShiftV2TenderAmount;
  cashAppliedAmount: CashShiftV2TenderAmount;
  sinpeAppliedAmount: CashShiftV2TenderAmount;
  /** Total aplicado a órdenes en moneda de sucursal; excluye vuelto y órdenes abiertas. */
  totalCollectedAmount: CashShiftV2TenderAmount;
  /** Fondo inicial más CASH aplicado; no incluye SINPE ni ventas futuras. */
  expectedCashAmount: CashShiftV2TenderAmount;
  countablePaymentIds: string[];
}

/**
 * Suma solo pagos AUTHORIZED y verificables de la sesión receptora. Otros turnos
 * de la misma sucursal/jornada no se duplican; cualquier ambigüedad devuelve null.
 * Un refund bloquea el resumen porque no existe aquí un ledger de devoluciones.
 */
export function reconcileCashShiftV2Session(input: {
  session: CashShiftV2SessionReconciliationEvidence;
  fiscalProfile: CashShiftV2BranchFiscalProfile | null;
  payments: readonly CashShiftV2Payment[];
}): CashShiftV2SessionReconciliation | null {
  const { session, fiscalProfile, payments } = input;
  if (!session || !isValidCashShiftV2ReceivingSessionReference(session)
    || !isValidProfile(fiscalProfile) || !Array.isArray(payments)
    || session.tenantId !== fiscalProfile.tenantId || session.branchId !== fiscalProfile.branchId) return null;

  const openingFloat = parseAmount(session.openingFloat);
  if (openingFloat === null || !isPaymentMinorAmount(openingFloat, fiscalProfile.currency)) return null;

  let cashApplied = 0n;
  let sinpeApplied = 0n;
  const seenPaymentIds = new Set<string>();
  const countablePaymentIds: string[] = [];
  for (const payment of payments) {
    const receiving = payment?.receivingSession;
    if (!payment || payment.authority !== 'SERVER' || !isNonEmptyString(payment.id)
      || !isNonEmptyString(payment.orderId) || seenPaymentIds.has(payment.id)
      || !isValidCashShiftV2ReceivingSessionReference(receiving)
      || receiving.tenantId !== session.tenantId || receiving.branchId !== session.branchId
      || receiving.businessDate !== session.businessDate
      || payment.receivingSessionId !== receiving.sessionId
      || payment.tenantId !== receiving.tenantId || payment.branchId !== receiving.branchId
      || !isCurrency(payment.sourceCurrency) || !isCurrency(payment.branchCurrency)
      || !isCurrency(payment.targetCurrency) || payment.branchCurrency !== fiscalProfile.currency
      || payment.targetCurrency !== fiscalProfile.currency
      || (payment.method !== 'CASH' && payment.method !== 'SINPE')
      || !['AUTHORIZED', 'PENDING', 'FAILED', 'REFUNDED', 'CANCELLED'].includes(payment.status)) return null;
    seenPaymentIds.add(payment.id);

    if (receiving.sessionId !== session.sessionId) continue;
    if (!sameCashShiftV2Scope(receiving, session) || receiving.logicalShift !== session.logicalShift) return null;
    if (payment.status === 'FAILED' || payment.status === 'CANCELLED') continue;
    if (payment.status === 'REFUNDED') return null;
    if (payment.status !== 'AUTHORIZED' || !isCashShiftV2PaymentCountable(payment)) return null;

    const applied = parseAmount(payment.appliedAmount);
    if (applied === null || !isPaymentMinorAmount(applied, fiscalProfile.currency)) return null;
    if (payment.method === 'CASH') cashApplied += applied;
    else sinpeApplied += applied;
    if (!isRepresentableAmount(cashApplied) || !isRepresentableAmount(sinpeApplied)) return null;
    countablePaymentIds.push(payment.id);
  }

  const totalCollected = cashApplied + sinpeApplied;
  const expectedCash = openingFloat + cashApplied;
  if (!isRepresentableAmount(totalCollected) || !isRepresentableAmount(expectedCash)) return null;
  return {
    authority: 'SERVER',
    scope: {
      tenantId: session.tenantId, branchId: session.branchId,
      cashRegisterId: session.cashRegisterId, businessDate: session.businessDate
    },
    sessionId: session.sessionId,
    logicalShift: session.logicalShift,
    currency: fiscalProfile.currency,
    openingFloat: formatTender(openingFloat, fiscalProfile.currency),
    cashAppliedAmount: formatTender(cashApplied, fiscalProfile.currency),
    sinpeAppliedAmount: formatTender(sinpeApplied, fiscalProfile.currency),
    totalCollectedAmount: formatTender(totalCollected, fiscalProfile.currency),
    expectedCashAmount: formatTender(expectedCash, fiscalProfile.currency),
    countablePaymentIds
  };
}

export type CashShiftV2CloseBlockerCode =
  | 'UNRESOLVED_PAYMENT' | 'OPEN_ORDER' | 'OCCUPIED_TABLE_WITHOUT_ORDER'
  | 'HELD_ORDER' | 'UNRESOLVED_LEGACY_ENTITY' | 'FISCAL_PROFILE_MISSING' | 'INVALID_SCOPE'
  | 'INVALID_CLOSE_SESSION' | 'INCOMPLETE_CLOSE_SNAPSHOT' | 'PAYMENT_OUT_OF_SCOPE'
  | 'OPEN_ORDER_OUT_OF_SCOPE' | 'TABLE_OUT_OF_SCOPE' | 'PAYMENT_CURRENCY_MISMATCH'
  | 'SESSION_RECONCILIATION_UNAVAILABLE';

export interface CashShiftV2CloseBlocker {
  code: CashShiftV2CloseBlockerCode;
  entityId: string;
}

export interface CashShiftV2CloseDecision {
  canClose: boolean;
  blockers: CashShiftV2CloseBlocker[];
  countablePaymentIds: string[];
  sessionReconciliation: CashShiftV2SessionReconciliation | null;
  preservedOpenOrders: CashShiftV2OpenOrderSnapshot[];
}

export function evaluateCashShiftV2Close(input: {
  scope: CashShiftV2Scope;
  sessionId: string;
  shiftNumber: CashShiftV2Number;
  snapshotEvidence: CashShiftV2CloseSnapshotEvidence;
  payments: CashShiftV2Payment[];
  openOrders: CashShiftV2OpenOrderSnapshot[];
  occupiedTablesWithoutOrder: CashShiftV2OccupiedTableSnapshot[];
  heldOrderIds?: string[];
  unresolvedLegacyEntities?: string[];
  fiscalProfile: CashShiftV2BranchFiscalProfile | null;
}): CashShiftV2CloseDecision {
  const blockers: CashShiftV2CloseBlocker[] = [];
  if (!isValidCashShiftV2Scope(input.scope)) blockers.push({ code: 'INVALID_SCOPE', entityId: '' });
  if (!isNonEmptyString(input.sessionId) || (input.shiftNumber !== 1 && input.shiftNumber !== 2)) {
    blockers.push({ code: 'INVALID_CLOSE_SESSION', entityId: isNonEmptyString(input.sessionId) ? input.sessionId : '' });
  }
  const expectedCoverage = input.shiftNumber === 1 ? 'REGISTER' : 'COMPLETE_BRANCH_BUSINESS_DATE';
  const snapshotValid = input.snapshotEvidence?.authority === 'SERVER'
    && isValidCashShiftV2Scope(input.scope) && isValidCashShiftV2Scope(input.snapshotEvidence.scope)
    && sameCashShiftV2Scope(input.snapshotEvidence.scope, input.scope)
    && isValidCashShiftV2ReceivingSessionReference(input.snapshotEvidence.session)
    && sameCashShiftV2Scope(input.snapshotEvidence.session, input.scope)
    && input.snapshotEvidence.session.sessionId === input.sessionId
    && input.snapshotEvidence.session.logicalShift === input.shiftNumber
    && input.snapshotEvidence.coverage === expectedCoverage;
  if (!snapshotValid) blockers.push({ code: 'INCOMPLETE_CLOSE_SNAPSHOT', entityId: input.sessionId ?? '' });
  if (!isValidProfile(input.fiscalProfile) || !isValidCashShiftV2Scope(input.scope)
    || input.fiscalProfile.tenantId !== input.scope.tenantId
    || input.fiscalProfile.branchId !== input.scope.branchId) {
    blockers.push({ code: 'FISCAL_PROFILE_MISSING', entityId: '' });
  }
  const reconciliation = snapshotValid && isValidProfile(input.fiscalProfile)
    ? reconcileCashShiftV2Session({
      session: input.snapshotEvidence.session, fiscalProfile: input.fiscalProfile, payments: input.payments
    })
    : null;
  for (const payment of input.payments) {
    const receivingSession = payment?.receivingSession;
    if (!isValidCashShiftV2Scope(input.scope) || !isValidCashShiftV2ReceivingSessionReference(receivingSession)
      || !sameCashShiftV2Scope(receivingSession, input.scope)
      || receivingSession.sessionId !== input.sessionId || receivingSession.logicalShift !== input.shiftNumber
      || payment.receivingSessionId !== receivingSession.sessionId
      || payment.tenantId !== input.scope.tenantId || payment.branchId !== input.scope.branchId) {
      blockers.push({ code: 'PAYMENT_OUT_OF_SCOPE', entityId: isNonEmptyString(payment?.id) ? payment.id : '' });
      continue;
    }
    if (isValidProfile(input.fiscalProfile) && payment.branchCurrency !== input.fiscalProfile.currency) {
      blockers.push({ code: 'PAYMENT_CURRENCY_MISMATCH', entityId: payment.id });
      continue;
    }
    if (isCashShiftV2PaymentCountable(payment)) continue;
    else if (payment.status !== 'FAILED' && payment.status !== 'REFUNDED' && payment.status !== 'CANCELLED') {
      blockers.push({ code: 'UNRESOLVED_PAYMENT', entityId: payment.id });
    }
  }
  if (!reconciliation && blockers.length === 0) {
    blockers.push({ code: 'SESSION_RECONCILIATION_UNAVAILABLE', entityId: input.sessionId });
  }
  for (const id of input.heldOrderIds ?? []) blockers.push({ code: 'HELD_ORDER', entityId: id });
  for (const id of input.unresolvedLegacyEntities ?? []) blockers.push({ code: 'UNRESOLVED_LEGACY_ENTITY', entityId: id });
  const inScopeOpenOrders: CashShiftV2OpenOrderSnapshot[] = [];
  let hasOpenOrderScopeViolation = false;
  for (const order of input.openOrders) {
    const orderMatchesScope = !!order && isValidCashShiftV2Scope(input.scope)
      && (input.shiftNumber === 2
        ? order.tenantId === input.scope.tenantId && order.branchId === input.scope.branchId
          && order.businessDate === input.scope.businessDate
        : isValidCashShiftV2Scope(order) && sameCashShiftV2Scope(order, input.scope));
    if (!order || order.source !== 'SERVER' || !isValidCashShiftV2Scope(order)
      || !orderMatchesScope
      || !isNonEmptyString(order.orderId)) {
      blockers.push({ code: 'OPEN_ORDER_OUT_OF_SCOPE', entityId: isNonEmptyString(order?.orderId) ? order.orderId : '' });
      hasOpenOrderScopeViolation = true;
      continue;
    }
    inScopeOpenOrders.push(order);
  }
  const inScopeOccupiedTables: CashShiftV2OccupiedTableSnapshot[] = [];
  for (const table of input.occupiedTablesWithoutOrder) {
    const tableScopeValid = !!table && table.authority === 'SERVER' && isValidCashShiftV2Scope(input.scope)
      && isValidCashShiftV2Scope({ ...input.scope, businessDate: table.businessDate })
      && isNonEmptyString(table.tableId) && table.tenantId === input.scope.tenantId
      && table.branchId === input.scope.branchId && table.businessDate === input.scope.businessDate
      && (table.cashRegisterId === undefined || isNonEmptyString(table.cashRegisterId));
    if (!tableScopeValid) {
      blockers.push({ code: 'TABLE_OUT_OF_SCOPE', entityId: isNonEmptyString(table?.tableId) ? table.tableId : '' });
      continue;
    }
    inScopeOccupiedTables.push(table);
  }
  if (input.shiftNumber === 2) {
    for (const order of inScopeOpenOrders) blockers.push({ code: 'OPEN_ORDER', entityId: order.orderId });
    for (const table of inScopeOccupiedTables) {
      blockers.push({ code: 'OCCUPIED_TABLE_WITHOUT_ORDER', entityId: table.tableId });
    }
  }
  return {
    canClose: blockers.length === 0,
    blockers,
    countablePaymentIds: reconciliation?.countablePaymentIds ?? [],
    sessionReconciliation: reconciliation,
    preservedOpenOrders: input.shiftNumber === 1 && snapshotValid && !hasOpenOrderScopeViolation
      ? structuredClone(inScopeOpenOrders) : []
  };
}

export interface CashShiftV2CloseCommand {
  scope: CashShiftV2Scope;
  sessionId: string;
  logicalShift: CashShiftV2Number;
  countedCash: CashShiftV2Amount;
  request: CashShiftV2IdempotencyRequest;
}

export interface CashShiftV2OpenShiftCommand {
  scope: CashShiftV2Scope;
  logicalShift: CashShiftV2Number;
  openingFloat: CashShiftV2Amount;
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2OpenShiftCommand(value: CashShiftV2OpenShiftCommand): boolean {
  const openingFloat = parseAmount(value?.openingFloat);
  return !!value && isValidCashShiftV2Scope(value.scope)
    && (value.logicalShift === 1 || value.logicalShift === 2)
    && openingFloat !== null && openingFloat >= 0n && isValidIdempotencyRequest(value.request);
}

export type CashShiftV2OrderSyncLineInput = Omit<CashShiftV2OrderLineInput, 'resolutionState' | 'voidReason'>;

export interface CashShiftV2OrderSyncCommand {
  scope: CashShiftV2Scope;
  sessionId: string;
  orderId?: string;
  tableId: string;
  tableName: string;
  waiterEmployeeId: string;
  /** Solo se usa para verificar cambios posteriores de salonero; nunca se persiste. */
  currentWaiterPin?: string;
  lines: CashShiftV2OrderSyncLineInput[];
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2OrderSyncCommand(value: CashShiftV2OrderSyncCommand): boolean {
  if (!value || !isValidCashShiftV2Scope(value.scope) || !isNonEmptyString(value.sessionId)
    || (value.orderId !== undefined && !isNonEmptyString(value.orderId))
    || !isNonEmptyString(value.tableId) || !isNonEmptyString(value.tableName)
    || !isNonEmptyString(value.waiterEmployeeId) || !Array.isArray(value.lines) || value.lines.length === 0
    // El PIN no se recorta ni normaliza; el RPC lo compara contra bcrypt y no lo persiste.
    || (value.currentWaiterPin !== undefined && (typeof value.currentWaiterPin !== 'string'
      || !/^\d{4}$/.test(value.currentWaiterPin)))
    || !isValidIdempotencyRequest(value.request)) return false;
  const lineIds = new Set<string>();
  for (const line of value.lines) {
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parseAmount(line.unitPrice);
    if (!isNonEmptyString(line.lineId) || lineIds.has(line.lineId)
      || (line.menuItemId !== null && !isNonEmptyString(line.menuItemId))
      || !isNonEmptyString(line.itemName) || quantity === null || quantity <= 0n
      || unitPrice === null || unitPrice < 0n || !TAX_RATES.includes(line.taxRate)) return false;
    lineIds.add(line.lineId);
  }
  return true;
}

export type CashShiftV2HeldLineResolution = 'ADOPT_CURRENT_PRICE' | 'LINK_ITEM' | 'VOID';

export interface CashShiftV2HeldLineResolutionCommand {
  scope: CashShiftV2Scope;
  orderId: string;
  lineId: string;
  resolution: CashShiftV2HeldLineResolution;
  linkedMenuItemId?: string;
  reason?: string;
  explicitConfirmation?: true;
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2HeldLineResolutionCommand(value: CashShiftV2HeldLineResolutionCommand): boolean {
  if (!value || !isValidCashShiftV2Scope(value.scope) || !isNonEmptyString(value.orderId)
    || !isNonEmptyString(value.lineId) || !isValidIdempotencyRequest(value.request)) return false;
  if (value.resolution === 'ADOPT_CURRENT_PRICE') return value.explicitConfirmation === true
    && value.linkedMenuItemId === undefined && value.reason === undefined;
  if (value.resolution === 'LINK_ITEM') return isNonEmptyString(value.linkedMenuItemId)
    && value.explicitConfirmation === undefined && value.reason === undefined;
  return value.resolution === 'VOID' && isNonEmptyString(value.reason)
    && value.reason.length <= 500 && value.explicitConfirmation === undefined
    && value.linkedMenuItemId === undefined;
}

export interface CashShiftV2OrderTransferCommand {
  scope: CashShiftV2Scope;
  sessionId: string;
  sourceOrderId: string;
  targetSalonId: string;
  targetTableId: string;
  /** IDs en el orden visible deseado; el servidor valida que sean la permutación exacta. */
  lineIdsInDisplayOrder: string[];
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2OrderTransferCommand(value: CashShiftV2OrderTransferCommand): boolean {
  if (!value || !isValidCashShiftV2Scope(value.scope) || !isNonEmptyString(value.sessionId)
    || !isNonEmptyString(value.sourceOrderId) || !isNonEmptyString(value.targetSalonId)
    || !isNonEmptyString(value.targetTableId) || !Array.isArray(value.lineIdsInDisplayOrder)
    || value.lineIdsInDisplayOrder.length === 0 || !isValidIdempotencyRequest(value.request)) return false;
  const lineIds = new Set(value.lineIdsInDisplayOrder);
  return lineIds.size === value.lineIdsInDisplayOrder.length
    && value.lineIdsInDisplayOrder.every(isNonEmptyString);
}

export interface CashShiftV2FxRateInput {
  sourceCurrency: CashShiftV2Currency;
  targetCurrency: CashShiftV2Currency;
  /** Unidades destino por una unidad fuente; solo lo confirma el cajero autenticado. */
  rate: CashShiftV2Amount;
  explicitConfirmation: true;
}

export interface CashShiftV2CaptureCashCommand {
  scope: CashShiftV2Scope;
  orderId: string;
  receivingSessionId: string;
  sourceAmount: CashShiftV2TenderAmount;
  sourceCurrency: CashShiftV2Currency;
  branchCurrency: CashShiftV2Currency;
  explicitCashConfirmation: true;
  fx?: CashShiftV2FxRateInput;
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2CaptureCashCommand(value: CashShiftV2CaptureCashCommand): boolean {
  const sourceAmount = parseAmount(value?.sourceAmount);
  if (!value || !isValidCashShiftV2Scope(value.scope) || !isNonEmptyString(value.orderId)
    || !isNonEmptyString(value.receivingSessionId) || sourceAmount === null || sourceAmount <= 0n
    || !isCurrency(value.sourceCurrency) || !isPaymentMinorAmount(sourceAmount, value.sourceCurrency)
    || !isCurrency(value.branchCurrency)
    || value.explicitCashConfirmation !== true
    || !isValidIdempotencyRequest(value.request)) return false;
  if (value.sourceCurrency === value.branchCurrency) return value.fx === undefined;
  if (!value.fx) return false;
  const rate = parseAmount(value.fx.rate);
  return value.fx.explicitConfirmation === true && isCurrency(value.fx.sourceCurrency)
    && isCurrency(value.fx.targetCurrency) && value.fx.sourceCurrency === value.sourceCurrency
    && value.fx.targetCurrency === value.branchCurrency && value.fx.sourceCurrency !== value.fx.targetCurrency
    && rate !== null && rate > 0n;
}

export interface CashShiftV2CaptureSinpeCommand {
  scope: CashShiftV2Scope;
  orderId: string;
  receivingSessionId: string;
  amount: CashShiftV2TenderAmount;
  currency: CashShiftV2Currency;
  branchCurrency: CashShiftV2Currency;
  externalReference: string;
  explicitEvidenceConfirmation: true;
  request: CashShiftV2IdempotencyRequest;
}

export function isValidCashShiftV2CaptureSinpeCommand(value: CashShiftV2CaptureSinpeCommand): boolean {
  const amount = parseAmount(value?.amount);
  return !!value && isValidCashShiftV2Scope(value.scope) && isNonEmptyString(value.orderId)
    && isNonEmptyString(value.receivingSessionId) && amount !== null && amount > 0n
    && isCurrency(value.currency) && isCurrency(value.branchCurrency) && value.currency === value.branchCurrency
    && isPaymentMinorAmount(amount, value.currency)
    && isNonEmptyString(value.externalReference)
    && value.explicitEvidenceConfirmation === true && isValidIdempotencyRequest(value.request);
}

export interface CashShiftV2CloseReceipt {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  sessionId: string;
  logicalShift: CashShiftV2Number;
  closedAt: string;
  countedCash: CashShiftV2Amount;
  systemTotals: CashShiftV2CalculatedOrderFinancials;
  sessionReconciliation: CashShiftV2SessionReconciliation;
  preservedOpenOrders: CashShiftV2OpenOrderSnapshot[];
  nextShiftOpeningFloat?: CashShiftV2Amount;
}

/** Puerto futuro solamente: no hay implementación ni adapter conectado. */
export interface CashShiftV2ServerAdapterContract {
  readonly enabled: false;
  readAuthoritativeSnapshot(scope: CashShiftV2Scope): Promise<CashShiftV2AuthoritativeSnapshot>;
  closeShift(command: CashShiftV2CloseCommand): Promise<CashShiftV2CloseReceipt>;
}

export interface CashShiftV2SyncedLinePriceCheck {
  lineId: string;
  menuItemId: string | null;
  offlineUnitPrice: CashShiftV2Amount;
  currentCatalogUnitPrice?: CashShiftV2Amount;
}

export type CashShiftV2LineSyncDisposition =
  | { state: 'ACCEPTED'; lineId: string; authoritativeUnitPrice: CashShiftV2Amount }
  | { state: 'HELD'; reason: 'MISSING_ITEM' | 'PRICE_MISMATCH'; lineId: string };

/** Diferencia offline o item sin ID queda retenido; nunca se corrige en silencio. */
export function evaluateCashShiftV2OfflineLinePrice(
  input: CashShiftV2SyncedLinePriceCheck
): CashShiftV2LineSyncDisposition {
  if (!isNonEmptyString(input.lineId)) throw new Error('La línea offline requiere id.');
  if (!isNonEmptyString(input.menuItemId)) return { state: 'HELD', reason: 'MISSING_ITEM', lineId: input.lineId };
  const offlinePrice = parseAmount(input.offlineUnitPrice);
  const currentPrice = parseAmount(input.currentCatalogUnitPrice);
  if (offlinePrice === null || currentPrice === null) {
    return { state: 'HELD', reason: 'PRICE_MISMATCH', lineId: input.lineId };
  }
  if (offlinePrice !== currentPrice) return { state: 'HELD', reason: 'PRICE_MISMATCH', lineId: input.lineId };
  return { state: 'ACCEPTED', lineId: input.lineId, authoritativeUnitPrice: formatDecimal(currentPrice, AMOUNT_DIGITS) };
}

export interface CashShiftV2PriceResolution {
  actor: CashShiftV2ActorContext;
  request: CashShiftV2IdempotencyRequest;
  resolution: 'ADOPT_CURRENT_CATALOG_PRICE';
  explicitConfirmation: true;
  currentCatalogUnitPrice: CashShiftV2Amount;
  auditEventId: string;
  reason: string;
}

export function isValidCashShiftV2PriceResolution(value: CashShiftV2PriceResolution): boolean {
  return !!value && value.actor?.authority === 'SERVER'
    && (value.actor.role === 'ADMIN' || value.actor.role === 'CAJERO')
    && value.actor.activeBranchMembership === true && value.resolution === 'ADOPT_CURRENT_CATALOG_PRICE'
    && value.explicitConfirmation === true && parseAmount(value.currentCatalogUnitPrice) !== null
    && isValidIdempotencyRequest(value.request) && isNonEmptyString(value.auditEventId)
    && isNonEmptyString(value.reason);
}

export interface CashShiftV2LinkedMenuItem {
  id: string;
  tenantId: string;
  branchId: string;
  available: boolean;
}

export interface CashShiftV2MissingItemResolution {
  actor: CashShiftV2ActorContext;
  request: CashShiftV2IdempotencyRequest;
  resolution: 'LINK_CATALOG_ITEM' | 'VOID_ITEM';
  linkedMenuItem?: CashShiftV2LinkedMenuItem;
  reason?: string;
  auditEventId: string;
}

export function isValidCashShiftV2MissingItemResolution(value: CashShiftV2MissingItemResolution): boolean {
  if (!value || value.actor?.authority !== 'SERVER'
    || (value.actor.role !== 'ADMIN' && value.actor.role !== 'CAJERO')
    || value.actor.activeBranchMembership !== true || !isValidIdempotencyRequest(value.request)
    || !isNonEmptyString(value.auditEventId)) return false;
  if (value.resolution === 'LINK_CATALOG_ITEM') {
    const item = value.linkedMenuItem;
    return !!item && isNonEmptyString(item.id) && item.tenantId === value.actor.tenantId
      && item.branchId === value.actor.branchId && item.available === true;
  }
  return value.resolution === 'VOID_ITEM' && isNonEmptyString(value.reason);
}

export interface CashShiftV2EmployeeRecord {
  tenantId: string;
  branchId: string;
  employeeId: string;
  name: string;
  role: CashShiftV2Role;
  active: boolean;
  activeBranchMembership: boolean;
}

export interface CashShiftV2CurrentPinVerification {
  authority: 'SERVER';
  tenantId: string;
  branchId: string;
  employeeId: string;
  verifiedAt: string;
  challengeId: string;
}

export interface CashShiftV2WaiterAssignmentInput {
  tenantId: string;
  branchId: string;
  previousEmployeeId: string | null;
  candidate: CashShiftV2EmployeeRecord;
  currentPinVerification?: CashShiftV2CurrentPinVerification;
}

export interface CashShiftV2WaiterAssignment {
  employeeId: string;
  displayName: string;
  firstAssignment: boolean;
  pinVerification?: CashShiftV2CurrentPinVerification;
}

/** Primera asignación sin PIN; cambios posteriores requieren PIN actual validado. */
export function validateCashShiftV2WaiterAssignment(
  input: CashShiftV2WaiterAssignmentInput
): CashShiftV2WaiterAssignment {
  const candidate = input.candidate;
  if (!isNonEmptyString(input.tenantId) || !isNonEmptyString(input.branchId)
    || candidate.tenantId !== input.tenantId || candidate.branchId !== input.branchId
    || candidate.active !== true || candidate.activeBranchMembership !== true
    || !isNonEmptyString(candidate.employeeId) || !isNonEmptyString(candidate.name)) {
    throw new Error('El salonero debe estar activo y con membresía activa en la misma sucursal.');
  }
  const firstAssignment = input.previousEmployeeId === null;
  if (!firstAssignment && candidate.employeeId !== input.previousEmployeeId) {
    const proof = input.currentPinVerification;
    if (!proof || proof.authority !== 'SERVER' || proof.tenantId !== input.tenantId
      || proof.branchId !== input.branchId || proof.employeeId !== input.previousEmployeeId
      || !isValidTimestamp(proof.verifiedAt) || !isNonEmptyString(proof.challengeId)) {
      throw new Error('El cambio de salonero requiere verificar el PIN vigente.');
    }
    return { employeeId: candidate.employeeId, displayName: candidate.name, firstAssignment, pinVerification: proof };
  }
  return { employeeId: candidate.employeeId, displayName: candidate.name, firstAssignment };
}

export interface CashShiftV2LegacyDisposition {
  actor: CashShiftV2ActorContext;
  request: CashShiftV2IdempotencyRequest;
  action: 'RECONCILE' | 'CANCEL';
  sourceSessionId?: string;
  reason: string;
  auditEventId: string;
}

export function isValidCashShiftV2LegacyDisposition(value: CashShiftV2LegacyDisposition): boolean {
  return !!value && value.actor?.authority === 'SERVER'
    && (value.actor.role === 'ADMIN' || value.actor.role === 'CAJERO')
    && value.actor.activeBranchMembership === true
    && (value.action === 'RECONCILE' ? isNonEmptyString(value.sourceSessionId) : value.action === 'CANCEL')
    && isNonEmptyString(value.reason) && isNonEmptyString(value.auditEventId)
    && isValidIdempotencyRequest(value.request);
}

export function isCashShiftV2PaymentMethod(value: unknown): value is CashShiftV2PaymentMethod {
  return value === 'CASH' || value === 'SINPE';
}

export function isValidCashShiftV2ServerTotals(
  profile: CashShiftV2BranchFiscalProfile | null | undefined,
  lines: readonly CashShiftV2OrderLineInput[],
  serverFinancials: CashShiftV2ServerOrderFinancials
): boolean {
  if (!isValidProfile(profile) || !serverFinancials || serverFinancials.authority !== 'SERVER'
    || !sameFiscalProfile(serverFinancials.branchFiscalProfile, profile)
    || !isValidCashShiftV2ServerOrderFinancials(serverFinancials)) return false;
  try {
    const expected = calculateCashShiftV2OrderFinancials(profile, lines);
    return sameCalculatedFinancials(expected, serverFinancials.financials);
  } catch {
    return false;
  }
}

/** Apertura diaria conserva fecha y abridor al cruzar medianoche. */
export function canCloseCashShiftV2DailyOpening(
  opening: CashShiftV2DailyOpeningIdentity,
  request: CashShiftV2DailyCloseRequest
): boolean {
  const openedAt = Date.parse(opening.openedAt);
  const closedAt = Date.parse(request.closedAt);
  return isNonEmptyString(opening.openedByActorId)
    && request.closedByActorId === opening.openedByActorId
    && request.businessDate === opening.businessDate
    && Number.isFinite(openedAt) && Number.isFinite(closedAt) && closedAt > openedAt;
}
