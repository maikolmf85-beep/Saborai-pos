import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidHaciendaActivityCode } from '../src/utils/haciendaActivityCode.ts';

test('acepta el formato oficial DGT de seis caracteres con punto decimal', () => {
  assert.equal(isValidHaciendaActivityCode('5610.0'), true);
  assert.equal(isValidHaciendaActivityCode(' 5610.0 '), true);
});

test('sigue aceptando códigos numéricos de seis dígitos', () => {
  assert.equal(isValidHaciendaActivityCode('123456'), true);
  assert.equal(isValidHaciendaActivityCode('000001'), true);
});

test('rechaza códigos de longitud o formato distintos', () => {
  assert.equal(isValidHaciendaActivityCode('5610'), false);
  assert.equal(isValidHaciendaActivityCode('5610.00'), false);
  assert.equal(isValidHaciendaActivityCode('56A0.0'), false);
  assert.equal(isValidHaciendaActivityCode('12345'), false);
  assert.equal(isValidHaciendaActivityCode('1234567'), false);
});

test('rechaza valores que no sean texto', () => {
  assert.equal(isValidHaciendaActivityCode(null), false);
  assert.equal(isValidHaciendaActivityCode(561000), false);
});
