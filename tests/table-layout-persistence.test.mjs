import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasStoredTableGeometry,
  restoreTablePositionsFromSnapshot
} from '../src/services/tableLayoutPersistence.ts';

const tableIdentity = {
  id: 'mesa-sintetica-1',
  number: 1,
  name: 'Mesa sintética',
  seats: 4,
  shape: 'round',
  zone: 'Prueba',
  status: 'AVAILABLE'
};

test('keeps geometry in localStorage when IndexedDB contains an older layout', () => {
  const localTables = [{ ...tableIdentity, x: 82, y: 23, rotation: 90 }];
  const oldSnapshot = [{ ...tableIdentity, x: 50, y: 20, rotation: 0 }];

  assert.equal(hasStoredTableGeometry(localTables), true);
  assert.deepEqual(
    restoreTablePositionsFromSnapshot(localTables, oldSnapshot, hasStoredTableGeometry(localTables)),
    localTables
  );
});

test('recovers geometry from IndexedDB when the local cache has no positions', () => {
  const localCache = [tableIdentity];
  const normalizedCurrent = [{ ...tableIdentity, x: 50, y: 20 }];
  const snapshot = [{ ...tableIdentity, x: 82, y: 23, rotation: 90 }];

  assert.equal(hasStoredTableGeometry(localCache), false);
  const restored = restoreTablePositionsFromSnapshot(
    normalizedCurrent,
    snapshot,
    hasStoredTableGeometry(localCache)
  );
  assert.equal(restored[0].x, 82);
  assert.equal(restored[0].y, 23);
  assert.equal(restored[0].rotation, 90);
  assert.equal(restored[0].status, 'AVAILABLE');
});

test('does not treat an empty or partially positioned table list as a saved layout', () => {
  assert.equal(hasStoredTableGeometry([]), false);
  assert.equal(hasStoredTableGeometry([{ ...tableIdentity, x: 82 }]), false);
});
