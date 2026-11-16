import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewerTableLayoutTimestamp } from '../src/services/tableLayoutFreshness.ts';

test('ordena timestamps submilisegundo que Date.parse considera iguales', () => {
  const older = '2026-11-15T12:00:00.123400Z';
  const newer = '2026-11-15T12:00:00.123900Z';

  assert.equal(Date.parse(older), Date.parse(newer));
  assert.equal(isNewerTableLayoutTimestamp(newer, older), true);
  assert.equal(isNewerTableLayoutTimestamp(older, newer), false);
});

test('rechaza timestamps iguales y eventos repetidos para no revertir el plano visible', () => {
  const accepted = '2026-11-15T12:00:00.123456Z';
  assert.equal(isNewerTableLayoutTimestamp(accepted, accepted), false);
  assert.equal(isNewerTableLayoutTimestamp('2026-11-15T12:00:00.123456+00:00', accepted), false);
});

test('normaliza offsets equivalentes y conserva el orden cronológico', () => {
  assert.equal(
    isNewerTableLayoutTimestamp('2026-11-15T07:00:00.123900-05:00', '2026-11-15T12:00:00.123400Z'),
    true
  );
});

test('un primer evento puede inicializar el estado; un timestamp ausente luego no reemplaza uno conocido', () => {
  assert.equal(isNewerTableLayoutTimestamp(null, null), true);
  assert.equal(isNewerTableLayoutTimestamp(null, '2026-11-15T12:00:00.000Z'), false);
  assert.equal(isNewerTableLayoutTimestamp('not-a-date', '2026-11-15T12:00:00.000Z'), false);
});
