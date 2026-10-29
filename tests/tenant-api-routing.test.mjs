import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTenantApiAction } from '../api/_utils/tenantRoute.ts';

test('resuelve onboarding y profile por sus URLs originales', () => {
  assert.equal(resolveTenantApiAction('/api/tenant/onboarding'), 'onboarding');
  assert.equal(resolveTenantApiAction('/api/tenant/profile'), 'profile');
});

test('conserva la selección por pathname aunque la query tenga el nombre de otra acción', () => {
  assert.equal(resolveTenantApiAction('/api/tenant/profile?action=onboarding'), 'profile');
  assert.equal(resolveTenantApiAction('/api/tenant/onboarding?action=profile'), 'onboarding');
});

test('admite URLs absolutas y trailing slash sin alterar la acción', () => {
  assert.equal(resolveTenantApiAction('https://example.test/api/tenant/profile/?zone=main'), 'profile');
});

test('no despacha rutas tenant desconocidas ni URLs ausentes', () => {
  assert.equal(resolveTenantApiAction('/api/tenant/unknown'), null);
  assert.equal(resolveTenantApiAction(undefined), null);
});
