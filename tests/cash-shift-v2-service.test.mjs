import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCashShiftV2Operation, CashShiftV2ServiceError, dispatchCashShiftV2AwareWrite, getCashShiftV2RequestDigestForTest, isCashShiftV2RoutingEnabled } from '../api/_utils/cashShiftV2Service.ts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const registerId = '33333333-3333-4333-8333-333333333333';
const employeeId = '44444444-4444-4444-8444-444444444444';
const businessDate = '2026-11-19';
const profile = {
  authority: 'SERVER', tenantId, branchId, taxRegime: 'IVA_13',
  currency: 'CRC', priceBasis: 'EXCLUSIVE_OF_VAT'
};

function createRepository(overrides = {}) {
  const calls = [];
  const repo = {
    getBranch: async (tenant, branch) => overrides.branch ?? { id: branch, tenantId: tenant, active: true },
    getRegister: async (tenant, branch, register) => overrides.register ?? { id: register, tenantId: tenant, branchId: branch, active: true },
    getFiscalProfile: async () => overrides.profile === undefined ? profile : overrides.profile,
    hasActiveMembership: async () => overrides.membership ?? true,
    getDailyOpening: async () => overrides.opening === undefined ? { businessDate, closed: false } : overrides.opening,
    getBranchMode: async () => overrides.branchMode ?? { state: 'ACTIVE' },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return overrides.rpcResult ?? { data: { success: true, id: 'result-1' }, error: null };
    }
  };
  return { repo, calls };
}

function employee(role = 'ADMIN') {
  return { userId: '55555555-5555-4555-8555-555555555555', tenantId, employeeId, role };
}

function request(action, payload, extras = {}) {
  return {
    action, branchId, cashRegisterId: registerId, idempotencyKey: 'req-v2-1', payload, ...extras
  };
}

test('las lecturas/rutas V2 requieren simultáneamente el flag global y el flag de ruta', () => {
  assert.equal(isCashShiftV2RoutingEnabled(false, 'true'), false);
  assert.equal(isCashShiftV2RoutingEnabled(false, undefined), false);
  assert.equal(isCashShiftV2RoutingEnabled(true, undefined), false);
  assert.equal(isCashShiftV2RoutingEnabled(true, 'false'), false);
  assert.equal(isCashShiftV2RoutingEnabled(true, 'true'), true);
});

function openPayload() {
  return { logicalShift: 1, openingFloat: '25000' };
}

function fxCashPayload() {
  return {
    method: 'CASH', orderId: 'order-1', receivingSessionId: 'session-1',
    sourceAmount: '5.00', sourceCurrency: 'USD', explicitCashConfirmation: true,
    fx: { sourceCurrency: 'USD', targetCurrency: 'CRC', rate: '500.00000', explicitConfirmation: true }
  };
}

