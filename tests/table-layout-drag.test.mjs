import assert from 'node:assert/strict';
import test from 'node:test';
import { TableLayoutDragDraft } from '../src/services/tableLayoutDrag.ts';

const table = (id, x, y, status = 'AVAILABLE') => ({
  id,
  number: id === 'table-a' ? 1 : 2,
  name: `Mesa ${id}`,
  seats: 4,
  shape: 'round',
  zone: 'Principal',
  status,
  x,
  y
});

test('pointerup commits the most recent drag draft, not the last React render snapshot', () => {
  const initial = [table('table-a', 20, 25), table('table-b', 70, 25, 'OCCUPIED')];
  const renderSnapshot = initial;
  const draft = new TableLayoutDragDraft(initial);

  draft.move('table-a', 63, 41);
  draft.move('table-a', 81, 54);
  let committed;
  draft.commit(value => { committed = value; });

  assert.deepEqual(renderSnapshot[0], table('table-a', 20, 25));
  assert.equal(committed[0].x, 81);
  assert.equal(committed[0].y, 54);
  assert.deepEqual(committed[1], initial[1]);
});

test('incoming synchronized tables replace the drag draft before a new edit', () => {
  const draft = new TableLayoutDragDraft([table('table-a', 20, 25)]);
  const synchronized = [table('table-a', 48, 67)];
  draft.reset(synchronized);

  let committed;
  draft.commit(value => { committed = value; });
  assert.deepEqual(committed, synchronized);
});
