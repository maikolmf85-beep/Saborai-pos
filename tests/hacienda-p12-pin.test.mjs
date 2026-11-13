import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHaciendaP12Pin, isValidHaciendaP12PinInput } from '../src/utils/haciendaP12Pin.ts';

test('acepta PINes legacy numéricos de exactamente cuatro dígitos', () => {
  assert.equal(isValidHaciendaP12Pin('0000'), true);
  assert.equal(isValidHaciendaP12Pin('0427'), true);
});

test('acepta PIN numérico actual de exactamente catorce dígitos y conserva ceros iniciales', () => {
  assert.equal(isValidHaciendaP12Pin('00012345678901'), true);
});

test('rechaza longitudes distintas de cuatro o catorce dígitos y no recorta espacios', () => {
  assert.equal(isValidHaciendaP12Pin('123'), false);
  assert.equal(isValidHaciendaP12Pin('12345'), false);
  assert.equal(isValidHaciendaP12Pin('1234567890123'), false); // 13 dígitos
  assert.equal(isValidHaciendaP12Pin('123456789012345'), false); // 15 dígitos
  assert.equal(isValidHaciendaP12Pin('12 4'), false);
  assert.equal(isValidHaciendaP12Pin('0000 '), false);
  assert.equal(isValidHaciendaP12Pin(' 00012345678901'), false);
});

test('rechaza valores no textuales y no considera espacios como símbolos', () => {
  assert.equal(isValidHaciendaP12Pin(null), false);
  assert.equal(isValidHaciendaP12Pin(1234), false);
});

test('la regla de entrada PUT acepta campo vacío para conservar el PIN existente, no tipos/formats inválidos', () => {
  assert.equal(isValidHaciendaP12PinInput(''), true);
  assert.equal(isValidHaciendaP12PinInput('0427'), true);
  assert.equal(isValidHaciendaP12PinInput('00012345678901'), true);
  assert.equal(isValidHaciendaP12PinInput(undefined), false);
  assert.equal(isValidHaciendaP12PinInput(1234), false);
  assert.equal(isValidHaciendaP12PinInput('0000 '), false);
});
