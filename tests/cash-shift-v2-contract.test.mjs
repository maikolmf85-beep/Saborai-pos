import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASH_SHIFT_V2_ENABLED,
  calculateCashShiftV2OrderFinancials,
  calculateCashShiftV2PaymentAllocation,
  canCloseCashShiftV2DailyOpening,
  createCashShiftV2FiscalInvoiceProjection,
  createCashShiftV2OpenOrderSnapshot,
  deriveCashShiftV2SecondShiftOpeningFloat,
  evaluateCashShiftV2Close,
  evaluateCashShiftV2OfflineLinePrice,
  evaluateCashShiftV2SecondShiftOpening,
  handoffCashShiftV2OpenOrderToSecondShift,
  isValidCashShiftV2CaptureCashCommand,
  isValidCashShiftV2CaptureSinpeCommand,
  isValidCashShiftV2OpenShiftCommand,
  isValidCashShiftV2OrderSyncCommand,
  isValidCashShiftV2OrderTransferCommand,
  isCashShiftV2PaymentCountable,
  isCashShiftV2PaymentMethod,
  reconcileCashShiftV2Session,
  isValidCashShiftV2LegacyDisposition,
  isValidCashShiftV2MissingItemResolution,
  isValidCashShiftV2PriceResolution,
  isValidCashShiftV2ServerOrderFinancials,
  isValidCashShiftV2ServerTotals,
  isValidCashShiftV2SessionSet,
  validateCashShiftV2WaiterAssignment
} from '../src/services/cashShiftV2Contract.ts';

const scope = {
  tenantId: 'tenant-test',
  branchId: 'branch-test',
  cashRegisterId: 'register-a',
  businessDate: '2026-11-18'
};
const fiscalProfile = {
  authority: 'SERVER',
  tenantId: scope.tenantId,
  branchId: scope.branchId,
  taxRegime: 'IVA_13',
  currency: 'CRC',
  priceBasis: 'EXCLUSIVE_OF_VAT'
};
const request = {
  idempotencyKey: 'request-test-1',
  requestSha256: 'a'.repeat(64)
};

function line(overrides = {}) {
  return {
    lineId: 'line-1',
    menuItemId: 'menu-1',
    itemName: 'Café',
    quantity: '1.000',
    unitPrice: '100.00000',
    taxRate: '0.1300',
    ...overrides
  };
}

function toUnits(amount) {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 100_000n + BigInt(fraction.padEnd(5, '0'));
}

function fromUnits(value) {
  return `${value / 100_000n}.${(value % 100_000n).toString().padStart(5, '0')}`;
}

function makeServerFinancials(lines = [line()], paid = '0.00000', profile = fiscalProfile) {
  const financials = calculateCashShiftV2OrderFinancials(profile, lines);
  const balance = fromUnits(toUnits(financials.total) - toUnits(paid));
  return {
    authority: 'SERVER',
    branchFiscalProfile: profile,
    financials,
    authorizedPaidAmount: paid,
    balanceAmount: balance
  };
}

function makeSnapshotOrder(overrides = {}) {
  const financials = makeServerFinancials([line()], '30.00000');
  return createCashShiftV2OpenOrderSnapshot({
    ...scope,
    orderId: 'order-1',
    tableId: 'table-4',
    tableName: 'Mesa 4',
    originSessionId: 'session-a-t1',
    servingSessionId: 'session-a-t1',
    waiter: { employeeId: 'waiter-8', name: 'Salón uno' },
    serverFinancials: financials,
    capturedAt: '2026-11-18T23:40:00-06:00',
    ...overrides
  });
}

function makeSession({
  register = 'register-a',
  id = `${register}-t1`,
  shift = 1,
  status = 'CLOSED',
  openedAt = '2026-11-18T10:00:00-06:00',
  closedAt = '2026-11-18T17:00:00-06:00',
  openingFloat = '100.00000',
  countedCash = '825.00000'
} = {}) {
  return {
    ...scope,
    cashRegisterId: register,
    sessionId: id,
    posCashShiftId: `legacy-${id}`,
    logicalShift: shift,
    status,
    openedAt,
    ...(status === 'CLOSED' ? { closedAt, countedCash } : {}),
    openingFloat
  };
}

function makeBranchSnapshot(shifts, overrides = {}) {
  return {
    authority: 'SERVER',
    scope: { ...scope },
    sessionCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE',
    ledgerCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE',
    branchRegisterIds: [...new Set(shifts.map(session => session.cashRegisterId))],
    fiscalProfile,
    shifts,
    openOrders: [],
    payments: [],
    occupiedTablesWithoutOrder: [],
    unresolvedLegacyEntities: [],
    heldOrderIds: [],
    dailyOpening: {
      businessDate: scope.businessDate,
      openedAt: '2026-11-18T08:00:00-06:00',
      openedByActorId: 'cashier-1'
    },
    ...overrides
  };
}

function makeCloseSnapshotEvidence(shiftNumber, openingFloat = '100.00000') {
  return {
    authority: 'SERVER',
    scope: { ...scope },
    coverage: shiftNumber === 1 ? 'REGISTER' : 'COMPLETE_BRANCH_BUSINESS_DATE',
    session: {
      authority: 'SERVER', ...scope,
      sessionId: `session-a-t${shiftNumber}`, logicalShift: shiftNumber, openingFloat
    }
  };
}

function makePayment({
  method = 'CASH',
  sourceAmount = '50.00000',
  sourceCurrency = 'CRC',
  targetCurrency = 'CRC',
  receivingSessionId = 'session-a-t2',
  receivingLogicalShift = 2,
  receivingScope = scope,
  fxRate = '1.00000',
  convertedAmount = sourceAmount,
  appliedAmount = sourceAmount,
  changeAmount = '0.00000',
  status = 'AUTHORIZED',
  overrides = {}
} = {}) {
  const record = {
    authority: 'SERVER',
    id: `payment-${method.toLowerCase()}`,
    request,
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    orderId: 'order-1',
    receivingSessionId,
    receivingSession: {
      authority: 'SERVER', ...receivingScope, sessionId: receivingSessionId, logicalShift: receivingLogicalShift
    },
    method,
    status,
    sourceAmount,
    sourceCurrency,
    branchCurrency: targetCurrency,
    targetCurrency,
    fxRate,
    convertedAmount,
    appliedAmount,
    changeAmount,
    authorizedAt: '2026-11-18T23:50:00-06:00',
    ...overrides
  };
  if (method === 'CASH' && status === 'AUTHORIZED' && !('cashConfirmation' in record)) {
    record.cashConfirmation = {
      authority: 'SERVER',
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      actorId: 'cashier-1',
      actorRole: 'CAJERO',
      activeBranchMembership: true,
      canConfirmCash: true,
      sessionActorId: 'cashier-1',
      sessionRole: 'CAJERO',
      confirmedAt: '2026-11-18T23:49:00-06:00'
    };
  }
  return record;
}

