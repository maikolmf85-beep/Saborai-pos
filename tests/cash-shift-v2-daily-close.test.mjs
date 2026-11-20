import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCashShiftV2DailyCloseLedger,
  dispatchCashShiftV2AwareDailyClose,
  CashShiftV2DailyCloseDispatchError,
  isCashShiftV2DailyCloseEnabled
} from '../api/_utils/cashShiftV2DailyClose.ts';

const args = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  cashRegisterId: '33333333-3333-4333-8333-333333333333',
  businessDate: '2026-11-19',
  closedByIdentityId: '44444444-4444-4444-8444-444444444444',
  actorUserId: '55555555-5555-4555-8555-555555555555',
  actorEmployeeId: '44444444-4444-4444-8444-444444444444',
  actorRole: 'CAJERO'
};

function dependencies(mode, overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      readMode: async (tenantId, branchId) => {
        calls.push(['readMode', tenantId, branchId]);
        if (overrides.readError) throw new Error('mode read failed');
        return mode;
      },
      closeLegacy: async () => {
        calls.push(['legacy']);
        if (overrides.legacyError) throw new Error('legacy failed');
        return { path: 'legacy', result: 'closure-legacy' };
      },
      closeV2Aware: async value => {
        calls.push(['v2', value]);
        if (overrides.v2Error) throw new Error('v2 close failed');
        return { path: 'v2', result: 'closure-v2' };
      }
    }
  };
}

async function expectBlocked(promise) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof CashShiftV2DailyCloseDispatchError);
    assert.equal(error.code, 'V2_DAILY_CLOSE_BLOCKED');
    return true;
  });
}

test('el flag diario independiente no puede eludir el feature flag global apagado', () => {
  assert.equal(isCashShiftV2DailyCloseEnabled({
    globalEnabled: false, routeEnabled: 'true', dailyAwareEnabled: 'true'
  }), false);
  assert.equal(isCashShiftV2DailyCloseEnabled({
    globalEnabled: true, routeEnabled: 'true', dailyAwareEnabled: 'true'
  }), true);
  assert.equal(isCashShiftV2DailyCloseEnabled({
    globalEnabled: true, routeEnabled: 'true', dailyAwareEnabled: 'false'
  }), false);
});

test('feature flag apagado llama al cierre legacy directamente sin consultar el modo', async () => {
  const { dependencies: deps, calls } = dependencies('ACTIVE');
  const result = await dispatchCashShiftV2AwareDailyClose({ enabled: false, args, dependencies: deps });
  assert.equal(result.path, 'LEGACY');
  assert.equal(result.auditHandledAtomically, false);
  assert.deepEqual(calls.map(call => call[0]), ['legacy']);
});

test('OFF y PREPARED con feature flag apagado conservan cierre legacy sin leer tablas V2', async t => {
  for (const mode of ['OFF', 'PREPARED']) {
    await t.test(String(mode), async () => {
      const { dependencies: deps, calls } = dependencies(mode);
      const result = await dispatchCashShiftV2AwareDailyClose({ enabled: false, args, dependencies: deps });
      assert.equal(result.path, 'LEGACY');
      assert.equal(result.auditHandledAtomically, false);
      assert.deepEqual(calls.map(call => call[0]), ['legacy']);
    });
  }
});

test('OFF y PREPARED con V2 habilitado leen modo y luego usan legacy', async t => {
  for (const mode of ['OFF', 'PREPARED']) {
    await t.test(String(mode), async () => {
      const { dependencies: deps, calls } = dependencies(mode);
      const result = await dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps });
      assert.equal(result.path, 'LEGACY');
      assert.equal(result.auditHandledAtomically, false);
      assert.deepEqual(calls.map(call => call[0]), ['readMode', 'legacy']);
    });
  }
});

test('ACTIVE exige RPC V2 y marca auditoría transaccional', async () => {
  const { dependencies: deps, calls } = dependencies('ACTIVE');
  const result = await dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps });
  assert.deepEqual(result, { result: { path: 'v2', result: 'closure-v2' }, path: 'V2', auditHandledAtomically: true });
  assert.deepEqual(calls.map(call => call[0]), ['readMode', 'v2']);
  assert.deepEqual(calls[1][1], args);
});

