import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreTablePositionsFromSnapshot } from '../src/services/tableLayoutPersistence.ts';

const mesa = (overrides = {}) => ({
  id: 'mesa-1',
  number: 1,
  name: 'Mesa 1',
  seats: 4,
  shape: 'round',
  zone: 'Principal',
  status: 'AVAILABLE',
  x: 50,
  y: 25,
  rotation: 0,
  ...overrides
});

test('el caché local conserva una posición más reciente que un snapshot demorado', () => {
  const snapshot = [mesa({ x: 30, y: 20, rotation: 0 })];
  const localCache = [mesa({ x: 84, y: 67, rotation: 90 })];

  assert.deepEqual(
    restoreTablePositionsFromSnapshot(snapshot, localCache),
    [mesa({ x: 84, y: 67, rotation: 90 })]
  );
});

test('un caché antiguo sin geometría recupera posición y giro desde IndexedDB', () => {
  const snapshot = [mesa({ x: 82, y: 23, rotation: 90 })];
  const legacyLocalCache = [{ id: 'mesa-1', number: 1, name: 'Mesa 1' }];

  assert.deepEqual(
    restoreTablePositionsFromSnapshot(snapshot, legacyLocalCache),
    snapshot
  );
});

test('la recuperación de coordenadas es independiente por eje y conserva otros datos del snapshot', () => {
  const snapshot = [mesa({ x: 40, y: 60, rotation: 180, status: 'OCCUPIED' })];
  const partialLocalCache = [{ id: 'mesa-1', x: 77 }];

  assert.deepEqual(
    restoreTablePositionsFromSnapshot(snapshot, partialLocalCache),
    [mesa({ x: 77, y: 60, rotation: 180, status: 'OCCUPIED' })]
  );
});
