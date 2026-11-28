import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidP12Pin } from '../src/utils/haciendaPin.ts';

test('acepta el PIN legado de exactamente cuatro dígitos', () => {
  assert.equal(isValidP12Pin('0427'), true);
  assert.equal(isValidP12Pin('1234'), true);
});

test('acepta la clave nueva de exactamente 14 caracteres con letras, números y símbolos', () => {
  assert.equal(isValidP12Pin('A1!bcD2@efG3#$'), true);
  assert.equal(isValidP12Pin(' 123456789012 '), true);
});

test('rechaza formatos incompletos, sobredimensionados y PIN legado no numérico', () => {
  for (const invalid of ['', '123', '12345', '12a4', '1234567890123', '123456789012345', null, 1234]) {
    assert.equal(isValidP12Pin(invalid), false, `debe rechazar ${String(invalid)}`);
  }
});

test('la validación no modifica espacios, signos ni la secuencia original', () => {
  const exactPin = ' 123456789012 ';
  assert.equal(isValidP12Pin(exactPin), true);
  assert.equal(exactPin, ' 123456789012 ');
});
