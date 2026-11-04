import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  escapeHtmlText,
  formatDinerNames,
  formatDinerNamesForPrinter,
  getDinerNames,
  getDisplayableDinerName
} from '../src/utils/orderDiners.ts';
import { sanitizeFiscalInvoiceData, toFiscalInvoiceItems } from '../src/utils/fiscalInvoiceItems.ts';

test('muestra un solo nombre aunque esté repetido en varios artículos', () => {
  assert.equal(formatDinerNames([
    { dinerName: 'Miguelina' },
    { dinerName: ' Miguelina ' },
    { dinerName: 'MIGUELINA' }
  ]), 'Comensal: Miguelina');
});

test('muestra nombres distintos una sola vez y en el orden de la comanda', () => {
  assert.deepEqual(getDinerNames([
    { dinerName: 'Miguelina' },
    { dinerName: 'Ana' },
    { dinerName: 'Miguelina' }
  ]), ['Miguelina', 'Ana']);
  assert.equal(formatDinerNames([
    { dinerName: 'Miguelina' },
    { dinerName: 'Ana' }
  ]), 'Comensales: Miguelina, Ana');
});

test('prefiere el nombre actual de la cuenta para artículos históricos sin nombre o con nombre anterior', () => {
  assert.equal(formatDinerNames([
    { dinerName: undefined },
    { dinerName: 'Nombre anterior' }
  ], 'María P.'), 'Comensal: María P.');
});

test('omite campos vacíos y etiquetas genéricas de cuenta', () => {
  assert.equal(formatDinerNames([
    {},
    { dinerName: '' },
    { dinerName: '   ' },
    { dinerName: 'Cuenta 1' },
    { dinerName: 'Cuenta 2 (Comensal 2)' },
    { dinerName: 'General' },
    { dinerName: 'Para Llevar' },
    { dinerName: 'Mesa' }
  ]), undefined);
  assert.equal(getDisplayableDinerName('  Cuenta 1  '), undefined);
});

test('escapa los nombres antes de insertarlos en el HTML de impresión', () => {
  assert.equal(escapeHtmlText('<Ana & "Luis">'), '&lt;Ana &amp; &quot;Luis&quot;&gt;');
});

test('conserva los nombres en tickets de cocina/bar y los excluye del rol de caja', () => {
  const items = [{ name: 'Sopa', quantity: 1, dinerName: 'ETIQUETA SOLO INTERNA' }];

  assert.equal(formatDinerNamesForPrinter(items, 'cocina'), 'Comensal: ETIQUETA SOLO INTERNA');
  assert.equal(formatDinerNamesForPrinter(items, 'bar'), 'Comensal: ETIQUETA SOLO INTERNA');
  assert.equal(formatDinerNamesForPrinter(items, 'caja'), undefined);
});

test('proyecta artículos fiscales sin datos de cuenta, comensal ni preparación', () => {
  const items = toFiscalInvoiceItems([{
    id: 'internal-item-id',
    name: 'Sopa de prueba',
    price: 3500,
    quantity: 2,
    subAccountId: 3,
    dinerName: 'ETIQUETA SOLO INTERNA',
    notes: 'sin cebolla',
    cabysCode: '5019270000000',
    taxRate: 0.13,
    category: 'Cocina',
    selectedModifiers: [{ modifierName: 'Extra', choiceName: 'Aguacate' }],
    kdsStatus: 'PENDING',
    unit: 'Sp'
  }]);

  assert.deepEqual(items, [{
    name: 'Sopa de prueba',
    price: 3500,
    quantity: 2,
    cabysCode: '5019270000000',
    taxRate: 0.13,
    category: 'Cocina',
    unit: 'Sp'
  }]);
  assert.equal(JSON.stringify(items).includes('ETIQUETA SOLO INTERNA'), false);
});

test('sanea invoiceData de servidor sin sustituir el receptor fiscal por el comensal', () => {
  const invoiceData = sanitizeFiscalInvoiceData({
    receptor: { nombre: 'CLIENTE FISCAL', identificacion: '123456789' },
    dinerName: 'ETIQUETA SOLO INTERNA',
    subAccounts: [{ id: 3, name: 'ETIQUETA SOLO INTERNA' }],
    activeOrder: { subAccounts: [{ name: 'ETIQUETA SOLO INTERNA' }] },
    items: [{
      name: 'Sopa de prueba',
      price: 3500,
      quantity: 1,
      cabysCode: '5019270000000',
      taxRate: 0.13,
      category: 'Cocina',
      subAccountId: 3,
      dinerName: 'ETIQUETA SOLO INTERNA',
      notes: 'sin cebolla'
    }]
  });

  assert.equal(invoiceData.receptor.nombre, 'CLIENTE FISCAL');
  assert.deepEqual(invoiceData.items, [{
    name: 'Sopa de prueba',
    price: 3500,
    quantity: 1,
    cabysCode: '5019270000000',
    taxRate: 0.13,
    category: 'Cocina'
  }]);
  assert.equal(JSON.stringify(invoiceData).includes('ETIQUETA SOLO INTERNA'), false);
});

test('conecta la proyección segura con recibo, factura, emisión y sync fiscal', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const [quickPayment, billing, printer, offlineSync, haciendaApi, historyApi, app, posCloud, orderTaking, kds] = await Promise.all([
    read('../src/components/QuickPaymentModal.tsx'),
    read('../src/components/BillingHacienda.tsx'),
    read('../src/services/printerService.ts'),
    read('../api/offline/sync.ts'),
    read('../api/hacienda.ts'),
    read('../api/hacienda-history.ts'),
    read('../src/App.tsx'),
    read('../src/services/posCloudService.ts'),
    read('../src/components/OrderTaking.tsx'),
    read('../src/components/KDSView.tsx')
  ]);

  assert.match(quickPayment, /items:\s*toFiscalInvoiceItems\(items\)/);
  assert.doesNotMatch(quickPayment, /dinerNamesLabel|showItemDinerNames|Comensal:\s*\{it\.dinerName\}/);
  assert.match(billing, /items:\s*toFiscalInvoiceItems\(activeItems\)/);
  assert.doesNotMatch(billing, /COMPROBANTE RÉGIMEN SIMPLIFICADO - CUENTA|FACTURA ELECTRÓNICA - CUENTA|TIQUETE ELECTRÓNICO - CUENTA/i);
  assert.doesNotMatch(billing, /CABYS:\s*\{item\.cabysCode\}\s*\(Cuenta/i);
  assert.equal((printer.match(/formatDinerNamesForPrinter\(data\.items, config\.role\)/g) || []).length, 2);
  assert.match(offlineSync, /invoice_data:\s*sanitizeFiscalInvoiceData\(payload\.invoiceData\)/);
  assert.match(haciendaApi, /const invoiceData = sanitizeFiscalInvoiceData\(/);
  assert.match(historyApi, /invoiceData:\s*sanitizeFiscalInvoiceData\(row\.invoice_data\)/);
  assert.match(app, /invoiceData:\s*sanitizeFiscalInvoiceData\(sale\.invoice\)/);
  assert.match(posCloud, /invoiceData:\s*sanitizeFiscalInvoiceData\(sale\.invoice\)/);
  assert.match(orderTaking, /dinerName:\s*i\.dinerName/);
  assert.match(kds, /formatDinerNames\(order\.items\)/);
});
