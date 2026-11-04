import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuickPaymentEmployeeCreditCharge, employeeCreditService, getSelectableEmployees } from '../src/services/employeeCreditService.ts';
import { getCostaRicaDateInputValue, getEmployeeCreditPeriodRange } from '../src/services/employeeCreditPeriod.ts';

const memory = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); }
};

function resetStorage() {
  memory.clear();
  localStorage.setItem('saborai_token', 'test-token');
}

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

test('el selector devuelve colaboradores activos solo con id y nombre, sin puesto ni propietario', () => {
  const employees = getSelectableEmployees([
    { id: 'owner', name: 'Dueño', role: 'ADMIN', active: true },
    { id: 'ana', name: 'Ana Rojas', role: 'CAJERO', active: true },
    { id: 'inactive', name: 'Colaborador inactivo', role: 'SALONERO', active: false },
    { id: 'ana', name: 'Ana duplicada', role: 'SALONERO', active: true }
  ], 'owner');

  assert.deepEqual(employees, [{ id: 'ana', name: 'Ana Rojas', active: true }]);
  assert.equal('role' in employees[0], false);
});

test('el cargo del pago rápido comparte una clave idempotente entre caché local y sincronización', () => {
  const registration = buildQuickPaymentEmployeeCreditCharge({
    tenantId: 'tenant-a',
    employeeId: 'ana',
    employeeName: 'Ana Rojas',
    amount: 1200.129,
    orderNumber: 'EMP-1002',
    invoiceClave: 'clave-unica-1'
  });

  assert.equal(registration.localCharge.amount, 1200.13);
  assert.equal(registration.localCharge.idempotencyKey, registration.syncPayload.idempotencyKey);
  assert.equal(registration.syncPayload.employeeId, 'ana');
  assert.equal(registration.syncPayload.employeeName, 'Ana Rojas');
  assert.match(registration.syncPayload.idempotencyKey, /clave-unica-1/);
});

test('los cargos locales se guardan por tenant, son pendientes y se deduplican por clave', () => {
  resetStorage();
  const params = {
    tenantId: 'tenant-a', employeeId: 'ana', employeeName: 'Ana Rojas', amount: 2500,
    orderNumber: 'EMP-1001', createdBy: 'owner', idempotencyKey: 'credit:sale:tenant-a:EMP-1001:payment'
  };
  const first = employeeCreditService.recordCharge(params);
  const retry = employeeCreditService.recordCharge(params);

  assert.equal(first.id, retry.id);
  assert.equal(first.pending, true);
  assert.equal(employeeCreditService.getBalance('tenant-a', 'ana'), 2500);
  assert.equal(employeeCreditService.getBalance('tenant-b', 'ana'), 0);
  assert.ok(memory.has('saborai:tenant:tenant-a:employee_credit_ledger'));
});

test('el refresco cloud respeta el saldo central y no duplica un cargo ya sincronizado', async () => {
  resetStorage();
  employeeCreditService.recordCharge({
    tenantId: 'tenant-a', employeeId: 'ana', employeeName: 'Ana Rojas', amount: 100,
    orderNumber: 'EMP-1001', idempotencyKey: 'credit:sale:tenant-a:EMP-1001:payment'
  });
  let requestedUrl = '';
  let requestedAuth = '';
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedAuth = options.headers.Authorization;
    return response({
      success: true,
      tenantId: 'tenant-a',
      employees: [{ id: 'ana', name: 'Ana Rojas', active: true }],
      accounts: [{ employeeId: 'ana', employeeName: 'Ana Rojas', status: 'ACTIVE', balance: 1000 }],
      transactions: [{
        id: 'cloud-tx-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'CHARGE', amount: 100,
        balanceAfter: 1000, orderNumber: 'EMP-1001', reference: 'EMP-1001', idempotencyKey: 'credit:sale:tenant-a:EMP-1001:payment',
        createdAt: '2026-10-30T20:00:00.000Z'
      }]
    });
  };

  const ledger = await employeeCreditService.refreshLedger('tenant-a');
  assert.match(requestedUrl, /tenantId=tenant-a/);
  assert.equal(requestedAuth, 'Bearer test-token');
  assert.equal(ledger.accounts.find(account => account.employeeId === 'ana').balance, 1000);
  assert.equal(ledger.transactions.length, 1);
  assert.equal(ledger.transactions[0].pending, false);
  assert.equal(employeeCreditService.getBalance('tenant-a', 'ana'), 1000);
});

