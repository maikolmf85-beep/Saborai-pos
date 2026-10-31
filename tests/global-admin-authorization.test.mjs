import test from 'node:test';
import assert from 'node:assert/strict';
import { isGlobalAdminUser, parseGlobalAdminUserIds } from '../api/_utils/globalAdminAuthorization.ts';

test('allowlist global vacía o ausente no autoriza a nadie', () => {
  assert.equal(parseGlobalAdminUserIds(undefined).size, 0);
  assert.equal(parseGlobalAdminUserIds(' , , ').size, 0);
  assert.equal(isGlobalAdminUser('restaurant-admin-id', parseGlobalAdminUserIds('')), false);
});

test('solo los IDs explícitos de configuración pueden acceder a métricas globales', () => {
  const allowedIds = parseGlobalAdminUserIds('  global-operator-id,second-id  ');
  assert.equal(isGlobalAdminUser('GLOBAL-OPERATOR-ID', allowedIds), true);
  assert.equal(isGlobalAdminUser('restaurant-admin-id', allowedIds), false);
  assert.equal(isGlobalAdminUser(undefined, allowedIds), false);
});
