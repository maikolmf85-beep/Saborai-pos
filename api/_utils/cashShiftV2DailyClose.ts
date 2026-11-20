import {
  canCloseCashShiftV2DailyOpening,
  isCashShiftV2PaymentCountable,
  isValidCashShiftV2SessionSet,
  reconcileCashShiftV2Session,
  type CashShiftV2BranchFiscalProfile,
  type CashShiftV2OpenOrderSnapshot,
  type CashShiftV2OccupiedTableSnapshot,
  type CashShiftV2Payment,
  type CashShiftV2Scope,
  type CashShiftV2Session,
  type CashShiftV2SessionReconciliation,
  type CashShiftV2DailyOpeningIdentity,
  type CashShiftV2Currency
} from '../../src/services/cashShiftV2Contract.ts';

export type CashShiftV2DailyCloseMode = 'OFF' | 'PREPARED' | 'ACTIVE' | 'QUIESCING' | 'FROZEN';

export interface CashShiftV2DailyCloseRpcArgs {
  tenantId: string;
  branchId: string;
  cashRegisterId: string;
  businessDate: string;
  closedByIdentityId: string;
  actorUserId: string;
  actorEmployeeId: string | null;
  actorRole: string;
}

export interface CashShiftV2DailyCloseDispatchDependencies<T> {
  readMode(tenantId: string, branchId: string): Promise<CashShiftV2DailyCloseMode | null>;
  closeLegacy(): Promise<T>;
  closeV2Aware(args: CashShiftV2DailyCloseRpcArgs): Promise<T>;
}

export function isCashShiftV2DailyCloseEnabled(input: {
  globalEnabled: boolean;
  routeEnabled: string | undefined;
  dailyAwareEnabled: string | undefined;
}): boolean {
  return input.globalEnabled
    && input.routeEnabled === 'true'
    && input.dailyAwareEnabled === 'true';
}

export class CashShiftV2DailyCloseDispatchError extends Error {
  readonly code = 'V2_DAILY_CLOSE_BLOCKED';
  readonly status = 503;

  constructor(message = 'El cierre diario V2 no está disponible; no se aplicó el cierre legacy en una sucursal V2.') {
    super(message);
    this.name = 'CashShiftV2DailyCloseDispatchError';
  }
}

/** Con V2 deshabilitado se conserva legacy sin leer tablas V2; habilitado, ACTIVE no hace fallback. */
export async function dispatchCashShiftV2AwareDailyClose<T>(input: {
  enabled: boolean;
  args: CashShiftV2DailyCloseRpcArgs;
  dependencies: CashShiftV2DailyCloseDispatchDependencies<T>;
}): Promise<{ result: T; path: 'LEGACY' | 'V2'; auditHandledAtomically: boolean }> {
  const { enabled, args, dependencies } = input;
  if (!enabled) {
    return { result: await dependencies.closeLegacy(), path: 'LEGACY', auditHandledAtomically: false };
  }

  let mode: CashShiftV2DailyCloseMode | null;
  try {
    mode = await dependencies.readMode(args.tenantId, args.branchId);
  } catch {
    throw new CashShiftV2DailyCloseDispatchError('No se pudo comprobar el modo V2 de la sucursal; el cierre diario fue bloqueado.');
  }
  if (mode === 'OFF' || mode === 'PREPARED') {
    return { result: await dependencies.closeLegacy(), path: 'LEGACY', auditHandledAtomically: false };
  }
  if (mode === null) {
    throw new CashShiftV2DailyCloseDispatchError('No existe un modo de caja V2 para la sucursal; el cierre diario fue bloqueado.');
  }
  if (mode === 'ACTIVE') {
    if (!enabled) throw new CashShiftV2DailyCloseDispatchError();
    try {
      return { result: await dependencies.closeV2Aware(args), path: 'V2', auditHandledAtomically: true };
    } catch {
      throw new CashShiftV2DailyCloseDispatchError();
    }
  }
  throw new CashShiftV2DailyCloseDispatchError('La sucursal V2 está en transición o congelada; el cierre diario requiere reconciliación.');
}

export type CashShiftV2DailyCloseBlockerCode =
  | 'INVALID_SCOPE' | 'FISCAL_PROFILE_MISSING' | 'DAILY_OPENING_IDENTITY_MISMATCH'
  | 'INVALID_SESSION_COVERAGE' | 'SHIFT_NOT_CLOSED' | 'RECEIVING_SESSION_MISSING'
  | 'DUPLICATE_PAYMENT' | 'UNRESOLVED_PAYMENT' | 'UNVERIFIED_PAYMENT'
  | 'INVALID_REGISTER_ROSTER' | 'PAYMENT_CURRENCY_MISMATCH'
  | 'SNAPSHOT_REGISTER_SET_MISMATCH' | 'SNAPSHOT_SESSION_SET_MISMATCH'
  | 'OPEN_ORDER' | 'OCCUPIED_TABLE' | 'HELD_ORDER' | 'UNRESOLVED_LEGACY'
  | 'SESSION_RECONCILIATION_UNAVAILABLE' | 'INCOMPLETE_SNAPSHOT';