async function expectServiceError(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof CashShiftV2ServiceError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test('cada writer branch-routed usa RPC V2 en ACTIVE y conserva legacy solo en OFF/PREPARED', async t => {
  const actions = ['UPDATE_TABLE', 'TRANSFER_TABLE_ACCOUNT', 'PAYMENT', 'EMIT_INVOICE', 'CLOSE_CASH_SHIFT', 'IMPORT_CASH_SHIFT', 'HACIENDA_EMIT'];
  for (const action of actions) {
    await t.test(`${action}: OFF/PREPARED`, async () => {
      for (const mode of ['OFF', 'PREPARED']) {
        const calls = [];
        const result = await dispatchCashShiftV2AwareWrite({
          action, mode, v2Enabled: false,
          legacy: async () => { calls.push('legacy'); return 'legacy-result'; },
          v2: async () => { calls.push('v2'); return 'v2-result'; }
        });
        assert.deepEqual(result, { path: 'LEGACY', result: 'legacy-result' });
        assert.deepEqual(calls, ['legacy']);
      }
    });
    await t.test(`${action}: ACTIVE deshabilitado no tiene efecto`, async () => {
      const calls = [];
      await expectServiceError(dispatchCashShiftV2AwareWrite({
        action, mode: 'ACTIVE', v2Enabled: false,
        legacy: async () => { calls.push('legacy'); return 'legacy-result'; },
        v2: async () => { calls.push('v2'); return 'v2-result'; }
      }), 'CASH_SHIFT_V2_DISABLED', 503);
      assert.deepEqual(calls, []);
    });
    await t.test(`${action}: ACTIVE delega V2 sin fallback`, async () => {
      const calls = [];
      const result = await dispatchCashShiftV2AwareWrite({
        action, mode: 'ACTIVE', v2Enabled: true,
        legacy: async () => { calls.push('legacy'); return 'legacy-result'; },
        v2: async () => { calls.push('v2'); return 'v2-result'; }
      });
      assert.deepEqual(result, { path: 'V2', result: 'v2-result' });
      assert.deepEqual(calls, ['v2']);
    });
  }
});

test('modo ausente, lectura no disponible y transición bloquean sin invocar escritores', async t => {
  for (const mode of [null, 'QUIESCING', 'FROZEN']) {
    await t.test(String(mode), async () => {
      const calls = [];
      const promise = dispatchCashShiftV2AwareWrite({
        action: 'PAYMENT', mode, v2Enabled: true,
        legacy: async () => { calls.push('legacy'); return 'legacy-result'; },
        v2: async () => { calls.push('v2'); return 'v2-result'; }
      });
      await assert.rejects(promise, error => error instanceof CashShiftV2ServiceError);
      assert.deepEqual(calls, []);
    });
  }
});

test('fallo o contrato ausente del RPC activo nunca cae a legacy', async () => {
  const calls = [];
  await assert.rejects(dispatchCashShiftV2AwareWrite({
    action: 'TRANSFER_TABLE_ACCOUNT', mode: 'ACTIVE', v2Enabled: true,
    legacy: async () => { calls.push('legacy'); return 'legacy-result'; },
    v2: async () => { calls.push('v2'); throw new Error('rpc failed'); }
  }), /rpc failed/);
  assert.deepEqual(calls, ['v2']);
});

test('OPEN_SHIFT deriva tenant/actor/fecha en servidor y envía un RPC con hash calculado', async () => {
  const { repo, calls } = createRepository();
  const result = await executeCashShiftV2Operation(employee('CAJERO'), request('OPEN_SHIFT', openPayload()), repo);
  assert.deepEqual(result, { success: true, id: 'result-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'pos_cash_v2_open_shift');
  assert.equal(calls[0].args.p_tenant_id, tenantId);
  assert.equal(calls[0].args.p_actor_user_id, employee('CAJERO').userId);
  assert.equal(calls[0].args.p_actor_employee_id, employeeId);
  assert.equal(calls[0].args.p_business_date, businessDate);
  assert.equal(calls[0].args.p_request_sha256.length, 64);
  assert.equal(calls[0].args.p_command.scope.businessDate, businessDate);
});

test('OPEN_SHIFT T2 llega al RPC transaccional y no decide el handoff en el cliente', async () => {
  const { repo, calls } = createRepository();
  const result = await executeCashShiftV2Operation(
    employee('CAJERO'), request('OPEN_SHIFT', { logicalShift: 2, openingFloat: '825' }), repo
  );
  assert.deepEqual(result, { success: true, id: 'result-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'pos_cash_v2_open_shift');
  assert.equal(calls[0].args.p_command.logicalShift, 2);
  assert.equal(calls[0].args.p_command.openingFloat, '825');
});

test('ignora no permitido: cliente no puede imponer tenant o actor', async () => {
  const { repo, calls } = createRepository();
  await expectServiceError(
    executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload(), { tenantId: 'other' }), repo),
    'CLIENT_ACTOR_FORBIDDEN', 400
  );
  assert.equal(calls.length, 0);
});

test('rechaza caja de otra sucursal antes de llamar RPC', async () => {
  const { repo, calls } = createRepository({ register: { id: registerId, tenantId, branchId: '99999999-9999-4999-8999-999999999999', active: true } });
  await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'REGISTER_NOT_AVAILABLE', 404);
  assert.equal(calls.length, 0);
});

test('perfil fiscal faltante o rama no activa bloquean antes del RPC', async t => {
  await t.test('sin perfil fiscal', async () => {
    const { repo, calls } = createRepository({ profile: null });
    await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'FISCAL_PROFILE_MISSING', 409);
    assert.equal(calls.length, 0);
  });
  await t.test('sin estado ACTIVE', async () => {
    const { repo, calls } = createRepository({ branchMode: { state: 'PREPARED' } });
    await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'BRANCH_V2_NOT_ACTIVE', 409);
    assert.equal(calls.length, 0);
  });
});

test('empleado sin membresía activa no puede ejecutar RPC', async () => {
  const { repo, calls } = createRepository({ membership: false });
  await expectServiceError(executeCashShiftV2Operation(employee(), request('SYNC_ORDER', {}), repo), 'BRANCH_MEMBERSHIP_REQUIRED', 403);
  assert.equal(calls.length, 0);
});

