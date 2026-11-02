import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtmlText,
  formatDinerNames,
  getDinerNames,
  getDisplayableDinerName
} from '../src/utils/orderDiners.ts';

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
