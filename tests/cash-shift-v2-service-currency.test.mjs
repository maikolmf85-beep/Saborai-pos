import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCashShiftV2Operation, CashShiftV2ServiceError } from '../api/_utils/cashShiftV2Service.ts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const registerId = '33333333-3333-4333-8333-333333333333';
const actor = { userId: '55555555-5555-4555-8555-555555555555', tenantId, employeeId: '44444444-4444-4444-8444-444444444444', role: 'CAJERO' };
const scope = { action: 'OPEN_SHIFT', branchId, cashRegisterId: registerId, idempotencyKey: 'currency-test', payload: { logicalShift: 1, openingFloat: '10.01' } };

function repository(currency = 'USD') {
  const calls = [];
  return {
    calls,
    repo: {
      getBranch: async (_tenantId, id) => ({ id, tenantId, active: true }),
      getRegister: async (_tenantId, bId, id) => ({ id, tenantId, branchId: bId, active: true }),
      getFiscalProfile: async () => ({ authority: 'SERVER', tenantId, branchId, taxRegime: 'IVA_13', currency, priceBasis: 'EXCLUSIVE_OF_VAT' }),
      hasActiveMembership: async () => true,
      getDailyOpening: async () => ({ businessDate: '2026-11-19', closed: false }),
      getBranchMode: async () => ({ state: 'ACTIVE' }),
      rpc: async (name, args) => { calls.push({ name, args }); return { data: { success: true }, error: null }; }
    }
  };
}

async function expectBadInput(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof CashShiftV2ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

test('USD opening tender accepts cents and harmless trailing zeroes only', async t => {
  await t.test('10.01 accepted', async () => {
    const { repo, calls } = repository('USD');
    await executeCashShiftV2Operation(actor, scope, repo);
    assert.equal(calls.length, 1);
  });
  await t.test('10.01000 accepted without changing value', async () => {
    const { repo, calls } = repository('USD');
    await executeCashShiftV2Operation(actor, { ...scope, payload: { logicalShift: 1, openingFloat: '10.01000' } }, repo);
    assert.equal(calls[0].args.p_command.openingFloat, '10.01000');
  });
  await t.test('10.011 rejected', async () => {
    const { repo, calls } = repository('USD');
    await expectBadInput(executeCashShiftV2Operation(actor, { ...scope, payload: { logicalShift: 1, openingFloat: '10.011' } }, repo), 'INVALID_OPEN_SHIFT');
    assert.equal(calls.length, 0);
  });
});

test('USD cash payment accepts cent tender and rejects nonzero sub-cent tender', async t => {
  const payment = amount => ({
    action: 'CAPTURE_PAYMENT', branchId, cashRegisterId: registerId, idempotencyKey: `pay-${amount}`,
    payload: {
      method: 'CASH', orderId: 'order-1', receivingSessionId: 'session-1',
      sourceAmount: amount, sourceCurrency: 'USD', explicitCashConfirmation: true
    }
  });
  await t.test('10.01 accepted', async () => {
    const { repo, calls } = repository('USD');
    await executeCashShiftV2Operation(actor, payment('10.01'), repo);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_command.sourceAmount, '10.01');
    assert.equal(calls[0].args.p_command.branchCurrency, 'USD');
  });
  await t.test('10.001 rejected', async () => {
    const { repo, calls } = repository('USD');
    await expectBadInput(executeCashShiftV2Operation(actor, payment('10.001'), repo), 'INVALID_CASH_PAYMENT');
    assert.equal(calls.length, 0);
  });
});
