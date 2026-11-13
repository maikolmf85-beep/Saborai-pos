import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHaciendaStatusQuery, isConfirmedHaciendaRejection } from '../api/_utils/haciendaStatus.ts';

test('solo una consulta DGT exitosa con ind-estado rechazado confirma el rechazo', () => {
  const rejected = classifyHaciendaStatusQuery(true, 'rechazado');
  assert.equal(rejected.querySucceeded, true);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(isConfirmedHaciendaRejection(rejected), true);
});

test('un error HTTP no confirma rechazo aunque el body diga rechazado', () => {
  const failed = classifyHaciendaStatusQuery(false, 'rechazado');
  assert.equal(failed.querySucceeded, false);
  assert.equal(failed.status, 'PROCESSING');
  assert.equal(isConfirmedHaciendaRejection(failed), false);
});

test('una consulta exitosa con otro estado no autoriza el reenvío', () => {
  for (const indicator of ['aceptado', 'recibido', 'procesando', undefined]) {
    const result = classifyHaciendaStatusQuery(true, indicator);
    assert.equal(result.status, indicator === 'aceptado' ? 'ACCEPTED' : 'PROCESSING');
    assert.equal(isConfirmedHaciendaRejection(result), false);
  }
});
