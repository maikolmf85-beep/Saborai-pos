import test from 'node:test';
import assert from 'node:assert/strict';
import { saleOperationIds } from '../src/services/posCloudService.ts';

const sale = overrides => ({
  table: { activeOrder: { orderNumber: 'ORD-1234' } },
  invoice: { clave50Digitos: '1234567890', consecutivo: '001' },
  paymentMethod: '01-Efectivo',
  total: 1000,
  closeOrder: true,
  items: [],
  ...overrides
});

test('reutiliza un conjunto estable de operationId por cada etapa de la venta', () => {
  const first = saleOperationIds('tenant-1', sale());
  const retry = saleOperationIds('tenant-1', sale());

  assert.deepEqual(first, retry);
  assert.deepEqual(first, {
    order: 'sale:tenant-1:1234567890:order',
    payment: 'sale:tenant-1:1234567890:payment',
    inventory: 'sale:tenant-1:1234567890:inventory',
    invoice: 'sale:tenant-1:1234567890:invoice'
  });
});

test('usa el número de orden como respaldo si todavía no existe clave de factura', () => {
  const ids = saleOperationIds('tenant-1', sale({ invoice: { clave50Digitos: '', consecutivo: '001' } }));
  assert.equal(ids.payment, 'sale:tenant-1:ORD-1234:payment');
});

test('rechaza generar IDs para una venta sin número de orden', () => {
  assert.throws(() => saleOperationIds('tenant-1', sale({ table: { activeOrder: undefined } })));
});
