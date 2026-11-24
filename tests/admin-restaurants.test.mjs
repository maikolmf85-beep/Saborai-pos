import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_RESTAURANT_BRANCH_SELECT,
  ADMIN_RESTAURANT_SELECT,
  ADMIN_RESTAURANT_SUBSCRIPTION_SELECT,
  DEFAULT_ADMIN_RESTAURANT_PAGE_SIZE,
  MAX_ADMIN_RESTAURANT_PAGE_SIZE,
  mapAdminRestaurantBranch,
  mapAdminRestaurantSummary,
  mapAdminRestaurantSubscription,
  parseAdminRestaurantPagination
} from '../api/_utils/adminRestaurants.ts';

test('la página predeterminada y los límites de paginación son seguros', () => {
  assert.deepEqual(parseAdminRestaurantPagination(undefined, undefined), {
    limit: DEFAULT_ADMIN_RESTAURANT_PAGE_SIZE,
    offset: 0
  });
  assert.deepEqual(parseAdminRestaurantPagination('100', '200'), {
    limit: MAX_ADMIN_RESTAURANT_PAGE_SIZE,
    offset: 200
  });
  assert.equal(parseAdminRestaurantPagination('101', '0'), null);
  assert.equal(parseAdminRestaurantPagination('-1', '0'), null);
  assert.equal(parseAdminRestaurantPagination('10.5', '0'), null);
  assert.equal(parseAdminRestaurantPagination('10', '1e3'), null);
  assert.equal(parseAdminRestaurantPagination('10', ['0']), null);
});

test('el mapeo devuelve solo los campos permitidos para el directorio', () => {
  const result = mapAdminRestaurantSummary({
    id: 'restaurant-1',
    name: 'Soda Central',
    email: 'admin@example.test',
    phone: '+506 2222 0000',
    plan: 'pro',
    onboarding_completed: true,
    user_id: 'owner-private-id',
    password_hash: 'must-not-leave-server',
    hacienda_config: { certificate: 'private' }
  });

  assert.deepEqual(result, {
    id: 'restaurant-1',
    name: 'Soda Central',
    email: 'admin@example.test',
    phone: '+506 2222 0000',
    plan: 'pro',
    onboardingCompleted: true,
    subscription: null,
    branches: []
  });
  assert.equal(Object.hasOwn(result, 'user_id'), false);
  assert.equal(Object.hasOwn(result, 'password_hash'), false);
  assert.equal(Object.hasOwn(result, 'hacienda_config'), false);
});

test('un registro sin identidad no se incluye y valores desconocidos no se inventan', () => {
  assert.equal(mapAdminRestaurantSummary({ name: 'Sin ID' }), null);
  assert.deepEqual(mapAdminRestaurantSummary({
    id: 'restaurant-2',
    name: null,
    email: null,
    phone: null,
    plan: 'enterprise',
    onboarding_completed: 'yes'
  }), {
    id: 'restaurant-2',
    name: 'Restaurante sin nombre',
    email: '',
    phone: '',
    plan: null,
    onboardingCompleted: null,
    subscription: null,
    branches: []
  });
});

test('la consulta está limitada a columnas explícitas y nunca solicita filas completas', () => {
  assert.equal(ADMIN_RESTAURANT_SELECT.includes('*'), false);
  assert.deepEqual(ADMIN_RESTAURANT_SELECT.split(','), [
    'id', 'name', 'email', 'phone', 'plan', 'onboarding_completed'
  ]);
  assert.equal(ADMIN_RESTAURANT_SELECT.includes('password_hash'), false);
  assert.equal(ADMIN_RESTAURANT_SUBSCRIPTION_SELECT, 'tenant_id,mode,plan,trial_ends_at,activated_at');
  assert.equal(ADMIN_RESTAURANT_BRANCH_SELECT, 'id,tenant_id,name,code,is_active');
  assert.equal(ADMIN_RESTAURANT_SUBSCRIPTION_SELECT.includes('user_id'), false);
  assert.equal(ADMIN_RESTAURANT_BRANCH_SELECT.includes('address'), false);
});

test('el detalle de suscripción y sucursales solo expone valores allowlisted y normalizados', () => {
  assert.deepEqual(mapAdminRestaurantSubscription({
    tenant_id: 'restaurant-1',
    mode: 'TRIAL',
    plan: 'pro',
    trial_ends_at: '2026-12-01T12:00:00.000Z',
    activated_at: null,
    user_id: 'private-owner-id'
  }), {
    tenantId: 'restaurant-1',
    subscription: {
      mode: 'TRIAL',
      plan: 'pro',
      trialEndsAt: '2026-12-01T12:00:00.000Z',
      activatedAt: null
    }
  });

  assert.deepEqual(mapAdminRestaurantSubscription({
    tenant_id: 'restaurant-2',
    mode: 'UNKNOWN',
    plan: 'enterprise',
    trial_ends_at: 'not-a-date',
    activated_at: null
  }), {
    tenantId: 'restaurant-2',
    subscription: {
      mode: null,
      plan: null,
      trialEndsAt: null,
      activatedAt: null
    }
  });

  assert.deepEqual(mapAdminRestaurantBranch({
    id: 'branch-1',
    tenant_id: 'restaurant-1',
    name: 'Sede Central',
    code: '001',
    is_active: true,
    address: 'dato omitido'
  }), {
    tenantId: 'restaurant-1',
    branch: { id: 'branch-1', name: 'Sede Central', code: '001', isActive: true }
  });
  assert.equal(mapAdminRestaurantBranch({ id: 'branch-2' }), null);
});
