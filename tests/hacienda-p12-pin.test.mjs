import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHaciendaP12Pin } from '../src/utils/haciendaP12Pin.ts';

test('acepta PINes legacy numéricos de exactamente cuatro dígitos', () => {
  assert.equal(isValidHaciendaP12Pin('0000'), true);
  assert.equal(isValidHaciendaP12Pin('0427'), true);
});

test('acepta contraseña larga de al menos 15 caracteres con mayúscula, número y símbolo', () => {
  assert.equal(isValidHaciendaP12Pin('Abcdefghijklm1!'), true);
  assert.equal(isValidHaciendaP12Pin('Abcdefghijklm1! '), true);
});

test('rechaza longitudes y composiciones que no corresponden a ninguno de los formatos', () => {
  assert.equal(isValidHaciendaP12Pin('123'), false);
  assert.equal(isValidHaciendaP12Pin('12345'), false);
  assert.equal(isValidHaciendaP12Pin('Abcdefghijkl1!'), false); // 14 caracteres
  assert.equal(isValidHaciendaP12Pin('abcdefghijklmn1!'), false); // sin mayúscula
  assert.equal(isValidHaciendaP12Pin('Abcdefghijklmn!'), false); // sin número
  assert.equal(isValidHaciendaP12Pin('Abcdefghijklmn1'), false); // sin símbolo
  assert.equal(isValidHaciendaP12Pin('123456789012345'), false); // largo pero solo numérico
});

test('rechaza valores no textuales y no considera espacios como símbolos', () => {
  assert.equal(isValidHaciendaP12Pin(null), false);
  assert.equal(isValidHaciendaP12Pin(1234), false);
  assert.equal(isValidHaciendaP12Pin('Abcdefghijklm123 '), false);
});
