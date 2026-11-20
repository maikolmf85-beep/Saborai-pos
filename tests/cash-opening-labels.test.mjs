import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = path => readFile(new URL(path, import.meta.url), 'utf8');

test('las acciones para abrir caja y turno usan etiquetas cortas y consistentes', async () => {
  const [cashModal, app, billing] = await Promise.all([
    readSource('../src/components/CashShiftModal.tsx'),
    readSource('../src/App.tsx'),
    readSource('../src/components/BillingHacienda.tsx')
  ]);

  assert.match(cashModal, /isOpeningDailyCash \? 'Abriendo caja…' : 'Abrir caja'/);
  assert.match(cashModal, /confirmLabel: 'Abrir caja'/);
  assert.match(cashModal, /Usa <strong>Abrir caja<\/strong>/);
  assert.match(cashModal, /<span>Abrir turno<\/span>/);
  assert.match(cashModal, /\? 'Gestionar Turno Activo' : 'Abrir turno'/);

  for (const source of [cashModal, app, billing]) {
    assert.doesNotMatch(source, /Abrir Turno Ahora|Abrir Turno en esta Caja|Abrir Turno Aquí/);
  }
});
