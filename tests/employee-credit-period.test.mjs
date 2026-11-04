import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEmployeeCreditPeriodRange,
  getCostaRicaDateInputValue,
  getEmployeeCreditPeriodRange
} from '../src/services/employeeCreditPeriod.ts';
import { EmployeeCreditPeriodReportAccumulator } from '../api/_utils/employeeCreditReport.ts';

test('calcula el día de negocio en Costa Rica y muestra su fecha legible', () => {
  const range = getEmployeeCreditPeriodRange('day', '2026-11-01');
  assert.deepEqual(range, { from: '2026-11-01T06:00:00.000Z', to: '2026-11-02T06:00:00.000Z' });
  assert.equal(formatEmployeeCreditPeriodRange(range), '1 nov 2026');
  assert.equal(getCostaRicaDateInputValue(new Date('2026-11-02T05:59:00.000Z')), '2026-11-01');
});

test('calcula la semana ISO de lunes a lunes incluyendo una fecha de domingo', () => {
  assert.deepEqual(getEmployeeCreditPeriodRange('week', '2026-11-01'), {
    from: '2026-10-26T06:00:00.000Z',
    to: '2026-11-02T06:00:00.000Z'
  });
});

test('calcula rangos completos de mes y año, incluido año bisiesto', () => {
  assert.deepEqual(getEmployeeCreditPeriodRange('month', '2026-11-15'), {
    from: '2026-11-01T06:00:00.000Z',
    to: '2026-12-01T06:00:00.000Z'
  });
  assert.deepEqual(getEmployeeCreditPeriodRange('year', '2024-06-30'), {
    from: '2024-01-01T06:00:00.000Z',
    to: '2025-01-01T06:00:00.000Z'
  });
});

test('rechaza fechas de referencia inexistentes', () => {
  assert.throws(() => getEmployeeCreditPeriodRange('month', '2026-02-30'), /fecha válida/i);
  assert.throws(() => getEmployeeCreditPeriodRange('day', ''), /fecha válida/i);
});

test('agrega consumo y abonos completos por colaborador con importes de centavos', () => {
  const report = new EmployeeCreditPeriodReportAccumulator(
    '2026-11-01T06:00:00.000Z',
    '2026-11-02T06:00:00.000Z',
    new Map([['ana', 'Ana Rojas'], ['leo', 'Leo Mora']])
  );
  report.add([
    { id: 'c1', account_id: 'a1', employee_id: 'ana', transaction_type: 'CHARGE', amount: 100.25, balance_after: 100.25, reference: 'EMP-1', idempotency_key: 'k1', created_at: '2026-11-01T16:00:00.000Z' },
    { id: 'p1', account_id: 'a1', employee_id: 'ana', transaction_type: 'PAYMENT', amount: 25, balance_after: 75.25, idempotency_key: 'k2', created_at: '2026-11-01T18:00:00.000Z' },
    { id: 'c2', account_id: 'a2', employee_id: 'leo', transaction_type: 'CHARGE', amount: 10, balance_after: 10, reference: 'EMP-2', idempotency_key: 'k3', created_at: '2026-11-01T19:00:00.000Z' }
  ]);

  const result = report.toReport();
  assert.equal(result.chargeTotal, 110.25);
  assert.equal(result.paymentTotal, 25);
  assert.equal(result.netTotal, 85.25);
  assert.equal(result.transactionCount, 3);
  assert.deepEqual(result.employeeSummaries.map(employee => [employee.employeeId, employee.chargeTotal, employee.paymentTotal, employee.netTotal]), [
    ['ana', 100.25, 25, 75.25],
    ['leo', 10, 0, 10]
  ]);
  assert.equal(result.transactions[0].orderNumber, 'EMP-1');
  assert.equal(result.hasMoreTransactions, false);
});

test('mantiene totales exactos aunque la lista visible del periodo se limite a 500 movimientos', () => {
  const report = new EmployeeCreditPeriodReportAccumulator('from', 'to', new Map([['ana', 'Ana Rojas']]));
  report.add(Array.from({ length: 501 }, (_, index) => ({
    id: `tx-${index}`,
    account_id: 'account-1',
    employee_id: 'ana',
    transaction_type: 'CHARGE',
    amount: 1,
    balance_after: index + 1,
    idempotency_key: `key-${index}`,
    created_at: new Date(Date.UTC(2026, 10, 1, 12, 0, index)).toISOString()
  })));

  const result = report.toReport();
  assert.equal(result.chargeTotal, 501);
  assert.equal(result.transactionCount, 501);
  assert.equal(result.transactions.length, 500);
  assert.equal(result.hasMoreTransactions, true);
});