test('error de modo o RPC ACTIVE falla cerrado y nunca invoca cierre legacy', async t => {
  await t.test('no se puede leer branch mode', async () => {
    const { dependencies: deps, calls } = dependencies(null, { readError: true });
    await expectBlocked(dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps }));
    assert.deepEqual(calls.map(call => call[0]), ['readMode']);
  });
  await t.test('modo ausente', async () => {
    const { dependencies: deps, calls } = dependencies(null);
    await expectBlocked(dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps }));
    assert.deepEqual(calls.map(call => call[0]), ['readMode']);
  });
  await t.test('RPC V2 no disponible', async () => {
    const { dependencies: deps, calls } = dependencies('ACTIVE', { v2Error: true });
    await expectBlocked(dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps }));
    assert.deepEqual(calls.map(call => call[0]), ['readMode', 'v2']);
  });
});

test('QUIESCING y FROZEN bloquean sin caer en el cierre legacy', async t => {
  for (const mode of ['QUIESCING', 'FROZEN']) {
    await t.test(mode, async () => {
      const { dependencies: deps, calls } = dependencies(mode);
      await expectBlocked(dispatchCashShiftV2AwareDailyClose({ enabled: true, args, dependencies: deps }));
      assert.deepEqual(calls.map(call => call[0]), ['readMode']);
    });
  }
});


const ledgerScope = {
  tenantId: 'tenant-ledger-test', branchId: 'branch-ledger-test',
  cashRegisterId: 'register-ledger-test', businessDate: '2026-11-19'
};
const ledgerProfile = {
  authority: 'SERVER', ...ledgerScope, taxRegime: 'IVA_13', currency: 'CRC', priceBasis: 'EXCLUSIVE_OF_VAT'
};
const dailyOpening = {
  businessDate: ledgerScope.businessDate,
  openedAt: '2026-11-19T07:00:00-06:00', openedByActorId: 'cashier-ledger'
};

function ledgerSession({ shift, register = ledgerScope.cashRegisterId, status = 'CLOSED', openedAt, closedAt, openingFloat, countedCash }) {
  return {
    authority: 'SERVER', ...ledgerScope, cashRegisterId: register,
    sessionId: `${register}-session-t${shift}`, posCashShiftId: `legacy-${register}-t${shift}`,
    logicalShift: shift, status, openedAt,
    ...(status === 'CLOSED' ? { closedAt, countedCash } : {}), openingFloat
  };
}

function ledgerPayment({ id, register = ledgerScope.cashRegisterId, receivingSessionId, receivingLogicalShift, amount, status = 'AUTHORIZED' }) {
  const receivingScope = { ...ledgerScope, cashRegisterId: register };
  return {
    authority: 'SERVER', id,
    request: { idempotencyKey: `request-${id}`, requestSha256: 'b'.repeat(64) },
    tenantId: ledgerScope.tenantId, branchId: ledgerScope.branchId,
    orderId: 'same-order-originating-in-t1', receivingSessionId,
    receivingSession: {
      authority: 'SERVER', ...receivingScope, sessionId: receivingSessionId,
      logicalShift: receivingLogicalShift
    },
    method: 'CASH', status, sourceAmount: amount, sourceCurrency: 'CRC',
    branchCurrency: 'CRC', targetCurrency: 'CRC', fxRate: '1.00000',
    convertedAmount: amount, appliedAmount: amount, changeAmount: '0.00000',
    authorizedAt: '2026-11-19T22:30:00-06:00',
    cashConfirmation: {
      authority: 'SERVER', tenantId: ledgerScope.tenantId, branchId: ledgerScope.branchId,
      actorId: 'cashier-ledger', actorRole: 'CAJERO', activeBranchMembership: true,
      canConfirmCash: true, sessionActorId: 'cashier-ledger', sessionRole: 'CAJERO',
      confirmedAt: '2026-11-19T22:29:00-06:00'
    }
  };
}