test('SYNC_ORDER transmite PIN vigente sin normalizar y rechaza PIN no textual', async t => {
  const payload = {
    sessionId: 'session-t1', tableId: 'table-1', tableName: 'Mesa 1', waiterEmployeeId: 'waiter-2',
    currentWaiterPin: '0012',
    lines: [{ lineId: 'line-1', menuItemId: 'item-1', itemName: 'Café', quantity: '1', unitPrice: '100.00000', taxRate: '0.1300' }]
  };
  await t.test('valor exacto llega al RPC', async () => {
    const { repo, calls } = createRepository();
    await executeCashShiftV2Operation(employee('ADMIN'), request('SYNC_ORDER', payload), repo);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_command.currentWaiterPin, '0012');
  });
  await t.test('número no se convierte silenciosamente a string', async () => {
    const { repo, calls } = createRepository();
    await expectServiceError(executeCashShiftV2Operation(employee('ADMIN'), request('SYNC_ORDER', {
      ...payload, currentWaiterPin: 12
    }), repo), 'INVALID_ORDER_SYNC', 400);
    assert.equal(calls.length, 0);
  });
});

test('SYNC_ORDER no incorpora el PIN al digest, pero sí lo conserva para la validación RPC', async () => {
  const payload = {
    sessionId: 'session-t1', tableId: 'table-1', tableName: 'Mesa 1', waiterEmployeeId: 'waiter-2',
    currentWaiterPin: '0012',
    lines: [{ lineId: 'line-1', menuItemId: 'item-1', itemName: 'Café', quantity: '1', unitPrice: '100.00000', taxRate: '0.1300' }]
  };
  const digestWithFirstPin = await getCashShiftV2RequestDigestForTest('SYNC_ORDER', branchId, registerId, businessDate, payload);
  const digestWithSecondPin = await getCashShiftV2RequestDigestForTest('SYNC_ORDER', branchId, registerId, businessDate, {
    ...payload, currentWaiterPin: '9876'
  });
  assert.equal(digestWithFirstPin, digestWithSecondPin);

  const { repo, calls } = createRepository();
  await executeCashShiftV2Operation(employee('ADMIN'), request('SYNC_ORDER', payload), repo);
  assert.equal(calls[0].args.p_command.currentWaiterPin, '0012');
});

test('businessDate se deriva de la apertura diaria y una caja cerrada se rechaza', async () => {
  const { repo, calls } = createRepository({ opening: { businessDate, closed: true } });
  await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'DAILY_OPENING_REQUIRED', 409);
  assert.equal(calls.length, 0);
});

test('conversion FX solo la confirma empleado CAJERO, nunca owner, ADMIN ni SALONERO_CAJA', async t => {
  for (const [label, actor, expectedCode] of [
    ['owner', { userId: employee().userId, tenantId }, 'FX_CASHIER_REQUIRED'],
    ['ADMIN', employee('ADMIN'), 'FX_CASHIER_REQUIRED'],
    ['SALONERO_CAJA', employee('SALONERO_CAJA'), 'FX_CASHIER_REQUIRED']
  ]) {
    await t.test(label, async () => {
      const { repo, calls } = createRepository();
      await expectServiceError(executeCashShiftV2Operation(actor, request('CAPTURE_PAYMENT', fxCashPayload()), repo), expectedCode, 403);
      assert.equal(calls.length, 0);
    });
  }
  await t.test('CAJERO autorizado sí llega al RPC', async () => {
    const { repo, calls } = createRepository();
    await executeCashShiftV2Operation(employee('CAJERO'), request('CAPTURE_PAYMENT', fxCashPayload()), repo);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'pos_cash_v2_capture_payment');
    assert.equal(calls[0].args.p_command.method, 'CASH');
    assert.equal(calls[0].args.p_command.branchCurrency, 'CRC');
  });
});

test('CASH CRC exige colones enteros; USD admite centavos pero no fracciones adicionales no nulas', async t => {
  await t.test('CRC con fracción se rechaza', async () => {
    const { repo, calls } = createRepository();
    await expectServiceError(executeCashShiftV2Operation(employee('CAJERO'), request('OPEN_SHIFT', { logicalShift: 1, openingFloat: '1.001' }), repo), 'INVALID_OPEN_SHIFT', 400);
    assert.equal(calls.length, 0);
  });
  await t.test('moneda del cliente no sustituye perfil de sucursal', async () => {
    const { repo, calls } = createRepository();
    await expectServiceError(executeCashShiftV2Operation(employee('CAJERO'), request('CAPTURE_PAYMENT', { ...fxCashPayload(), branchCurrency: 'USD' }), repo), 'UNKNOWN_PAYLOAD_FIELD', 400);
    assert.equal(calls.length, 0);
  });
});

test('MIXED, CREDIT y CARD se rechazan; SINPE requiere actor ADMIN o CAJERO', async t => {
  for (const method of ['MIXED', 'CREDIT', 'CARD']) {
    await t.test(method, async () => {
      const { repo, calls } = createRepository();
      await expectServiceError(executeCashShiftV2Operation(employee('CAJERO'), request('CAPTURE_PAYMENT', { method }), repo), 'PAYMENT_METHOD_NOT_ALLOWED', 400);
      assert.equal(calls.length, 0);
    });
  }
  await t.test('SALONERO_CAJA no registra evidencia SINPE', async () => {
    const { repo, calls } = createRepository();
    const payload = { method: 'SINPE', orderId: 'order-1', receivingSessionId: 'session-1', amount: '100', currency: 'CRC', externalReference: 'ref-1', explicitEvidenceConfirmation: true };
    await expectServiceError(executeCashShiftV2Operation(employee('SALONERO_CAJA'), request('CAPTURE_PAYMENT', payload), repo), 'ROLE_NOT_ALLOWED', 403);
    assert.equal(calls.length, 0);
  });
});

