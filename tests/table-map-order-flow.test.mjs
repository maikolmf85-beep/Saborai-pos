import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveShiftForZone, shouldOpenOrderOnTableSelect } from '../src/components/tableMapOrderFlow.ts';

const activeSalonShift = {
  hasActiveShift: true,
  activeShiftZones: ['Salón'],
  activeShiftZone: 'Salón'
};

test('al tocar una mesa, abre directamente su comanda si el turno activo cubre su salón', () => {
  assert.equal(shouldOpenOrderOnTableSelect('Salón', false, activeSalonShift), true);
});

test('no abre la comanda si el turno activo pertenece a otro salón', () => {
  assert.equal(shouldOpenOrderOnTableSelect('Terraza', false, activeSalonShift), false);
});

test('no abre la comanda sin turno activo', () => {
  assert.equal(shouldOpenOrderOnTableSelect('Salón', false, { ...activeSalonShift, hasActiveShift: false }), false);
});

test('no abre comandas al seleccionar mesas mientras se edita el plano', () => {
  assert.equal(shouldOpenOrderOnTableSelect('Salón', true, activeSalonShift), false);
});

test('usa el salón vinculado como respaldo si no se entregó la lista de salones del turno', () => {
  assert.equal(hasActiveShiftForZone('Salón', { hasActiveShift: true, activeShiftZone: 'Salón' }), true);
  assert.equal(hasActiveShiftForZone('Terraza', { hasActiveShift: true, activeShiftZone: 'Salón' }), false);
});

test('permite comandar en cualquier salón cuando el turno no restringe zonas', () => {
  assert.equal(hasActiveShiftForZone('Terraza', { hasActiveShift: true }), true);
});