export interface CashShiftV2DailyCloseLedgerSummary {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  fiscalCurrency: CashShiftV2Currency;
  dailyOpening: CashShiftV2DailyOpeningIdentity;
  branchRegisterIds: string[];
  activeRequiredRegisterIds: string[];
  snapshotRegisterIds: string[];
  branchSessionIds: string[];
  coveredSessionIds: string[];
  snapshotSessionIds: string[];
  sessionIds: string[];
  cashAppliedAmount: string;
  sinpeAppliedAmount: string;
  totalCollectedAmount: string;
  /** T2 fondo heredado + CASH aplicado en T2; no suma el fondo T1 por segunda vez. */
  expectedCashAmount: string;
  countablePaymentIds: string[];
  sessionReconciliations: CashShiftV2SessionReconciliation[];
}

export interface CashShiftV2DailyCloseLedgerDecision {
  canClose: boolean;
  blockers: Array<{ code: CashShiftV2DailyCloseBlockerCode; entityId: string }>;
  summary: CashShiftV2DailyCloseLedgerSummary | null;
}

function parseTenderUnits(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,5})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  try {
    return BigInt(whole) * 100_000n + BigInt(fraction.padEnd(5, '0') || '0');
  } catch {
    return null;
  }
}

function formatTenderUnits(value: bigint, currency: CashShiftV2Currency): string {
  const minorQuantum = currency === 'CRC' ? 100_000n : 1_000n;
  if (value < 0n || value % minorQuantum !== 0n) throw new Error('El ledger daily contiene monto no representable por moneda.');
  const minorUnits = value / minorQuantum;
  if (currency === 'CRC') return minorUnits.toString();
  return `${minorUnits / 100n}.${(minorUnits % 100n).toString().padStart(2, '0')}`;
}

function sessionReconciliationEvidence(session: CashShiftV2Session) {
  return {
    authority: 'SERVER' as const,
    tenantId: session.tenantId,
    branchId: session.branchId,
    cashRegisterId: session.cashRegisterId,
    businessDate: session.businessDate,
    sessionId: session.sessionId,
    logicalShift: session.logicalShift,
    openingFloat: session.openingFloat
  };
}

function hasExactStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)
    || left.some(value => typeof value !== 'string' || value.trim().length === 0)
    || right.some(value => typeof value !== 'string' || value.trim().length === 0)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value));
}

/**
 * Pure verification for the V2-aware daily-close RPC. Sales are assigned only by
 * payment.receivingSession; order origin/cash_shift_id never selects a payment's
 * closing register or turn. The server RPC must provide a complete locked snapshot.
 */