const actor = {
  authority: 'SERVER',
  tenantId: scope.tenantId,
  branchId: scope.branchId,
  userId: 'user-admin',
  employeeId: 'employee-admin',
  role: 'ADMIN',
  activeBranchMembership: true
};

test('V2 sigue apagado; el contrato no conecta rutas, UI ni adapters', () => {
  assert.equal(CASH_SHIFT_V2_ENABLED, false);
});

test('DTOs de comandos exigen scope, idempotencia y confirmación explícita sin aceptar actor del cliente', () => {
  assert.equal(isValidCashShiftV2OpenShiftCommand({
    scope, logicalShift: 1, openingFloat: '0.00000', request
  }), true);
  assert.equal(isValidCashShiftV2OpenShiftCommand({
    scope, logicalShift: 3, openingFloat: '0.00000', request
  }), false);
  const syncCommand = {
    scope, sessionId: 'session-a-t1', tableId: 'table-7', tableName: 'Mesa 7',
    waiterEmployeeId: 'waiter-1', lines: [line()], request
  };
  assert.equal(isValidCashShiftV2OrderSyncCommand(syncCommand), true);
  assert.equal(isValidCashShiftV2OrderSyncCommand({ ...syncCommand, currentWaiterPin: ' 0012 ' }), false);
  assert.equal(isValidCashShiftV2OrderSyncCommand({ ...syncCommand, currentWaiterPin: '' }), false);
  assert.equal(isValidCashShiftV2OrderSyncCommand({ ...syncCommand, lines: [line(), line()] }), false);
  const transferCommand = {
    scope, sessionId: 'session-a-t1', sourceOrderId: 'order-1', targetSalonId: 'salon-2',
    targetTableId: 'table-9', lineIdsInDisplayOrder: ['line-2', 'line-1'], request
  };
  assert.equal(isValidCashShiftV2OrderTransferCommand(transferCommand), true);
  assert.equal(isValidCashShiftV2OrderTransferCommand({
    ...transferCommand, lineIdsInDisplayOrder: ['line-1', 'line-1']
  }), false);
  const cashCommand = {
    scope, orderId: 'order-1', receivingSessionId: 'session-a-t1', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', explicitCashConfirmation: true,
    fx: { sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.00000', explicitConfirmation: true }, request
  };
  assert.equal(isValidCashShiftV2CaptureCashCommand(cashCommand), true);
  assert.equal(isValidCashShiftV2CaptureCashCommand({ ...cashCommand, fx: undefined }), false);
  assert.equal(isValidCashShiftV2CaptureCashCommand({ ...cashCommand, fx: { ...cashCommand.fx, rate: '0.00000' } }), false);
  assert.equal(isValidCashShiftV2CaptureCashCommand({ ...cashCommand, fx: { ...cashCommand.fx, targetCurrency: 'USD' } }), false);
  assert.equal(isValidCashShiftV2CaptureCashCommand({
    ...cashCommand, sourceCurrency: 'CRC', fx: undefined
  }), true);
  assert.equal(isValidCashShiftV2CaptureCashCommand({
    ...cashCommand, sourceCurrency: 'CRC', fx: cashCommand.fx
  }), false);
  assert.equal(isValidCashShiftV2CaptureCashCommand({ ...cashCommand, explicitCashConfirmation: false }), false);
  assert.equal(isValidCashShiftV2CaptureSinpeCommand({
    scope, orderId: 'order-1', receivingSessionId: 'session-a-t1', amount: '20.00000',
    currency: 'CRC', branchCurrency: 'CRC', externalReference: 'SINPE-TEST', explicitEvidenceConfirmation: true, request
  }), true);
  assert.equal(isValidCashShiftV2CaptureSinpeCommand({
    scope, orderId: 'order-1', receivingSessionId: 'session-a-t1', amount: '20.00000',
    currency: 'CRC', branchCurrency: 'CRC', externalReference: ' ', explicitEvidenceConfirmation: true, request
  }), false);
});

test('calcula IVA por línea, servicio sobre subtotal pre-IVA y total fiscal sin redondeo de moneda', () => {
  const totals = calculateCashShiftV2OrderFinancials(fiscalProfile, [
    line({ lineId: 'line-13', unitPrice: '100.00000', taxRate: '0.1300' }),
    line({ lineId: 'line-4', menuItemId: 'menu-2', quantity: '2.000', unitPrice: '10.00000', taxRate: '0.0400' })
  ]);
  assert.equal(totals.subtotal, '120.00000');
  assert.equal(totals.vatTotal, '13.80000');
  assert.equal(totals.serviceAmount, '12.00000');
  assert.equal(totals.total, '145.80000');
  assert.deepEqual(totals.taxBreakdown, [
    { taxRate: '0.0400', taxableSubtotal: '20.00000', vatAmount: '0.80000' },
    { taxRate: '0.1300', taxableSubtotal: '100.00000', vatAmount: '13.00000' }
  ]);
  assert.equal(totals.lines[0].lineTotal, '113.00000');
  assert.equal(totals.lines[1].lineTotal, '20.80000');
});

test('la aritmética decimal de cinco lugares es exacta y usa half-up en líneas, IVA y servicio', () => {
  const totals = calculateCashShiftV2OrderFinancials(fiscalProfile, [
    line({ quantity: '1.100', unitPrice: '0.00005' })
  ]);
  assert.equal(totals.subtotal, '0.00006');
  assert.equal(totals.vatTotal, '0.00001');
  assert.equal(totals.serviceAmount, '0.00001');
  assert.equal(totals.total, '0.00008');
});

test('perfil ausente bloquea y la tasa de cada artículo debe estar permitida por el perfil explícito', () => {
  assert.throws(() => calculateCashShiftV2OrderFinancials(null, [line()]), /perfil fiscal explícito/);
  const zeroProfile = { ...fiscalProfile, taxRegime: 'IVA_0' };
  assert.equal(calculateCashShiftV2OrderFinancials(zeroProfile, [line({ taxRate: '0.0000' })]).vatTotal, '0.00000');
  assert.throws(() => calculateCashShiftV2OrderFinancials(zeroProfile, [line()]), /no está permitida/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ taxRate: '0.0500' })]), /tasa de IVA/);
  assert.throws(() => calculateCashShiftV2OrderFinancials({ ...fiscalProfile, authority: 'CLIENT' }, [line()]), /perfil fiscal explícito/);
});