function validDailyLedger(overrides = {}) {
  const sessions = [
    ledgerSession({ shift: 1, register: ledgerScope.cashRegisterId, openedAt: '2026-11-19T07:00:00-06:00',
      closedAt: '2026-11-19T17:00:00-06:00', openingFloat: '100.00000', countedCash: '120.00000' }),
    ledgerSession({ shift: 2, register: ledgerScope.cashRegisterId, openedAt: '2026-11-19T17:00:00-06:00',
      closedAt: '2026-11-19T23:00:00-06:00', openingFloat: '120.00000', countedCash: '125.00000' }),
    ledgerSession({ shift: 1, register: 'register-other', openedAt: '2026-11-19T07:30:00-06:00',
      closedAt: '2026-11-19T16:30:00-06:00', openingFloat: '50.00000', countedCash: '53.00000' }),
    ledgerSession({ shift: 2, register: 'register-other', openedAt: '2026-11-19T16:30:00-06:00',
      closedAt: '2026-11-19T22:30:00-06:00', openingFloat: '53.00000', countedCash: '54.00000' })
  ];
  const payments = [
    ledgerPayment({ id: 'payment-t1', receivingSessionId: `${ledgerScope.cashRegisterId}-session-t1`, receivingLogicalShift: 1, amount: '20.00000' }),
    // La misma orden originada en T1 tiene un segundo cobro; cuenta en T2, que lo recibió.
    ledgerPayment({ id: 'payment-t2', receivingSessionId: `${ledgerScope.cashRegisterId}-session-t2`, receivingLogicalShift: 2, amount: '5.00000' }),
    ledgerPayment({ id: 'payment-other-register', register: 'register-other',
      receivingSessionId: 'register-other-session-t1', receivingLogicalShift: 1, amount: '3.00000' })
  ];
  return {
    authority: 'SERVER', scope: ledgerScope, fiscalProfile: ledgerProfile, dailyOpening,
    sessionCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE',
    snapshotCoverage: 'COMPLETE_BRANCH_BUSINESS_DATE',
    branchRegisterIds: [ledgerScope.cashRegisterId, 'register-other'],
    snapshotRegisterIds: [ledgerScope.cashRegisterId, 'register-other'],
    snapshotSessionIds: sessions.map(session => session.sessionId),
    closedAt: '2026-11-19T23:05:00-06:00', closedByActorId: 'cashier-ledger',
    sessions, payments, openOrders: [], occupiedTables: [], ...overrides
  };
}

test('cierre diario agrega pagos una sola vez por receivingSession; T1→T2 conserva origen sin doble conteo', () => {
  const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger());
  assert.equal(decision.canClose, true);
  assert.deepEqual(decision.blockers, []);
  assert.equal(decision.summary.cashAppliedAmount, '25');
  assert.equal(decision.summary.sinpeAppliedAmount, '0');
  assert.equal(decision.summary.totalCollectedAmount, '25');
  assert.equal(decision.summary.expectedCashAmount, '125');
  assert.deepEqual(decision.summary.branchRegisterIds, [ledgerScope.cashRegisterId, 'register-other']);
  assert.deepEqual(decision.summary.activeRequiredRegisterIds, [ledgerScope.cashRegisterId, 'register-other']);
  assert.deepEqual(decision.summary.snapshotRegisterIds, [ledgerScope.cashRegisterId, 'register-other']);
  assert.equal(decision.summary.branchSessionIds.length, 4);
  assert.equal(decision.summary.coveredSessionIds.length, 4);
  assert.deepEqual(decision.summary.countablePaymentIds, ['payment-t1', 'payment-t2']);
  assert.deepEqual(decision.summary.sessionIds, [
    `${ledgerScope.cashRegisterId}-session-t1`, `${ledgerScope.cashRegisterId}-session-t2`
  ]);
  assert.equal(decision.summary.sessionReconciliations[1].cashAppliedAmount, '5');
});

