import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialShiftZones, normalizeSalonOptions } from '../src/services/shiftOpeningZones.ts';

test('las opciones de apertura se deduplican y solo contienen nombres válidos', () => {
  assert.deepEqual(
    normalizeSalonOptions([' Principal ', 'Terraza', 'principal', '', null, 12]),
    ['Principal', 'Terraza']
  );
});

test('descarta salones heredados de la caja que no existen en el restaurante', () => {
  assert.deepEqual(
    getInitialShiftZones(['Principal'], ['Salón Viejo', 'Principal', 'Otra Zona Fantasma']),
    ['Principal']
  );
});

test('sin salones creados, los vínculos antiguos no se convierten en opciones ni restricciones', () => {
  assert.deepEqual(getInitialShiftZones([], ['Salón Viejo', 'Terraza']), []);
});

test('el salón desde cuyo aviso se abrió el flujo prevalece sobre la configuración de caja', () => {
  assert.deepEqual(
    getInitialShiftZones(['Principal', 'Terraza'], ['Principal'], ' Terraza '),
    ['Terraza']
  );
});

test('si el salón solicitado ya no existe, recurre solo a vínculos válidos de la caja', () => {
  assert.deepEqual(
    getInitialShiftZones(['Principal'], ['Salón Viejo', 'Principal'], 'Terraza'),
    ['Principal']
  );
});