test('rechaza floats, notación exponencial, escalas excesivas y desbordamiento de numeric(18,5)', () => {
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ unitPrice: 100 } )]), /Cantidad, precio/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ unitPrice: '1e2' })]), /Cantidad, precio/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ unitPrice: '1.000001' })]), /Cantidad, precio/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ unitPrice: '10000000000000' })]), /Cantidad, precio/);
});

test('precio discrepante o item sin ID retiene la línea; el snapshot no calcula órdenes retenidas', () => {
  assert.deepEqual(evaluateCashShiftV2OfflineLinePrice({
    lineId: 'offline-1', menuItemId: 'menu-1', offlineUnitPrice: '90.00000', currentCatalogUnitPrice: '100.00000'
  }), { state: 'HELD', reason: 'PRICE_MISMATCH', lineId: 'offline-1' });
  assert.deepEqual(evaluateCashShiftV2OfflineLinePrice({
    lineId: 'offline-2', menuItemId: null, offlineUnitPrice: '100.00000'
  }), { state: 'HELD', reason: 'MISSING_ITEM', lineId: 'offline-2' });
  assert.deepEqual(evaluateCashShiftV2OfflineLinePrice({
    lineId: 'offline-3', menuItemId: 'menu-1', offlineUnitPrice: '100', currentCatalogUnitPrice: '100.00000'
  }), { state: 'ACCEPTED', lineId: 'offline-3', authoritativeUnitPrice: '100.00000' });
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ resolutionState: 'PRICE_REVIEW' })]), /queda retenida/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ menuItemId: null })]), /queda retenida/);
  assert.throws(() => calculateCashShiftV2OrderFinancials(fiscalProfile, [line({ resolutionState: 'VOIDED' })]), /requiere motivo/);
});

test('perfil, cálculo y proyección fiscal server preservan literalmente el mismo total', () => {
  const server = makeServerFinancials();
  assert.equal(isValidCashShiftV2ServerOrderFinancials(server), true);
  assert.equal(isValidCashShiftV2ServerTotals(fiscalProfile, [line()], server), true);
  assert.equal(isValidCashShiftV2ServerTotals(fiscalProfile, [line({ unitPrice: '99.00000' })], server), false);
  const changedServer = { ...server, balanceAmount: '122.99999' };
  assert.equal(isValidCashShiftV2ServerOrderFinancials(changedServer), false);
  const projection = createCashShiftV2FiscalInvoiceProjection(server);
  assert.equal(projection.totalComprobante, server.financials.total);
  assert.equal(projection.totalComprobante, '123.00000');
  assert.equal(projection.lines[0].lineTotal, server.financials.lines[0].lineTotal);
  assert.throws(() => createCashShiftV2FiscalInvoiceProjection(changedServer), /totales fiscales autoritativos/);
});

test('el snapshot conserva origen y sesión de atención, y el handoff T1→T2 solo cambia la atención', () => {
  const order = makeSnapshotOrder();
  assert.equal(order.originSessionId, 'session-a-t1');
  assert.equal(order.servingSessionId, 'session-a-t1');
  assert.equal(order.totals.total, '123.00000');
  assert.equal(order.authorizedPaidAmount, '30.00000');
  assert.equal(order.balanceAmount, '93.00000');
  const source = makeSession({ id: 'session-a-t1', shift: 1, status: 'CLOSED' });
  const target = makeSession({ id: 'session-a-t2', shift: 2, status: 'OPEN', closedAt: undefined, countedCash: undefined,
    openedAt: '2026-11-18T17:00:01-06:00', openingFloat: '825.00000' });
  const handedOff = handoffCashShiftV2OpenOrderToSecondShift(order, source, target);
  assert.equal(handedOff.originSessionId, 'session-a-t1');
  assert.equal(handedOff.servingSessionId, 'session-a-t2');
  assert.equal(order.servingSessionId, 'session-a-t1');
  const otherRegisterTarget = { ...target, sessionId: 'session-b-t2', cashRegisterId: 'register-b' };
  const movedToOtherRegister = handoffCashShiftV2OpenOrderToSecondShift(order, source, otherRegisterTarget);
  assert.equal(movedToOtherRegister.originSessionId, 'session-a-t1');
  assert.equal(movedToOtherRegister.servingSessionId, 'session-b-t2');
  assert.throws(() => handoffCashShiftV2OpenOrderToSecondShift(order, target, source), /traspaso requiere/);
});

test('turno 1 preserva órdenes abiertas; turno 2 bloquea órdenes, mesas, retenciones y legacy pendiente', () => {
  const order = makeSnapshotOrder();
  const turn1 = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [], openOrders: [order], occupiedTablesWithoutOrder: [],
    fiscalProfile, heldOrderIds: [], unresolvedLegacyEntities: []
  });
  assert.equal(turn1.canClose, true);
  assert.deepEqual(turn1.preservedOpenOrders, [order]);
  assert.equal(turn1.sessionReconciliation.totalCollectedAmount, '0');
  assert.equal(turn1.sessionReconciliation.expectedCashAmount, '100');
  const turn2 = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [order],
    occupiedTablesWithoutOrder: [{
      authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
      businessDate: scope.businessDate, tableId: 'table-7'
    }],
    fiscalProfile, heldOrderIds: ['order-held'], unresolvedLegacyEntities: ['legacy-payment']
  });
  assert.equal(turn2.canClose, false);
  assert.deepEqual(turn2.blockers.map(item => item.code), [
    'HELD_ORDER', 'UNRESOLVED_LEGACY_ENTITY', 'OPEN_ORDER', 'OCCUPIED_TABLE_WITHOUT_ORDER'
  ]);
  const noProfile = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [], openOrders: [], occupiedTablesWithoutOrder: [], fiscalProfile: null
  });
  assert.equal(noProfile.canClose, false);
  assert.equal(noProfile.blockers[0].code, 'FISCAL_PROFILE_MISSING');
  const mismatchedProfile = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [], openOrders: [], occupiedTablesWithoutOrder: [],
    fiscalProfile: { ...fiscalProfile, branchId: 'another-branch' }
  });
  assert.equal(mismatchedProfile.canClose, false);
  assert.deepEqual(mismatchedProfile.blockers.map(item => item.code), ['FISCAL_PROFILE_MISSING']);
});

