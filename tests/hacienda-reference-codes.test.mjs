import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidReferenceReasonCode, normalizeReferenceDocumentCode } from '../src/utils/haciendaReferenceCodes.ts';

test('normaliza alias internos de documento y conserva códigos oficiales de referencia', () => {
  assert.equal(normalizeReferenceDocumentCode('FE'), '01');
  assert.equal(normalizeReferenceDocumentCode('TE'), '04');
  assert.equal(normalizeReferenceDocumentCode('03'), '03');
  assert.equal(normalizeReferenceDocumentCode('19'), '19');
  assert.equal(normalizeReferenceDocumentCode('20'), '20');
  assert.equal(normalizeReferenceDocumentCode('FUTURE'), null);
});

test('admite motivos nuevos de nota 9 aplicables a FE/TE/NC/ND', () => {
  for (const code of ['12', '13', '14', '15', '16']) {
    assert.equal(isValidReferenceReasonCode(code, 'NC'), true, `debe admitir ${code}`);
  }
  assert.equal(isValidReferenceReasonCode('99', 'ND'), true);
});

test('reserva el código 17 de nota 9 para Recibo Electrónico de Pago', () => {
  assert.equal(isValidReferenceReasonCode('17', 'NC'), false);
  assert.equal(isValidReferenceReasonCode('17', 'REP'), true);
});

test('rechaza códigos de motivo que no existen en la nota 9 vigente', () => {
  assert.equal(isValidReferenceReasonCode('03', 'NC'), false);
  assert.equal(isValidReferenceReasonCode('18', 'NC'), false);
  assert.equal(isValidReferenceReasonCode('99', 'NC'), true);
});