test('si el RPC aún no existe devuelve 503 sin fallback legacy', async () => {
  const { repo, calls } = createRepository({ rpcResult: { data: null, error: { code: 'PGRST202', message: 'missing rpc' } } });
  await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'V2_BACKEND_NOT_READY', 503);
  assert.equal(calls.length, 1);
});

test('rechaza tenant/branch del perfil fiscal que no coincide con el scope autenticado', async () => {
  const { repo, calls } = createRepository({ profile: { ...profile, tenantId: '99999999-9999-4999-8999-999999999999' } });
  await expectServiceError(executeCashShiftV2Operation(employee(), request('OPEN_SHIFT', openPayload()), repo), 'FISCAL_PROFILE_MISSING', 409);
  assert.equal(calls.length, 0);
});


test('HELD_LINE_RESOLUTION solo permite ADMIN/CAJERO y delega al RPC atómico', async t => {
  const base = { orderId: 'order-1', lineId: 'line-1' };
  for (const [label, actor] of [['SALONERO', employee('SALONERO')], ['SALONERO_CAJA', employee('SALONERO_CAJA')], ['WAITER', employee('WAITER')]]) {
    await t.test(label, async () => {
      const { repo, calls } = createRepository();
      await expectServiceError(executeCashShiftV2Operation(actor, request('HELD_LINE_RESOLUTION', {
        ...base, resolution: 'VOID', reason: 'Producto no disponible'
      }), repo), 'ROLE_NOT_ALLOWED', 403);
      assert.equal(calls.length, 0);
    });
  }
  for (const role of ['ADMIN', 'CAJERO']) {
    await t.test(`${role} adopta precio server-side con confirmación`, async () => {
      const { repo, calls } = createRepository();
      await executeCashShiftV2Operation(employee(role), request('HELD_LINE_RESOLUTION', {
        ...base, resolution: 'ADOPT_CURRENT_PRICE', explicitConfirmation: true
      }), repo);
      assert.equal(calls[0].name, 'pos_cash_v2_resolve_held_line');
      assert.equal(calls[0].args.p_command.explicitConfirmation, true);
      assert.equal('currentCatalogUnitPrice' in calls[0].args.p_command, false);
    });
  }
});

test('HELD_LINE_RESOLUTION exige confirmación, motivo o item según la acción y rechaza campos extra', async t => {
  const cases = [
    [{ orderId: 'order-1', lineId: 'line-1', resolution: 'ADOPT_CURRENT_PRICE' }, 'INVALID_HELD_LINE_RESOLUTION'],
    [{ orderId: 'order-1', lineId: 'line-1', resolution: 'LINK_ITEM' }, 'INVALID_HELD_LINE_RESOLUTION'],
    [{ orderId: 'order-1', lineId: 'line-1', resolution: 'VOID' }, 'INVALID_HELD_LINE_RESOLUTION'],
    [{ orderId: 'order-1', lineId: 'line-1', resolution: 'VOID', reason: 'x', unexpected: true }, 'UNKNOWN_PAYLOAD_FIELD']
  ];
  for (const [payload, code] of cases) {
    await t.test(code, async () => {
      const { repo, calls } = createRepository();
      await expectServiceError(executeCashShiftV2Operation(employee('CAJERO'), request('HELD_LINE_RESOLUTION', payload), repo), code, 400);
      assert.equal(calls.length, 0);
    });
  }
});

test('SYNC_ORDER rechaza PIN faltante/malformado para un cambio posterior sin persistirlo', async t => {
  for (const pin of ['', ' 0012 ', '12', 12]) {
    await t.test(JSON.stringify(pin), async () => {
      const { repo, calls } = createRepository();
      await expectServiceError(executeCashShiftV2Operation(employee('ADMIN'), request('SYNC_ORDER', {
        sessionId: 'session-t1', tableId: 'table-1', tableName: 'Mesa 1', waiterEmployeeId: 'waiter-2',
        currentWaiterPin: pin,
        lines: [{ lineId: 'line-1', menuItemId: 'item-1', itemName: 'Café', quantity: '1', unitPrice: '100.00000', taxRate: '0.1300' }]
      }), repo), 'INVALID_ORDER_SYNC', 400);
      assert.equal(calls.length, 0);
    });
  }
});