test('el cierre falla cerrado ante pagos, órdenes o mesas fuera de tenant/sucursal/fecha/caja', () => {
  const closeT1 = overrides => evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [], openOrders: [],
    occupiedTablesWithoutOrder: [], fiscalProfile, ...overrides
  });
  const foreignPaymentScopes = [
    { ...scope, tenantId: 'tenant-other' },
    { ...scope, branchId: 'branch-other' },
    { ...scope, businessDate: '2026-11-19' },
    { ...scope, cashRegisterId: 'register-b' }
  ];
  for (const foreignScope of foreignPaymentScopes) {
    const payment = makePayment({
      receivingSessionId: 'session-a-t1', receivingLogicalShift: 1, receivingScope: foreignScope,
      overrides: { tenantId: foreignScope.tenantId, branchId: foreignScope.branchId }
    });
    const decision = closeT1({ payments: [payment] });
    assert.equal(decision.canClose, false);
    assert.deepEqual(decision.countablePaymentIds, []);
    assert.deepEqual(decision.blockers, [{ code: 'PAYMENT_OUT_OF_SCOPE', entityId: payment.id }]);
  }
  const wrongReceivingSession = makePayment();
  const sessionMismatch = closeT1({ payments: [wrongReceivingSession] });
  assert.deepEqual(sessionMismatch.blockers, [
    { code: 'PAYMENT_OUT_OF_SCOPE', entityId: wrongReceivingSession.id }
  ]);

  const orderScopes = [
    { ...scope, tenantId: 'tenant-other' },
    { ...scope, branchId: 'branch-other' },
    { ...scope, businessDate: '2026-11-19' },
    { ...scope, cashRegisterId: 'register-b' }
  ];
  for (const orderScope of orderScopes) {
    const order = { ...makeSnapshotOrder(), ...orderScope };
    const decision = closeT1({ openOrders: [order] });
    assert.equal(decision.canClose, false);
    assert.deepEqual(decision.blockers, [{ code: 'OPEN_ORDER_OUT_OF_SCOPE', entityId: order.orderId }]);
    assert.deepEqual(decision.preservedOpenOrders, []);
  }

  for (const tableScope of [
    { tenantId: 'tenant-other', branchId: scope.branchId, businessDate: scope.businessDate },
    { tenantId: scope.tenantId, branchId: 'branch-other', businessDate: scope.businessDate },
    { tenantId: scope.tenantId, branchId: scope.branchId, businessDate: '2026-11-19' }
  ]) {
    const decision = evaluateCashShiftV2Close({
      scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
      payments: [], openOrders: [],
      occupiedTablesWithoutOrder: [{ authority: 'SERVER', ...tableScope, tableId: 'table-foreign' }],
      fiscalProfile
    });
    assert.equal(decision.canClose, false);
    assert.deepEqual(decision.blockers, [{ code: 'TABLE_OUT_OF_SCOPE', entityId: 'table-foreign' }]);
  }

  const otherRegisterOrder = { ...makeSnapshotOrder(), cashRegisterId: 'register-b' };
  const otherRegisterOrderClose = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [otherRegisterOrder], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.deepEqual(otherRegisterOrderClose.blockers, [{ code: 'OPEN_ORDER', entityId: otherRegisterOrder.orderId }]);

  const otherRegisterTableClose = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [], occupiedTablesWithoutOrder: [{
      authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
      businessDate: scope.businessDate, tableId: 'table-other-register', cashRegisterId: 'register-b'
    }], fiscalProfile
  });
  assert.deepEqual(otherRegisterTableClose.blockers, [
    { code: 'OCCUPIED_TABLE_WITHOUT_ORDER', entityId: 'table-other-register' }
  ]);

  const otherBranchOrder = { ...makeSnapshotOrder(), branchId: 'branch-other' };
  const otherBranchOrderClose = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [otherBranchOrder], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.deepEqual(otherBranchOrderClose.blockers, [
    { code: 'OPEN_ORDER_OUT_OF_SCOPE', entityId: otherBranchOrder.orderId }
  ]);

  const incompleteT2 = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2,
    snapshotEvidence: { ...makeCloseSnapshotEvidence(2), coverage: 'REGISTER' },
    payments: [], openOrders: [], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.deepEqual(incompleteT2.blockers, [{ code: 'INCOMPLETE_CLOSE_SNAPSHOT', entityId: 'session-a-t2' }]);
  const incompleteT1 = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1,
    snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [makeSnapshotOrder()], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.deepEqual(incompleteT1.blockers, [{ code: 'INCOMPLETE_CLOSE_SNAPSHOT', entityId: 'session-a-t1' }]);
  assert.deepEqual(incompleteT1.preservedOpenOrders, []);
});

test('el cierre rechaza un pago countable cuya moneda de sucursal contradice el perfil fiscal', () => {
  const usdPayment = makePayment({
    sourceAmount: '50.00', sourceCurrency: 'USD', targetCurrency: 'USD',
    receivingSessionId: 'session-a-t1', receivingLogicalShift: 1
  });
  assert.equal(isCashShiftV2PaymentCountable(usdPayment), true);
  const close = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [usdPayment], openOrders: [], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.equal(close.canClose, false);
  assert.equal(close.sessionReconciliation, null);
  assert.deepEqual(close.countablePaymentIds, []);
  assert.deepEqual(close.blockers, [{ code: 'PAYMENT_CURRENCY_MISMATCH', entityId: usdPayment.id }]);
});

test('el cierre falla cerrado si el fondo inicial impide calcular conciliación exacta', () => {
  const close = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1,
    snapshotEvidence: makeCloseSnapshotEvidence(1, '100.50000'),
    payments: [], openOrders: [], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.equal(close.canClose, false);
  assert.equal(close.sessionReconciliation, null);
  assert.deepEqual(close.blockers, [
    { code: 'SESSION_RECONCILIATION_UNAVAILABLE', entityId: 'session-a-t1' }
  ]);
});

