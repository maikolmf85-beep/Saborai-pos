import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHaciendaP12Pin, HACIENDA_P12_PIN_FORMAT_ERROR } from '../src/utils/haciendaP12Pin.ts';

test('accepts the exact four-digit legacy PIN', () => {
  assert.equal(isValidHaciendaP12Pin('0000'), true);
  assert.equal(isValidHaciendaP12Pin('1234'), true);
  assert.equal(isValidHaciendaP12Pin('123'), false);
  assert.equal(isValidHaciendaP12Pin('12345'), false);
});

test('accepts exactly 14 characters made of letters, numbers, or symbols', () => {
  assert.equal(isValidHaciendaP12Pin('Abcdef123456!?'), true);
  assert.equal(isValidHaciendaP12Pin('ábcdef123456!?'), true);
  assert.equal(isValidHaciendaP12Pin('abcdefghijklmn'), true);
  assert.equal(isValidHaciendaP12Pin('Abcdef123456!'), false);
  assert.equal(isValidHaciendaP12Pin('Abcdef123456!??'), false);
});

test('does not trim, normalize, or accept whitespace in a long passphrase', () => {
  assert.equal(isValidHaciendaP12Pin(' Abcdef12345!?'), false);
  assert.equal(isValidHaciendaP12Pin('Abcdef12345!? '), false);
  assert.equal(isValidHaciendaP12Pin('Abcdef12345!\n?'), false);
  assert.equal(isValidHaciendaP12Pin('Abcdef12345!\u0301?'), true);
});

test('rejects non-string values and exposes a user-facing format error', () => {
  assert.equal(isValidHaciendaP12Pin(null), false);
  assert.equal(isValidHaciendaP12Pin(1234), false);
  assert.match(HACIENDA_P12_PIN_FORMAT_ERROR, /4 dígitos/);
  assert.match(HACIENDA_P12_PIN_FORMAT_ERROR, /exactamente 14/);
});
