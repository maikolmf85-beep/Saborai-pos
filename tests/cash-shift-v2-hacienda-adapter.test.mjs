import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashShiftV2OrderFinancials } from '../src/services/cashShiftV2Contract.ts';
import { createCashShiftV2HaciendaSerializationInput } from '../src/services/cashShiftV2HaciendaAdapter.ts';

const profile = {
  authority: 'SERVER',
  tenantId: 'tenant-test',
  branchId: 'branch-test',
  taxRegime: 'IVA_13',
  currency: 'CRC',
  priceBasis: 'EXCLUSIVE_OF_VAT'
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

function serverOrder(lines = [line()]) {
  const financials = calculateCashShiftV2OrderFinancials(profile, lines);
  return {
    authority: 'SERVER',
    branchFiscalProfile: profile,
    financials,
    authorizedPaidAmount: '0.00000',
    balanceAmount: financials.total
  };
}

test('proyecta finanzas autorizadas a Hacienda sin convertir importes ni recalcular totales', () => {
  const order = serverOrder([
    line({ lineId: 'line-13', itemName: 'Café', unitPrice: '100.00000', taxRate: '0.1300' }),
    line({
      lineId: 'line-4', menuItemId: 'menu-2', itemName: 'Postre', quantity: '2.000',
      unitPrice: '10.00000', taxRate: '0.0400'
    })
  ]);
  const projection = createCashShiftV2HaciendaSerializationInput(order, [
    { lineId: 'line-13', cabysCode: '1234567890123' },
    { lineId: 'line-4', cabysCode: '5123456789012', unit: 'Os' }
  ]);

  assert.equal(projection.authority, 'SERVER');
  assert.equal(projection.policy, 'PRESERVE_SERVER_FINANCIALS_NO_RECALCULATION');
  assert.equal(projection.subtotal, '120.00000');
  assert.equal(projection.vatTotal, '13.80000');
  assert.equal(projection.serviceAmount, '12.00000');
  assert.equal(projection.totalComprobante, order.financials.total);
  assert.equal(projection.totalComprobante, '145.80000');
  assert.deepEqual(projection.lines.map(item => ({
    cabysCode: item.cabysCode,
    unit: item.unit,
    baseAmount: item.baseAmount,
    vatTariffCode: item.vatTariffCode,
    vatAmount: item.vatAmount,
    totalLine: item.totalLine
  })), [
    {
      cabysCode: '1234567890123', unit: 'Unid', baseAmount: '100.00000',
      vatTariffCode: '08', vatAmount: '13.00000', totalLine: '113.00000'
    },
    {
      cabysCode: '5123456789012', unit: 'Os', baseAmount: '20.00000',
      vatTariffCode: '04', vatAmount: '0.80000', totalLine: '20.80000'
    }
  ]);
  for (const value of [projection.subtotal, projection.vatTotal, projection.serviceAmount,
    projection.totalComprobante, ...projection.lines.flatMap(item => [
      item.quantity, item.unitPrice, item.baseAmount, item.vatAmount, item.totalLine
    ])]) {
    assert.equal(typeof value, 'string');
  }
});

test('falla cerrado si falta metadata, CABYS no es válido o la metadata está duplicada', () => {
  const order = serverOrder();
  assert.throws(() => createCashShiftV2HaciendaSerializationInput(order, []), /no corresponde exactamente/);
  assert.throws(() => createCashShiftV2HaciendaSerializationInput(order, [
    { lineId: 'line-1', cabysCode: '0000000000000' }
  ]), /CABYS duplicada o inválida/);
  assert.throws(() => createCashShiftV2HaciendaSerializationInput(order, [
    { lineId: 'line-1', cabysCode: '1234567890123' },
    { lineId: 'line-1', cabysCode: '1234567890123' }
  ]), /CABYS duplicada o inválida/);
  assert.throws(() => createCashShiftV2HaciendaSerializationInput(order, [
    { lineId: 'line-1', cabysCode: '1234567890123', unit: ' ' }
  ]), /CABYS duplicada o inválida/);
});

test('falla cerrado ante finanzas no autoritativas o alteradas', () => {
  const order = serverOrder();
  const wrongTotal = {
    ...order,
    financials: { ...order.financials, total: '124.00000' },
    balanceAmount: '124.00000'
  };
  assert.throws(() => createCashShiftV2HaciendaSerializationInput(wrongTotal, [
    { lineId: 'line-1', cabysCode: '1234567890123' }
  ]), /finanzas autoritativas/);
  assert.throws(() => createCashShiftV2HaciendaSerializationInput({
    ...order,
    authority: 'CLIENT'
  }, [{ lineId: 'line-1', cabysCode: '1234567890123' }]), /finanzas autoritativas/);
});

test('no proyecta una orden cuyas líneas válidas no pueden calcularse por resolución pendiente', () => {
  assert.throws(() => serverOrder([line({ resolutionState: 'PRICE_REVIEW' })]), /queda retenida/);
  assert.throws(() => serverOrder([line({ menuItemId: null })]), /queda retenida/);
});