test('T2 solo abre con snapshot completo, perfil fiscal y todas las sesiones T1 de sucursal cerradas', () => {
  const firstA = makeSession({ register: 'register-a', id: 'a-t1' });
  const firstBOpen = makeSession({ register: 'register-b', id: 'b-t1', status: 'OPEN', closedAt: undefined, countedCash: undefined });
  const branchBlocked = makeBranchSnapshot([firstA, firstBOpen]);
  const blocked = evaluateCashShiftV2SecondShiftOpening(branchBlocked, 'register-a');
  assert.equal(blocked.eligible, false);
  assert.deepEqual(blocked.blockers.map(item => item.code), ['BRANCH_FIRST_SHIFT_NOT_CLOSED']);

  const firstB = makeSession({ register: 'register-b', id: 'b-t1', closedAt: '2026-11-18T17:30:00-06:00', countedCash: '40.00000' });
  const ready = makeBranchSnapshot([firstA, firstB]);
  assert.equal(evaluateCashShiftV2SecondShiftOpening(ready, 'register-a').eligible, true);
  assert.equal(deriveCashShiftV2SecondShiftOpeningFloat(ready, 'register-a'), '825.00000');
  assert.equal(evaluateCashShiftV2SecondShiftOpening({ ...ready, fiscalProfile: null }, 'register-a').blockers[0].code,
    'FISCAL_PROFILE_MISSING');
  assert.equal(evaluateCashShiftV2SecondShiftOpening({ ...ready, unresolvedLegacyEntities: ['legacy-order'] }, 'register-a')
    .blockers[0].code, 'UNRESOLVED_LEGACY_ENTITY');
  assert.equal(evaluateCashShiftV2SecondShiftOpening({ ...ready, heldOrderIds: ['held-order'] }, 'register-a')
    .blockers[0].code, 'HELD_ORDER');
  assert.throws(() => deriveCashShiftV2SecondShiftOpeningFloat({ ...ready, sessionCoverage: 'PARTIAL' }, 'register-a'), /snapshot completo/);
});

test('snapshot T1→T2 exige roster de todas las cajas, pagos atribuibles, handoff de cuentas y cero mesas huérfanas', () => {
  const firstA = makeSession({ register: 'register-a', id: 'a-t1' });
  const firstB = makeSession({ register: 'register-b', id: 'b-t1', countedCash: '40.00000' });
  const base = makeBranchSnapshot([firstA, firstB]);

  const missingRegister = evaluateCashShiftV2SecondShiftOpening({
    ...base, branchRegisterIds: ['register-a', 'register-b', 'register-c']
  }, 'register-a');
  assert.equal(missingRegister.eligible, false);
  assert.ok(missingRegister.blockers.some(item => item.code === 'INCOMPLETE_BRANCH_REGISTER_ROSTER'));

  const order = makeSnapshotOrder({ originSessionId: 'a-t1', servingSessionId: 'a-t1' });
  const payment = makePayment({ sourceAmount: '30.00000', convertedAmount: '30.00000', appliedAmount: '30.00000',
    receivingSessionId: 'a-t1', receivingLogicalShift: 1 });
  const handoff = evaluateCashShiftV2SecondShiftOpening({
    ...base, openOrders: [order], payments: [payment]
  }, 'register-a');
  assert.equal(handoff.eligible, true);
  assert.equal(handoff.openOrderHandoffs.length, 1);
  assert.equal(handoff.openOrderHandoffs[0].originSessionId, 'a-t1');
  assert.equal(handoff.openOrderHandoffs[0].servingSessionId, 'a-t1');

  const orphan = evaluateCashShiftV2SecondShiftOpening({
    ...base,
    occupiedTablesWithoutOrder: [{ authority: 'SERVER', tenantId: scope.tenantId,
      branchId: scope.branchId, businessDate: scope.businessDate, tableId: 'orphan-table' }]
  }, 'register-a');
  assert.equal(orphan.eligible, false);
  assert.ok(orphan.blockers.some(item => item.code === 'ORPHAN_OCCUPIED_TABLE'));

  const unverifiedPayment = evaluateCashShiftV2SecondShiftOpening({
    ...base,
    payments: [makePayment({ receivingSessionId: 'missing-session', receivingLogicalShift: 1 })]
  }, 'register-a');
  assert.equal(unverifiedPayment.eligible, false);
  assert.ok(unverifiedPayment.blockers.some(item => item.code === 'INVALID_CUTOVER_PAYMENT'));
});

test('sesiones tienen unicidad T1/T2 por caja, continuidad del efectivo y barrera de sucursal', () => {
  const day = { tenantId: scope.tenantId, branchId: scope.branchId, businessDate: scope.businessDate };
  const first = makeSession({ id: 'register-a-t1' });
  const second = makeSession({
    id: 'register-a-t2', shift: 2, status: 'OPEN', closedAt: undefined, countedCash: undefined,
    openedAt: '2026-11-18T17:00:01-06:00', openingFloat: '825.00000'
  });
  const otherFirst = makeSession({ register: 'register-b', id: 'register-b-t1', openingFloat: '5.00000', countedCash: '4.00000' });
  assert.equal(isValidCashShiftV2SessionSet(day, [first, second, otherFirst]), true);
  assert.equal(isValidCashShiftV2SessionSet(day, [first, second, { ...second, sessionId: 'duplicate-t2' }]), false);
  assert.equal(isValidCashShiftV2SessionSet(day, [second]), false);
  assert.equal(isValidCashShiftV2SessionSet(day, [first, { ...second, openingFloat: '1.00000' }]), false);
  assert.equal(isValidCashShiftV2SessionSet(day, [first, second, {
    ...otherFirst, status: 'OPEN', closedAt: undefined, countedCash: undefined
  }]), false);
});

test('monto CASH fuente se convierte con tasa confirmada por CAJERO; excedente es vuelto en moneda destino', () => {
  const fxConfirmation = {
    authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
    employeeId: 'cashier-1', role: 'CAJERO', actorId: 'cashier-1', sessionActorId: 'cashier-1', sessionRole: 'CAJERO', activeBranchMembership: true,
    sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.12500',
    confirmedAt: '2026-11-18T23:45:00-06:00'
  };
  const allocation = calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000', fxConfirmation
  });
  assert.deepEqual(allocation, {
    sourceAmount: '20.00', sourceCurrency: 'USD', targetCurrency: 'CRC', fxRate: '500.12500',
    convertedAmount: '10003', appliedAmount: '9000', changeAmount: '1003'
  });
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000'
  }), /tasa confirmada por CAJERO/);
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000',
    fxConfirmation: { ...fxConfirmation, role: 'ADMIN' }
  }), /tasa confirmada por CAJERO/);
});

