import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidFiscalClave, normalizeFiscalIdentification } from '../src/utils/fiscalIdentifiers.ts';

const makeClave = (identification) =>
  `506270126${identification.padStart(12, '0')}00100001010000000001` + '1' + '12345678';

test('conserva el comportamiento de identificación numérica existente', () => {
  assert.equal(normalizeFiscalIdentification('0-40188-0588'), '401880588');
  assert.equal(normalizeFiscalIdentification('3-101-123456'), '3101123456');
});

test('conserva y normaliza cédulas jurídicas alfanuméricas', () => {
  assert.equal(normalizeFiscalIdentification('AB-123-CD'), 'AB123CD');
  assert.equal(normalizeFiscalIdentification('ab 123 cd'), 'AB123CD');
});

test('valida claves de 50 posiciones con ID numérico o alfanumérico', () => {
  const numericClave = makeClave('3101123456');
  const alphanumericClave = makeClave('AB12345678');
  assert.equal(numericClave.length, 50);
  assert.equal(alphanumericClave.length, 50);
  assert.equal(isValidFiscalClave(numericClave), true);
  assert.equal(isValidFiscalClave(alphanumericClave), true);
  assert.equal(isValidFiscalClave(alphanumericClave.replace(/^5/, 'X')), false);
  assert.equal(isValidFiscalClave(alphanumericClave.replace(/.$/, 'X')), false);
});