test('el refresco conserva cargos locales pendientes además del saldo cloud', async () => {
  resetStorage();
  employeeCreditService.recordCharge({
    tenantId: 'tenant-a', employeeId: 'ana', employeeName: 'Ana Rojas', amount: 50,
    orderNumber: 'EMP-1002', idempotencyKey: 'credit:sale:tenant-a:EMP-1002:payment'
  });
  globalThis.fetch = async () => response({
    success: true,
    tenantId: 'tenant-a',
    employees: [{ id: 'ana', name: 'Ana Rojas', active: true }],
    accounts: [{ employeeId: 'ana', employeeName: 'Ana Rojas', status: 'ACTIVE', balance: 1000 }],
    transactions: [{
      id: 'cloud-tx-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'CHARGE', amount: 1000,
      balanceAfter: 1000, orderNumber: 'EMP-1001', reference: 'EMP-1001', idempotencyKey: 'cloud-key',
      createdAt: '2026-10-30T19:00:00.000Z'
    }]
  });

  const ledger = await employeeCreditService.refreshLedger('tenant-a');
  assert.equal(ledger.accounts.find(account => account.employeeId === 'ana').balance, 1050);
  assert.equal(ledger.transactions.filter(transaction => transaction.pending).length, 1);
});

test('el informe del periodo incluye cargos offline pendientes y no duplica los confirmados', async () => {
  resetStorage();
  const charge = employeeCreditService.recordCharge({
    tenantId: 'tenant-a', employeeId: 'ana', employeeName: 'Ana Rojas', amount: 50,
    orderNumber: 'EMP-1003', idempotencyKey: 'credit:quick:tenant-a:clave-3'
  });
  const range = getEmployeeCreditPeriodRange('year', getCostaRicaDateInputValue());
  let reportTransactions = [];
  let serverChargeTotal = 0;
  let serverTransactionCount = 0;
  globalThis.fetch = async () => response({
    success: true,
    tenantId: 'tenant-a',
    periodReport: {
      from: range.from,
      to: range.to,
      chargeTotal: serverChargeTotal,
      paymentTotal: 0,
      netTotal: serverChargeTotal,
      transactionCount: serverTransactionCount,
      employeeSummaries: serverTransactionCount ? [{ employeeId: 'ana', employeeName: 'Ana Rojas', chargeTotal: 50, paymentTotal: 0, netTotal: 50, transactionCount: 1 }] : [],
      transactions: reportTransactions,
      hasMoreTransactions: false
    }
  });

  const pendingReport = await employeeCreditService.getPeriodReport('tenant-a', range);
  assert.equal(pendingReport.chargeTotal, 50);
  assert.equal(pendingReport.transactionCount, 1);
  assert.equal(pendingReport.transactions[0].pending, true);

  reportTransactions = [{
    id: 'cloud-charge-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'CHARGE', amount: 50,
    balanceAfter: 50, orderNumber: 'EMP-1003', reference: 'EMP-1003', idempotencyKey: charge.idempotencyKey,
    createdAt: charge.createdAt
  }];
  serverChargeTotal = 50;
  serverTransactionCount = 1;
  const confirmedReport = await employeeCreditService.getPeriodReport('tenant-a', range);
  assert.equal(confirmedReport.chargeTotal, 50);
  assert.equal(confirmedReport.transactionCount, 1);
  assert.equal(confirmedReport.transactions.length, 1);
  assert.equal(confirmedReport.transactions[0].pending, false);
});

test('los abonos se envían al servidor y actualizan la caché con el saldo confirmado', async () => {
  resetStorage();
  employeeCreditService.recordCharge({
    tenantId: 'tenant-a', employeeId: 'ana', employeeName: 'Ana Rojas', amount: 100,
    orderNumber: 'EMP-1001', idempotencyKey: 'credit:sale:tenant-a:EMP-1001:payment'
  });
  let payload;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'GET') return response({
      success: true,
      tenantId: 'tenant-a',
      employees: [{ id: 'ana', name: 'Ana Rojas', active: true }],
      accounts: [{ employeeId: 'ana', employeeName: 'Ana Rojas', status: 'ACTIVE', balance: 75 }],
      transactions: [
        { id: 'payment-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'PAYMENT', amount: 25, balanceAfter: 75, reference: 'RECIBO-1', idempotencyKey: 'employee-credit-payment:payment:key-1', createdAt: '2026-10-30T20:30:00.000Z' },
        { id: 'charge-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'CHARGE', amount: 100, balanceAfter: 100, orderNumber: 'EMP-1001', reference: 'EMP-1001', idempotencyKey: 'credit:sale:tenant-a:EMP-1001:payment', createdAt: '2026-10-30T20:00:00.000Z' }
      ]
    });
    payload = JSON.parse(options.body);
    return response({
      success: true,
      tenantId: 'tenant-a',
      transaction: {
        id: 'payment-1', employeeId: 'ana', employeeName: 'Ana Rojas', type: 'PAYMENT', amount: 25,
        balanceAfter: 75, reference: 'RECIBO-1', idempotencyKey: 'employee-credit-payment:payment:key-1',
        createdAt: '2026-10-30T20:30:00.000Z'
      }
    });
  };

  const transaction = await employeeCreditService.recordPayment({
    tenantId: 'tenant-a', employeeId: 'ana', amount: 25, reference: 'RECIBO-1', idempotencyKey: 'payment:key-1'
  });
  assert.equal(payload.tenantId, 'tenant-a');
  assert.equal(payload.employeeId, 'ana');
  assert.equal(payload.amount, 25);
  assert.equal(transaction.type, 'PAYMENT');
  assert.equal(employeeCreditService.getBalance('tenant-a', 'ana'), 75);
});