test('CASH en moneda de sucursal devuelve vuelto; SINPE no automatiza ni permite vuelto', () => {
  assert.deepEqual(calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '150.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '100.00000'
  }), {
    sourceAmount: '150', sourceCurrency: 'CRC', targetCurrency: 'CRC', fxRate: '1.00000',
    convertedAmount: '150', appliedAmount: '100', changeAmount: '50'
  });
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'SINPE', sourceAmount: '150.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '100.00000'
  }), /SINPE no admite vuelto/);
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '0.01000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '100.00000',
    fxConfirmation: {
      authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
      employeeId: 'cashier-1', role: 'CAJERO', actorId: 'cashier-1', sessionActorId: 'cashier-1', sessionRole: 'CAJERO', activeBranchMembership: true,
      sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '0.00001',
      confirmedAt: '2026-11-18T23:45:00-06:00'
    }
  }), /cero/);
  assert.deepEqual(calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'SINPE', sourceAmount: '25.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '100.00000'
  }), {
    sourceAmount: '25', sourceCurrency: 'CRC', targetCurrency: 'CRC', fxRate: '1.00000',
    convertedAmount: '25', appliedAmount: '25', changeAmount: '0'
  });
});

test('pagos respetan CRC entero y USD centavos al recibir, convertir, aplicar y devolver vuelto', () => {
  const usdToCrc = {
    authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
    employeeId: 'cashier-1', role: 'CAJERO', actorId: 'cashier-1', sessionActorId: 'cashier-1', sessionRole: 'CAJERO', activeBranchMembership: true,
    sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.12500',
    confirmedAt: '2026-11-18T23:45:00-06:00'
  };
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '10.50000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '20.00000'
  }), /unidad mínima/);
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '10.00100',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '20000.00000',
    fxConfirmation: usdToCrc
  }), /unidad mínima/);
  assert.deepEqual(calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.01000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '20000.00000', fxConfirmation: usdToCrc
  }), {
    sourceAmount: '20.01', sourceCurrency: 'USD', targetCurrency: 'CRC', fxRate: '500.12500',
    convertedAmount: '10008', appliedAmount: '10008', changeAmount: '0'
  });

  const crcToUsd = {
    ...usdToCrc, sourceCurrency: 'CRC', targetCurrency: 'USD', rate: '0.00300'
  };
  assert.deepEqual(calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '3000.00000',
    sourceCurrency: 'CRC', branchCurrency: 'USD', remainingBalance: '7.50000', fxConfirmation: crcToUsd
  }), {
    sourceAmount: '3000', sourceCurrency: 'CRC', targetCurrency: 'USD', fxRate: '0.00300',
    convertedAmount: '9.00', appliedAmount: '7.50', changeAmount: '1.50'
  });
});

test('un pago CRC no condona fracción fiscal; el saldo residual mantiene la orden abierta y bloquea cierre T2', () => {
  const beforePayment = makeServerFinancials([line()], '22.99500');
  assert.equal(beforePayment.balanceAmount, '100.00500');
  const allocation = calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '101.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: beforePayment.balanceAmount
  });
  assert.equal(allocation.convertedAmount, '101');
  assert.equal(allocation.appliedAmount, '100');
  assert.equal(allocation.changeAmount, '1');
  assert.equal(fromUnits(toUnits(beforePayment.balanceAmount) - toUnits(allocation.appliedAmount)), '0.00500');

  const afterPayment = makeServerFinancials([line()], '122.99500');
  assert.equal(afterPayment.balanceAmount, '0.00500');
  const residualOrder = createCashShiftV2OpenOrderSnapshot({
    ...scope, orderId: 'order-residual', tableId: 'table-residual', tableName: 'Mesa residual',
    originSessionId: 'session-a-t1', servingSessionId: 'session-a-t2',
    waiter: { employeeId: 'waiter-8', name: 'Salón uno' }, serverFinancials: afterPayment,
    capturedAt: '2026-11-18T23:55:00-06:00'
  });
  assert.equal(residualOrder.balanceAmount, '0.00500');
  const close = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t2', shiftNumber: 2, snapshotEvidence: makeCloseSnapshotEvidence(2),
    payments: [], openOrders: [residualOrder], occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.equal(close.canClose, false);
  assert.deepEqual(close.blockers, [{ code: 'OPEN_ORDER', entityId: 'order-residual' }]);
});

test('CARD, MIXED y CREDIT se rechazan; MIXED solo se expresa como renglones separados admitidos', () => {
  for (const method of ['CARD', 'MIXED', 'CREDIT']) {
    assert.equal(isCashShiftV2PaymentMethod(method), false);
    assert.throws(() => calculateCashShiftV2PaymentAllocation({
      tenantId: scope.tenantId, branchId: scope.branchId, method, sourceAmount: '1.00000',
      sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '10.00000'
    }), /solo admite líneas CASH o SINPE/);
  }
  assert.equal(isCashShiftV2PaymentMethod('CASH'), true);
  assert.equal(isCashShiftV2PaymentMethod('SINPE'), true);
  const splitMethods = ['CASH', 'SINPE'].map(method => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method, sourceAmount: '1.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '10.00000'
  }));
  assert.equal(splitMethods.length, 2);
});

test('solo cuenta CASH con confirmación de actor autenticado y sesión coincidente', () => {
  const allocation = calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '50.00000',
    sourceCurrency: 'CRC', branchCurrency: 'CRC', remainingBalance: '100.00000'
  });
  const valid = makePayment({ ...allocation });
  assert.equal(isCashShiftV2PaymentCountable(valid), true);
  assert.equal(isCashShiftV2PaymentCountable({
    ...valid,
    cashConfirmation: { ...valid.cashConfirmation, sessionActorId: 'somebody-else' }
  }), false);
  assert.equal(isCashShiftV2PaymentCountable({
    ...valid,
    cashConfirmation: { ...valid.cashConfirmation, canConfirmCash: false }
  }), false);
  assert.equal(isCashShiftV2PaymentCountable({ ...valid, branchCurrency: 'USD' }), false);
  assert.equal(isCashShiftV2PaymentCountable({ ...valid, receivingSession: undefined }), false);
});

test('FX payment conserva monto/moneda fuente, tasa, convertido, aplicado, vuelto y actor cajero', () => {
  const fxConfirmation = {
    authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
    employeeId: 'cashier-1', role: 'CAJERO', actorId: 'cashier-1', sessionActorId: 'cashier-1', sessionRole: 'CAJERO', activeBranchMembership: true,
    sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.12500',
    confirmedAt: '2026-11-18T23:45:00-06:00'
  };
  const allocation = calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000', fxConfirmation
  });
  assert.throws(() => calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000',
    fxConfirmation: { ...fxConfirmation, sessionActorId: 'cashier-other' }
  }), /tasa confirmada por CAJERO/);
  const payment = makePayment({
    ...allocation, sourceCurrency: 'USD', targetCurrency: 'CRC', method: 'CASH',
    overrides: { fxConfirmation }
  });
  assert.equal(isCashShiftV2PaymentCountable(payment), true);
  assert.equal(payment.sourceAmount, '20.00');
  assert.equal(payment.fxRate, '500.12500');
  assert.equal(payment.appliedAmount, '9000');
  assert.equal(payment.changeAmount, '1003');
  assert.equal(isCashShiftV2PaymentCountable({
    ...payment, fxConfirmation: { ...fxConfirmation, sessionActorId: 'cashier-other' }
  }), false);
});

