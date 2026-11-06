import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getCostaRicaBusinessDate,
  isOpenDiningTable,
  isPaymentInsideShift,
  shouldCloseOrderAfterPayment,
  summarizeShiftPayments
} from '../src/services/cashClosureRules.ts';

const openedAt = '2026-11-05T14:00:00.000Z';
const closedAt = '2026-11-05T20:00:00.000Z';

test('solo mesas con comanda activa bloquean el cierre diario; una reserva no', () => {
  assert.equal(isOpenDiningTable({ status: 'OCCUPIED' }), true);
  assert.equal(isOpenDiningTable({ status: 'PRE_CHECK' }), true);
  assert.equal(isOpenDiningTable({ status: 'RESERVED' }), false);
  assert.equal(isOpenDiningTable({ status: 'AVAILABLE' }), false);
});

test('el pago de una subcuenta deja abierta la orden si quedan cuentas y la cierra al liquidar la última', () => {
  const items = [{ subAccountId: 1 }, { subAccountId: 2 }];
  assert.equal(shouldCloseOrderAfterPayment(items, 1), false);
  assert.equal(shouldCloseOrderAfterPayment([{ subAccountId: 1 }], 1), true);
  assert.equal(shouldCloseOrderAfterPayment(items, 'ALL'), true);
});

test('el cierre de turno usa el intervalo semiabierto apertura <= cobro < cierre', () => {
  assert.equal(isPaymentInsideShift({ paidAt: openedAt, status: 'PENDING' }, openedAt, closedAt), true);
  assert.equal(isPaymentInsideShift({ paidAt: '2026-11-05T19:59:59.999Z', status: 'AUTHORIZED' }, openedAt, closedAt), true);
  assert.equal(isPaymentInsideShift({ paidAt: closedAt, status: 'AUTHORIZED' }, openedAt, closedAt), false);
  assert.equal(isPaymentInsideShift({ paidAt: '2026-11-05T13:59:59.999Z', status: 'AUTHORIZED' }, openedAt, closedAt), false);
  assert.equal(isPaymentInsideShift({ paidAt: '2026-11-05T18:00:00.000Z', status: 'FAILED' }, openedAt, closedAt), false);
  assert.equal(isPaymentInsideShift({ paidAt: null, status: 'PENDING' }, openedAt, closedAt), false);
});

test('el bruto incluye crédito y pagos mixtos, pero no confunde pagos con comprobantes ni cuenta fallidos', () => {
  const totals = summarizeShiftPayments([
    { paidAt: '2026-11-05T14:30:00.000Z', status: 'PENDING', method: 'CASH', amount: 1000 },
    { paidAt: '2026-11-05T15:30:00.000Z', status: 'AUTHORIZED', method: 'CARD', amount: 2500 },
    { paidAt: '2026-11-05T16:30:00.000Z', status: 'PENDING', method: 'SINPE', amount: 500 },
    { paidAt: '2026-11-05T17:30:00.000Z', status: 'PENDING', method: 'CREDIT', amount: 9000 },
    { paidAt: '2026-11-05T18:30:00.000Z', status: 'PENDING', method: 'MIXED', amount: 700 },
    { paidAt: '2026-11-05T18:30:00.000Z', status: 'FAILED', method: 'CASH', amount: 8000 }
  ], openedAt, closedAt);
  assert.deepEqual(totals, {
    cashSales: 1000,
    cardSales: 2500,
    sinpeSales: 500,
    creditSales: 9000,
    mixedSales: 700,
    totalSales: 13700,
    paymentsCount: 5
  });
});

test('fecha de cierre diaria se calcula en Costa Rica, no en UTC', () => {
  assert.equal(getCostaRicaBusinessDate(new Date('2026-11-06T04:30:00.000Z')), '2026-11-05');
});

test('la migración cuenta documentos reales por caja/turno/fecha, y separa bruto, efectivo e impuestos', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261105170000_shift_and_daily_cash_closures.sql', import.meta.url), 'utf8');
  const zReport = await readFile(new URL('../src/components/ZReportModal.tsx', import.meta.url), 'utf8');
  assert.match(sql, /unique \(tenant_id, branch_id, cash_register_id, business_date\)/i);
  assert.match(sql, /p\.paid_at >= v_shift\.opened_at[\s\S]*p\.paid_at < v_closed_at/i);
  assert.match(sql, /p\.cash_shift_id = v_shift\.id/i);
  assert.match(sql, /join public\.pos_payments p on p\.tenant_id = i\.tenant_id and p\.id = i\.payment_id/i);
  assert.match(sql, /s\.cash_register_id = v_register\.id/i);
  assert.match(sql, /i\.issued_at >= v_day_start[\s\S]*i\.issued_at < v_day_end/i);
  assert.doesNotMatch(sql, /p\.(?:branch_id|cash_register_id)/i);
  assert.doesNotMatch(sql, /i\.(?:cash_shift_id|cash_register_id)/i);
  assert.doesNotMatch(sql, /count\s*\(\s*distinct\s+p\.order_id\s*\)/i);
  assert.match(sql, /'creditSales', v_credit[\s\S]*'totalSales', v_cash \+ v_card \+ v_sinpe \+ v_credit \+ v_mixed/i);
  assert.match(sql, /v_expected_cash := coalesce\(v_shift\.opening_float, 0\) \+ v_cash \+ v_inflows - v_outflows/i);
  assert.equal((sql.match(/'documentsCountAvailable', v_documents_count_available/gi) || []).length, 2);
  assert.match(sql, /p\.cash_shift_id is null[\s\S]*v_documents_count_available := false/i);
  assert.match(sql, /i\.issued_at is null[\s\S]*v_documents_count_available := false/i);
  assert.match(sql, /p\.cash_shift_id = v_shift\.id and p\.paid_at is null/i);
  assert.match(sql, /s\.cash_register_id = v_register\.id and p\.paid_at is null/i);
  assert.equal((sql.match(/'paymentsScopeAvailable', v_payments_scope_available/gi) || []).length, 2);
  assert.match(sql, /left join information_schema\.columns/i);
  assert.match(sql, /'pos_payments', 'cash_shift_id'/i);
  assert.match(sql, /'pos_invoices', 'payment_id'/i);
  assert.match(sql, /before insert or update of tenant_id, cash_shift_id, paid_at, amount, method, status on public\.pos_payments/i);
  assert.match(sql, /'taxesAvailable', false[\s\S]*'taxesNote'/i);
  assert.match(zReport, /Comprobantes registrados/i);
  assert.match(zReport, /documentsCountAvailable === true[\s\S]*No disponible/i);
  assert.match(zReport, /paymentsScopeAvailable !== true[\s\S]*Total de cobros: No disponible/i);
  assert.match(zReport, /Impuestos fuera de este cierre/i);
  assert.match(sql, /t\.status in \('OCCUPIED', 'PRE_CHECK'\)/i);
  assert.match(sql, /pos_orders[\s\S]*o\.status in \('OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED'\)/i);
  assert.match(sql, /at time zone v_branch\.timezone/i);
  assert.doesNotMatch(sql, /update public\.pos_tables/i);
});