export function evaluateCashShiftV2DailyCloseLedger(input: {
  authority: 'SERVER';
  scope: CashShiftV2Scope;
  fiscalProfile: CashShiftV2BranchFiscalProfile | null;
  dailyOpening: CashShiftV2DailyOpeningIdentity;
  sessionCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE' | 'REGISTER';
  snapshotCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE' | 'REGISTER_ONLY';
  branchRegisterIds: readonly string[];
  snapshotRegisterIds: readonly string[];
  snapshotSessionIds: readonly string[];
  closedAt: string;
  closedByActorId: string;
  sessions: readonly CashShiftV2Session[];
  payments: readonly CashShiftV2Payment[];
  openOrders: readonly CashShiftV2OpenOrderSnapshot[];
  occupiedTables: readonly CashShiftV2OccupiedTableSnapshot[];
  heldOrderIds?: readonly string[];
  unresolvedLegacyEntities?: readonly string[];
}): CashShiftV2DailyCloseLedgerDecision {
  const blockers: CashShiftV2DailyCloseLedgerDecision['blockers'] = [];
  const add = (code: CashShiftV2DailyCloseBlockerCode, entityId = '') => blockers.push({ code, entityId });
  const { scope, fiscalProfile } = input;
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const payments = Array.isArray(input.payments) ? input.payments : [];
  const openOrders = Array.isArray(input.openOrders) ? input.openOrders : [];
  const occupiedTables = Array.isArray(input.occupiedTables) ? input.occupiedTables : [];
  if (!Array.isArray(input.sessions) || !Array.isArray(input.payments)
    || !Array.isArray(input.openOrders) || !Array.isArray(input.occupiedTables)
    || !Array.isArray(input.branchRegisterIds) || !Array.isArray(input.snapshotRegisterIds)
    || !Array.isArray(input.snapshotSessionIds)) add('INCOMPLETE_SNAPSHOT');
  if (input.snapshotCoverage !== 'COMPLETE_BRANCH_BUSINESS_DATE') add('INCOMPLETE_SNAPSHOT');

  if (input.authority !== 'SERVER' || !scope?.tenantId || !scope.branchId || !scope.cashRegisterId
    || !/^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)) add('INVALID_SCOPE');
  if (!fiscalProfile || fiscalProfile.authority !== 'SERVER' || fiscalProfile.tenantId !== scope?.tenantId
    || fiscalProfile.branchId !== scope?.branchId || fiscalProfile.priceBasis !== 'EXCLUSIVE_OF_VAT'
    || !['IVA_13', 'IVA_0'].includes(fiscalProfile.taxRegime)
    || !['CRC', 'USD'].includes(fiscalProfile.currency)) add('FISCAL_PROFILE_MISSING');
  if (!input.dailyOpening || input.dailyOpening.businessDate !== scope?.businessDate
    || !canCloseCashShiftV2DailyOpening(input.dailyOpening, {
      businessDate: scope?.businessDate || '', closedAt: input.closedAt,
      closedByActorId: input.closedByActorId
    })) add('DAILY_OPENING_IDENTITY_MISMATCH');

  if (!isValidCashShiftV2SessionSet({
    tenantId: scope?.tenantId || '', branchId: scope?.branchId || '', businessDate: scope?.businessDate || ''
  }, sessions)) add('INVALID_SESSION_COVERAGE');
  if (input.sessionCoverage !== 'COMPLETE_BRANCH_BUSINESS_DATE') add('INVALID_SESSION_COVERAGE');
  const branchRegisterIds = Array.isArray(input.branchRegisterIds) ? input.branchRegisterIds : [];
  const branchRegisterSet = new Set(branchRegisterIds);
  if (branchRegisterIds.length === 0 || branchRegisterSet.size !== branchRegisterIds.length
    || branchRegisterIds.some(id => typeof id !== 'string' || id.trim().length === 0)
    || sessions.some(session => !branchRegisterSet.has(session.cashRegisterId))
    || branchRegisterIds.some(id => !sessions.some(session =>
      session.cashRegisterId === id && session.logicalShift === 1))
    || branchRegisterIds.some(id => {
      const registerSessions = sessions.filter(session => session.cashRegisterId === id);
      return registerSessions.length !== 2
        || !registerSessions.some(session => session.logicalShift === 1)
        || !registerSessions.some(session => session.logicalShift === 2);
    })) add('INVALID_REGISTER_ROSTER');
  const actualSessionIds = sessions.map(session => session.sessionId);
  if (!hasExactStringSet(branchRegisterIds, input.snapshotRegisterIds ?? [])) add('SNAPSHOT_REGISTER_SET_MISMATCH');
  if (!hasExactStringSet(actualSessionIds, input.snapshotSessionIds ?? [])) add('SNAPSHOT_SESSION_SET_MISMATCH');
  if (sessions.some(session => session.status !== 'CLOSED')) add('SHIFT_NOT_CLOSED');

  const registerSessions = sessions.filter(session => session.cashRegisterId === scope?.cashRegisterId);
  const t1 = registerSessions.find(session => session.logicalShift === 1);
  const t2 = registerSessions.find(session => session.logicalShift === 2);
  if (!t1 || !t2 || registerSessions.length !== 2
    || registerSessions.some(session => session.status !== 'CLOSED')) add('SHIFT_NOT_CLOSED');

  const branchSessionsById = new Map(sessions.map(session => [session.sessionId, session]));
  const paymentIds = new Set<string>();
  for (const payment of payments) {
    if (!payment || payment.authority !== 'SERVER' || !payment.id || paymentIds.has(payment.id)) {
      add('DUPLICATE_PAYMENT', payment?.id || '');
      continue;
    }
    paymentIds.add(payment.id);
    const receiving = payment.receivingSession;
    const receivingSession = receiving ? branchSessionsById.get(receiving.sessionId) : undefined;
    if (!receiving || receiving.authority !== 'SERVER' || !receivingSession
      || payment.receivingSessionId !== receiving.sessionId
      || receiving.tenantId !== scope?.tenantId || receiving.branchId !== scope?.branchId
      || receiving.cashRegisterId !== receivingSession.cashRegisterId
      || receiving.businessDate !== scope?.businessDate
      || receiving.logicalShift !== receivingSession.logicalShift
      || payment.tenantId !== scope?.tenantId || payment.branchId !== scope?.branchId) {
      add('RECEIVING_SESSION_MISSING', payment.id);
      continue;
    }
    if (payment.branchCurrency !== fiscalProfile?.currency) {
      add('PAYMENT_CURRENCY_MISMATCH', payment.id);
      continue;
    }
    if (payment.status === 'PENDING' || payment.status === 'REFUNDED') add('UNRESOLVED_PAYMENT', payment.id);
    else if (payment.status === 'AUTHORIZED' && !isCashShiftV2PaymentCountable(payment)) add('UNVERIFIED_PAYMENT', payment.id);
    else if (!['AUTHORIZED', 'FAILED', 'CANCELLED'].includes(payment.status)) add('UNRESOLVED_PAYMENT', payment.id);
  }

  for (const order of openOrders) {
    if (!order || order.source !== 'SERVER' || order.tenantId !== scope?.tenantId
      || order.branchId !== scope?.branchId || order.businessDate !== scope?.businessDate
      || !branchRegisterSet.has(order.cashRegisterId)) {
      add('INVALID_SCOPE', order?.orderId || '');
    } else add('OPEN_ORDER', order.orderId);
  }
  for (const table of occupiedTables) {
    if (!table || table.authority !== 'SERVER' || table.tenantId !== scope?.tenantId
      || table.branchId !== scope?.branchId || table.businessDate !== scope?.businessDate
      || (table.cashRegisterId !== undefined && !branchRegisterSet.has(table.cashRegisterId))) {
      add('INVALID_SCOPE', table?.tableId || '');
    } else add('OCCUPIED_TABLE', table.tableId);
  }
  for (const id of input.heldOrderIds || []) add('HELD_ORDER', id);
  for (const id of input.unresolvedLegacyEntities || []) add('UNRESOLVED_LEGACY', id);

  const sessionReconciliations: CashShiftV2SessionReconciliation[] = [];
  if (fiscalProfile && t1 && t2) {
    for (const session of [t1, t2]) {
      const reconciliation = reconcileCashShiftV2Session({
        session: sessionReconciliationEvidence(session), fiscalProfile, payments
      });
      if (!reconciliation) add('SESSION_RECONCILIATION_UNAVAILABLE', session.sessionId);
      else sessionReconciliations.push(reconciliation);
    }
  }
  if (blockers.length > 0 || !fiscalProfile || !t1 || !t2 || sessionReconciliations.length !== 2) {
    return { canClose: false, blockers, summary: null };
  }

  let cash = 0n;
  let sinpe = 0n;
  let total = 0n;
  for (const reconciliation of sessionReconciliations) {
    const cashUnits = parseTenderUnits(reconciliation.cashAppliedAmount);
    const sinpeUnits = parseTenderUnits(reconciliation.sinpeAppliedAmount);
    const totalUnits = parseTenderUnits(reconciliation.totalCollectedAmount);
    if (cashUnits === null || sinpeUnits === null || totalUnits === null || cashUnits + sinpeUnits !== totalUnits) {
      add('SESSION_RECONCILIATION_UNAVAILABLE', reconciliation.sessionId);
      return { canClose: false, blockers, summary: null };
    }
    cash += cashUnits;
    sinpe += sinpeUnits;
    total += totalUnits;
  }
  const expectedCash = parseTenderUnits(sessionReconciliations.find(item => item.sessionId === t2.sessionId)!.expectedCashAmount);
  if (expectedCash === null) {
    add('SESSION_RECONCILIATION_UNAVAILABLE', t2.sessionId);
    return { canClose: false, blockers, summary: null };
  }
  return {
    canClose: true,
    blockers: [],
    summary: {
      authority: 'SERVER', scope: { ...scope }, fiscalCurrency: fiscalProfile.currency,
      dailyOpening: { ...input.dailyOpening },
      branchRegisterIds: [...branchRegisterSet].sort(),
      activeRequiredRegisterIds: [...branchRegisterSet].sort(),
      snapshotRegisterIds: [...new Set(input.snapshotRegisterIds)].sort(),
      branchSessionIds: sessions.map(session => session.sessionId).sort(),
      coveredSessionIds: [...new Set(input.snapshotSessionIds)].sort(),
      snapshotSessionIds: [...new Set(input.snapshotSessionIds)].sort(),
      sessionIds: [t1.sessionId, t2.sessionId],
      cashAppliedAmount: formatTenderUnits(cash, fiscalProfile.currency),
      sinpeAppliedAmount: formatTenderUnits(sinpe, fiscalProfile.currency),
      totalCollectedAmount: formatTenderUnits(total, fiscalProfile.currency),
      expectedCashAmount: formatTenderUnits(expectedCash, fiscalProfile.currency),
      countablePaymentIds: sessionReconciliations.flatMap(item => item.countablePaymentIds),
      sessionReconciliations
    }
  };
}