test('la conciliación separa cobros parciales T1/T2 y evita contar pagos de otra sesión dos veces', () => {
  const t1Cash = makePayment({
    sourceAmount: '40.00000', convertedAmount: '40.00000', appliedAmount: '30.00000',
    changeAmount: '10.00000', receivingSessionId: 'session-a-t1', receivingLogicalShift: 1,
    overrides: { id: 'cash-t1' }
  });
  const t1Sinpe = makePayment({
    method: 'SINPE', sourceAmount: '20.00000', convertedAmount: '20.00000', appliedAmount: '20.00000',
    changeAmount: '0.00000', receivingSessionId: 'session-a-t1', receivingLogicalShift: 1,
    overrides: {
      id: 'sinpe-t1',
      sinpeEvidence: {
        authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
        actorId: 'cashier-1', actorRole: 'CAJERO', activeBranchMembership: true,
        externalReference: 'SINPE-T1', recordedAt: '2026-11-18T23:49:00-06:00', appendOnly: true
      }
    }
  });
  const t2Cash = makePayment({
    sourceAmount: '70.00000', convertedAmount: '70.00000', appliedAmount: '70.00000',
    changeAmount: '0.00000', receivingSessionId: 'session-a-t2', receivingLogicalShift: 2,
    overrides: { id: 'cash-t2' }
  });
  const t2Sinpe = makePayment({
    method: 'SINPE', sourceAmount: '10.00000', convertedAmount: '10.00000', appliedAmount: '10.00000',
    changeAmount: '0.00000', receivingSessionId: 'session-a-t2', receivingLogicalShift: 2,
    overrides: {
      id: 'sinpe-t2',
      sinpeEvidence: {
        authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
        actorId: 'cashier-1', actorRole: 'CAJERO', activeBranchMembership: true,
        externalReference: 'SINPE-T2', recordedAt: '2026-11-18T23:49:00-06:00', appendOnly: true
      }
    }
  });
  const payments = [t1Cash, t1Sinpe, t2Cash, t2Sinpe];
  const t1 = reconcileCashShiftV2Session({
    session: { authority: 'SERVER', ...scope, sessionId: 'session-a-t1', logicalShift: 1, openingFloat: '100.00000' },
    fiscalProfile, payments
  });
  const t2 = reconcileCashShiftV2Session({
    session: { authority: 'SERVER', ...scope, sessionId: 'session-a-t2', logicalShift: 2, openingFloat: '130.00000' },
    fiscalProfile, payments
  });
  assert.equal(t1.cashAppliedAmount, '30');
  assert.equal(t1.sinpeAppliedAmount, '20');
  assert.equal(t1.totalCollectedAmount, '50');
  assert.equal(t1.expectedCashAmount, '130');
  assert.deepEqual(t1.countablePaymentIds, ['cash-t1', 'sinpe-t1']);
  assert.equal(t2.cashAppliedAmount, '70');
  assert.equal(t2.sinpeAppliedAmount, '10');
  assert.equal(t2.totalCollectedAmount, '80');
  assert.equal(t2.expectedCashAmount, '200');
  assert.deepEqual(t2.countablePaymentIds, ['cash-t2', 'sinpe-t2']);

  const pendingT2 = makePayment({
    status: 'PENDING', receivingSessionId: 'session-a-t2', receivingLogicalShift: 2,
    overrides: { id: 'pending-t2', authorizedAt: undefined }
  });
  assert.equal(reconcileCashShiftV2Session({
    session: { authority: 'SERVER', ...scope, sessionId: 'session-a-t2', logicalShift: 2, openingFloat: '130.00000' },
    fiscalProfile, payments: [...payments, pendingT2]
  }), null);
  const refundedT2 = makePayment({
    status: 'REFUNDED', receivingSessionId: 'session-a-t2', receivingLogicalShift: 2,
    overrides: { id: 'refunded-t2' }
  });
  assert.equal(reconcileCashShiftV2Session({
    session: { authority: 'SERVER', ...scope, sessionId: 'session-a-t2', logicalShift: 2, openingFloat: '130.00000' },
    fiscalProfile, payments: [refundedT2]
  }), null);
});

test('la conciliación FX informa el aplicado en moneda destino y excluye vuelto del total cobrado', () => {
  const fxConfirmation = {
    authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
    employeeId: 'cashier-1', role: 'CAJERO', actorId: 'cashier-1',
    sessionActorId: 'cashier-1', sessionRole: 'CAJERO', activeBranchMembership: true,
    sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.12500',
    confirmedAt: '2026-11-18T23:45:00-06:00'
  };
  const allocation = calculateCashShiftV2PaymentAllocation({
    tenantId: scope.tenantId, branchId: scope.branchId, method: 'CASH', sourceAmount: '20.00000',
    sourceCurrency: 'USD', branchCurrency: 'CRC', remainingBalance: '9000.00000', fxConfirmation
  });
  const payment = makePayment({
    ...allocation, sourceCurrency: 'USD', targetCurrency: 'CRC', receivingSessionId: 'session-a-t1',
    receivingLogicalShift: 1, overrides: { id: 'fx-t1', fxConfirmation }
  });
  const reconciliation = reconcileCashShiftV2Session({
    session: { authority: 'SERVER', ...scope, sessionId: 'session-a-t1', logicalShift: 1, openingFloat: '100.00000' },
    fiscalProfile, payments: [payment]
  });
  assert.equal(payment.sourceAmount, '20.00');
  assert.equal(payment.convertedAmount, '10003');
  assert.equal(payment.appliedAmount, '9000');
  assert.equal(payment.changeAmount, '1003');
  assert.equal(reconciliation.currency, 'CRC');
  assert.equal(reconciliation.cashAppliedAmount, '9000');
  assert.equal(reconciliation.totalCollectedAmount, '9000');
  assert.equal(reconciliation.expectedCashAmount, '9100');
});

