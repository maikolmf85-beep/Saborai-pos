import test from 'node:test';
import assert from 'node:assert/strict';
import { isUserActive } from '../api/_utils/userStatus.ts';

test('rechaza cuentas y empleados marcados como inactivos', () => {
  assert.equal(isUserActive(false), false);
  assert.equal(isUserActive(true), true);
  assert.equal(isUserActive(null), true);
});