test('cierre diario falla cerrado con pagos repetidos, pending, cobertura incompleta, turno abierto y saldo/orden pendiente', async t => {
  const base = validDailyLedger();
  await t.test('mismo pago dos veces', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ payments: [base.payments[0], base.payments[0]] }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'DUPLICATE_PAYMENT'));
  });
  await t.test('pago PENDING', () => {
    const pending = ledgerPayment({ id: 'pending-payment', receivingSessionId: `${ledgerScope.cashRegisterId}-session-t2`, receivingLogicalShift: 2, amount: '5.00000', status: 'PENDING' });
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ payments: [base.payments[0], pending] }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'UNRESOLVED_PAYMENT'));
  });
  await t.test('sin cobertura completa de toda la sucursal/jornada', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ sessionCoverage: 'REGISTER' }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'INVALID_SESSION_COVERAGE'));
  });
  await t.test('sin snapshot completo de pagos, órdenes, mesas y legacy', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ snapshotCoverage: 'REGISTER_ONLY' }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'INCOMPLETE_SNAPSHOT'));
  });
  await t.test('falta una caja activa del roster de sucursal', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ branchRegisterIds: [ledgerScope.cashRegisterId] }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'INVALID_REGISTER_ROSTER'));
  });
  await t.test('snapshot no enumera todas las cajas activas requeridas', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({
      snapshotRegisterIds: [ledgerScope.cashRegisterId]
    }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'SNAPSHOT_REGISTER_SET_MISMATCH'));
  });
  await t.test('snapshot no cubre exactamente las sesiones de todas las cajas', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({
      snapshotSessionIds: ['register-ledger-test-session-t1']
    }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'SNAPSHOT_SESSION_SET_MISMATCH'));
  });
  await t.test('una caja activa sin su sesión T2 no completa el roster branch-wide', () => {
    const base = validDailyLedger();
    const sessions = base.sessions.filter(session => session.sessionId !== 'register-other-session-t2');
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({
      sessions, snapshotSessionIds: sessions.map(session => session.sessionId)
    }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'INVALID_REGISTER_ROSTER'));
  });
  await t.test('pago sin sesión receptora dentro del snapshot branch-wide', () => {
    const unscoped = ledgerPayment({ id: 'unscoped-payment', receivingSessionId: 'missing-session',
      receivingLogicalShift: 1, amount: '1.00000' });
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ payments: [unscoped] }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'RECEIVING_SESSION_MISSING'));
  });
  await t.test('PENDING de otra caja bloquea el cierre de sucursal', () => {
    const pending = ledgerPayment({ id: 'pending-other-register', register: 'register-other',
      receivingSessionId: 'register-other-session-t2', receivingLogicalShift: 2,
      amount: '1.00000', status: 'PENDING' });
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({
      payments: [...base.payments, pending]
    }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'UNRESOLVED_PAYMENT'));
  });
  await t.test('pago en moneda distinta al perfil de sucursal', () => {
    const wrongCurrency = { ...base.payments[1], branchCurrency: 'USD', targetCurrency: 'USD' };
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ payments: [base.payments[0], wrongCurrency] }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'PAYMENT_CURRENCY_MISMATCH'));
  });
  await t.test('sesión T2 aún abierta', () => {
    const sessions = [...base.sessions];
    sessions[1] = ledgerSession({ shift: 2, status: 'OPEN', openedAt: '2026-11-19T17:00:00-06:00', openingFloat: '120.00000' });
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({ sessions }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'SHIFT_NOT_CLOSED'));
  });
  await t.test('órdenes abiertas y retenidas bloquean', () => {
    const decision = evaluateCashShiftV2DailyCloseLedger(validDailyLedger({
      openOrders: [{ source: 'SERVER', tenantId: ledgerScope.tenantId, branchId: ledgerScope.branchId,
        cashRegisterId: ledgerScope.cashRegisterId, businessDate: ledgerScope.businessDate, orderId: 'open-order' }],
      heldOrderIds: ['held-order']
    }));
    assert.equal(decision.canClose, false);
    assert.ok(decision.blockers.some(item => item.code === 'OPEN_ORDER'));
    assert.ok(decision.blockers.some(item => item.code === 'HELD_ORDER'));
  });
});