test('SINPE solo cuenta con evidencia manual append-only ADMIN/CAJERO; PENDING bloquea cierre', () => {
  const pending = makePayment({
    method: 'SINPE', status: 'PENDING', receivingSessionId: 'session-a-t1', receivingLogicalShift: 1,
    overrides: { authorizedAt: undefined }
  });
  const noEvidence = makePayment({ method: 'SINPE', overrides: { sinpeEvidence: undefined } });
  assert.equal(isCashShiftV2PaymentCountable(pending), false);
  assert.equal(isCashShiftV2PaymentCountable(noEvidence), false);
  const evidenced = makePayment({ method: 'SINPE', overrides: {
    cashConfirmation: undefined,
    sinpeEvidence: {
      authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
      actorId: 'cashier-1', actorRole: 'CAJERO', activeBranchMembership: true,
      externalReference: 'SINPE-REF-TEST', recordedAt: '2026-11-18T23:49:00-06:00', appendOnly: true
    }
  } });
  assert.equal(isCashShiftV2PaymentCountable(evidenced), true);
  const close = evaluateCashShiftV2Close({
    scope, sessionId: 'session-a-t1', shiftNumber: 1, snapshotEvidence: makeCloseSnapshotEvidence(1),
    payments: [pending], openOrders: [],
    occupiedTablesWithoutOrder: [], fiscalProfile
  });
  assert.equal(close.canClose, false);
  assert.deepEqual(close.countablePaymentIds, []);
  assert.deepEqual(close.blockers, [{ code: 'UNRESOLVED_PAYMENT', entityId: pending.id }]);
});

test('precio vigente solo se adopta con confirmación explícita y auditoría por ADMIN/CAJERO', () => {
  const resolution = {
    actor, request, resolution: 'ADOPT_CURRENT_CATALOG_PRICE', explicitConfirmation: true,
    currentCatalogUnitPrice: '100.00000', auditEventId: 'audit-1', reason: 'Confirmado con menú vigente'
  };
  assert.equal(isValidCashShiftV2PriceResolution(resolution), true);
  assert.equal(isValidCashShiftV2PriceResolution({ ...resolution, explicitConfirmation: false }), false);
  assert.equal(isValidCashShiftV2PriceResolution({ ...resolution, actor: { ...actor, role: 'SALONERO' } }), false);
});

test('ítem missing se libera solo al vincular item activo de la misma sucursal o anular con motivo', () => {
  const base = { actor, request, auditEventId: 'audit-item-1' };
  assert.equal(isValidCashShiftV2MissingItemResolution({
    ...base, resolution: 'LINK_CATALOG_ITEM',
    linkedMenuItem: { id: 'menu-2', tenantId: scope.tenantId, branchId: scope.branchId, available: true }
  }), true);
  assert.equal(isValidCashShiftV2MissingItemResolution({
    ...base, resolution: 'LINK_CATALOG_ITEM',
    linkedMenuItem: { id: 'menu-other', tenantId: scope.tenantId, branchId: 'other-branch', available: true }
  }), false);
  assert.equal(isValidCashShiftV2MissingItemResolution({ ...base, resolution: 'VOID_ITEM' }), false);
  assert.equal(isValidCashShiftV2MissingItemResolution({ ...base, resolution: 'VOID_ITEM', reason: 'Duplicado' }), true);
});

test('primera asignación de salonero no requiere PIN; cambio requiere PIN vigente verificado por servidor', () => {
  const candidate = {
    tenantId: scope.tenantId, branchId: scope.branchId, employeeId: 'waiter-2',
    name: 'Salón dos', role: 'SALONERO', active: true, activeBranchMembership: true
  };
  assert.equal(validateCashShiftV2WaiterAssignment({
    tenantId: scope.tenantId, branchId: scope.branchId, previousEmployeeId: null, candidate
  }).firstAssignment, true);
  assert.throws(() => validateCashShiftV2WaiterAssignment({
    tenantId: scope.tenantId, branchId: scope.branchId, previousEmployeeId: 'waiter-1', candidate
  }), /PIN vigente/);
  const verification = {
    authority: 'SERVER', tenantId: scope.tenantId, branchId: scope.branchId,
    employeeId: 'waiter-1', verifiedAt: '2026-11-18T23:30:00-06:00', challengeId: 'pin-check-1'
  };
  assert.equal(validateCashShiftV2WaiterAssignment({
    tenantId: scope.tenantId, branchId: scope.branchId, previousEmployeeId: 'waiter-1', candidate,
    currentPinVerification: verification
  }).pinVerification.challengeId, 'pin-check-1');
  assert.throws(() => validateCashShiftV2WaiterAssignment({
    tenantId: scope.tenantId, branchId: scope.branchId, previousEmployeeId: 'waiter-1',
    candidate: { ...candidate, branchId: 'other-branch' }
  }), /misma sucursal/);
});

test('legacy no verificable solo se concilia o cancela con actor privilegiado, motivo y auditoría', () => {
  assert.equal(isValidCashShiftV2LegacyDisposition({
    actor, request, action: 'RECONCILE', sourceSessionId: 'session-1', reason: 'Atribución verificada', auditEventId: 'audit-legacy-1'
  }), true);
  assert.equal(isValidCashShiftV2LegacyDisposition({
    actor, request, action: 'CANCEL', reason: 'Orden duplicada', auditEventId: 'audit-legacy-2'
  }), true);
  assert.equal(isValidCashShiftV2LegacyDisposition({
    actor: { ...actor, role: 'SALONERO' }, request, action: 'CANCEL', reason: 'x', auditEventId: 'audit-3'
  }), false);
  assert.equal(isValidCashShiftV2LegacyDisposition({
    actor, request, action: 'RECONCILE', reason: '', auditEventId: 'audit-4'
  }), false);
});

test('apertura diaria conserva fecha y abridor al cerrar después de medianoche', () => {
  const opening = {
    businessDate: '2026-11-18', openedAt: '2026-11-18T22:00:00-06:00', openedByActorId: 'cashier-1'
  };
  assert.equal(canCloseCashShiftV2DailyOpening(opening, {
    businessDate: '2026-11-18', closedAt: '2026-11-19T01:15:00-06:00', closedByActorId: 'cashier-1'
  }), true);
  assert.equal(canCloseCashShiftV2DailyOpening(opening, {
    businessDate: '2026-11-19', closedAt: '2026-11-19T01:15:00-06:00', closedByActorId: 'cashier-1'
  }), false);
  assert.equal(canCloseCashShiftV2DailyOpening(opening, {
    businessDate: '2026-11-18', closedAt: '2026-11-19T01:15:00-06:00', closedByActorId: 'cashier-2'
  }), false);
});
