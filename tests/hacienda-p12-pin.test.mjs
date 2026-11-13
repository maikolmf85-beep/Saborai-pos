import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHaciendaP12Pin, isValidHaciendaP12PinInput } from '../src/utils/haciendaP12Pin.ts';

test('acepta PINes legacy numéricos de exactamente cuatro dígitos', () => {
  assert.equal(isValidHaciendaP12Pin('0000'), true);
  assert.equal(isValidHaciendaP12Pin('0427'), true);
});

test('acepta contraseñas de exactamente catorce caracteres, incluidos letras, números y signos', () => {
  assert.equal(isValidHaciendaP12Pin('00012345678901'), true);
  assert.equal(isValidHaciendaP12Pin('Abc!123$xyzQw?'), true);
});

test('rechaza longitudes distintas de cuatro o catorce caracteres y no recorta espacios', () => {
  assert.equal(isValidHaciendaP12Pin('123'), false);
  assert.equal(isValidHaciendaP12Pin('12345'), false);
  assert.equal(isValidHaciendaP12Pin('Abc!123$xyzQw'), false); // 13 caracteres
  assert.equal(isValidHaciendaP12Pin('Abc!123$xyzQw?X'), false); // 15 caracteres
  assert.equal(isValidHaciendaP12Pin('12 4'), false);
  assert.equal(isValidHaciendaP12Pin('0000 '), false);
  assert.equal(isValidHaciendaP12Pin(' 00012345678901'), false);
});

test('cuenta y conserva literalmente los espacios de una contraseña de catorce caracteres', () => {
  const passwordWithOuterSpaces = ' A!bc123$xyZ9 ';
  assert.equal(passwordWithOuterSpaces.length, 14);
  assert.equal(isValidHaciendaP12Pin(passwordWithOuterSpaces), true);
  assert.equal(isValidHaciendaP12Pin('Abc! 123$xyzQ?'), true);
});

test('rechaza valores no textuales', () => {
  assert.equal(isValidHaciendaP12Pin(null), false);
  assert.equal(isValidHaciendaP12Pin(1234), false);
});

test('la regla de entrada PUT acepta campo vacío para conservar el PIN existente, no tipos/formats inválidos', () => {
  assert.equal(isValidHaciendaP12PinInput(''), true);
  assert.equal(isValidHaciendaP12PinInput('0427'), true);
  assert.equal(isValidHaciendaP12PinInput('00012345678901'), true);
  assert.equal(isValidHaciendaP12PinInput('Abc!123$xyzQw?'), true);
  assert.equal(isValidHaciendaP12PinInput(' A!bc123$xyZ9 '), true);
  assert.equal(isValidHaciendaP12PinInput(undefined), false);
  assert.equal(isValidHaciendaP12PinInput(1234), false);
  assert.equal(isValidHaciendaP12PinInput('0000 '), false);
});
