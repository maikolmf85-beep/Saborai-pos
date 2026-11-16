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

const segundaMesa = (overrides = {}) => ({
  id: 'mesa-2',
  number: 2,
  name: 'Mesa 2',
  seats: 2,
  shape: 'square',
  zone: 'Terraza',
  status: 'AVAILABLE',
  x: 75,
  y: 50,
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

test('al reingresar, una caché actual conserva altas y ediciones frente a un snapshot viejo', () => {
  const oldSnapshot = [mesa({ x: 20, y: 30, name: 'Mesa anterior' })];
  const latestCache = [
    mesa({ x: 84, y: 67, name: 'Mesa actual' }),
    segundaMesa()
  ];

  assert.deepEqual(restoreTablePositionsFromSnapshot(oldSnapshot, latestCache), latestCache);
});

test('una caché de plano actual no revierte el estado operativo más reciente del snapshot', () => {
  const snapshot = [mesa({ x: 20, name: 'Mesa anterior', status: 'OCCUPIED' })];
  const localCache = [mesa({ x: 84, name: 'Mesa actual', status: 'AVAILABLE' })];

  assert.deepEqual(
    restoreTablePositionsFromSnapshot(snapshot, localCache),
    [mesa({ x: 84, name: 'Mesa actual', status: 'OCCUPIED' })]
  );
});

test('un snapshot IndexedDB vacío no borra mesas guardadas en la caché actual', () => {
  const latestCache = [mesa(), segundaMesa()];

  assert.deepEqual(restoreTablePositionsFromSnapshot([], latestCache), latestCache);
});

test('una caché local vacía intencional prevalece sobre un snapshot viejo con mesas', () => {
  assert.deepEqual(restoreTablePositionsFromSnapshot([mesa(), segundaMesa()], []), []);
});

test('si no existe una caché válida, IndexedDB sigue sirviendo de respaldo', () => {
  const snapshot = [mesa({ x: 82, y: 23, rotation: 90 })];
  assert.deepEqual(restoreTablePositionsFromSnapshot(snapshot, null), snapshot);
});
