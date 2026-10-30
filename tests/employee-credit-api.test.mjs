import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCreditAmount,
  normalizeEmployeeCreditRecordInput,
  recordEmployeeCreditTransaction
} from '../api/_utils/employeeCredit.ts';

const validInput = {
  tenantId: 'tenant-1',
  employeeId: 'employee-1',
  type: 'CHARGE',
  amount: 1200.129,
  idempotencyKey: 'sale:tenant-1:EMP-1001:payment',
  orderId: 'order-uuid',
  reference: 'EMP-1001',
  createdBy: 'owner-1'
};

test('normaliza montos a céntimos y rechaza valores inválidos', () => {
  assert.equal(normalizeCreditAmount(1200.129), 1200.13);
  for (const amount of [0, -1, NaN, Infinity, '100']) {
    assert.throws(() => normalizeCreditAmount(amount), /monto/i);
  }
});

test('normaliza la operación a campos permitidos y límites conocidos', () => {
  assert.deepEqual(normalizeEmployeeCreditRecordInput(validInput), {
    ...validInput,
    amount: 1200.13,
    notes: null
  });
  assert.throws(() => normalizeEmployeeCreditRecordInput({ ...validInput, type: 'VOID' }), /tipo/i);
  assert.throws(() => normalizeEmployeeCreditRecordInput({ ...validInput, employeeId: 'x'.repeat(121) }), /colaborador/i);
  assert.throws(() => normalizeEmployeeCreditRecordInput({ ...validInput, idempotencyKey: '' }), /idempotencia/i);
});

test('llama la RPC transaccional con tenant, identidad y clave de idempotencia exactos', async () => {
  let rpcCall;
  const client = {
    async rpc(name, args) {
      rpcCall = { name, args };
      return {
        error: null,
        data: [{
          account_id: 'account-1',
          transaction_id: 'transaction-1',
          employee_id: 'employee-1',
          employee_name: 'Ana Rojas',
          transaction_type: 'CHARGE',
          amount: 1200.13,
          balance_after: 1200.13,
          reference: 'EMP-1001',
          idempotency_key: 'sale:tenant-1:EMP-1001:payment',
          created_at: '2026-10-30T20:00:00.000Z',
          already_applied: false
        }]
      };
    }
  };

  const result = await recordEmployeeCreditTransaction(client, validInput);
  assert.equal(rpcCall.name, 'apply_employee_credit_transaction');
  assert.equal(rpcCall.args.p_tenant_id, 'tenant-1');
  assert.equal(rpcCall.args.p_employee_id, 'employee-1');
  assert.equal(rpcCall.args.p_transaction_type, 'CHARGE');
  assert.equal(rpcCall.args.p_amount, 1200.13);
  assert.equal(rpcCall.args.p_idempotency_key, validInput.idempotencyKey);
  assert.equal(rpcCall.args.p_created_by, 'owner-1');
  assert.deepEqual(result, {
    accountId: 'account-1',
    transactionId: 'transaction-1',
    employeeId: 'employee-1',
    employeeName: 'Ana Rojas',
    type: 'CHARGE',
    amount: 1200.13,
    balanceAfter: 1200.13,
    reference: 'EMP-1001',
    idempotencyKey: validInput.idempotencyKey,
    createdAt: '2026-10-30T20:00:00.000Z',
    alreadyApplied: false
  });
});

test('convierte respuestas de la RPC con saldo y clave ya aplicada a resultado seguro', async () => {
  const result = await recordEmployeeCreditTransaction({
    async rpc() {
      return { error: null, data: [{
        account_id: 'account-1', transaction_id: 'transaction-1', employee_id: 'employee-1',
        employee_name: 'Ana Rojas', transaction_type: 'PAYMENT', amount: 10, balance_after: 5,
        reference: null, idempotency_key: 'idem-1', created_at: '2026-10-30T20:00:00Z', already_applied: true
      }] };
    }
  }, { ...validInput, type: 'PAYMENT', amount: 10, idempotencyKey: 'idem-1', orderId: null });
  assert.equal(result.type, 'PAYMENT');
  assert.equal(result.balanceAfter, 5);
  assert.equal(result.alreadyApplied, true);
});
