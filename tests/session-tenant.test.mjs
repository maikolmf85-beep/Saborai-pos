import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreStoredSession } from '../src/services/sessionTenant.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

async function withFakeStorage(callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  try {
    return await callback(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
}

function createActions(fetchSession) {
  const calls = [];
  const state = {};
  const actions = {
    activeTenantIdRef: { current: 'initial-tenant' },
    setIsLoadingAuth(value) { state.isLoadingAuth = value; },
    setCurrentUser(value) { state.currentUser = value; },
    setTenant(value) { state.tenant = value; },
    setMenuItems(value) { state.menuItems = value; },
    setTables(value) { state.tables = value; },
    setStaffList(value) { state.staff = value; },
    setSubscription(value) { state.subscription = value; },
    persistSubscription(value, tenantId) { calls.push(['persistSubscription', value, tenantId]); },
    normalizeTablePositions(value) { return value.map(table => ({ ...table, normalized: true })); },
    setLocalDbTenant(tenantId) { calls.push(['setLocalDbTenant', tenantId]); },
    activateTenant(tenantId) { calls.push(['activateTenant', tenantId]); },
    resumePendingSync(tenantId) { calls.push(['resumePendingSync', tenantId]); },
    fetchSession
  };
  return { actions, calls, state };
}

function successfulAuthResponse(overrides = {}) {
  const tenantId = '123e4567-e89b-42d3-a456-426614174000';
  return {
    success: true,
    accountUserId: 'owner-from-server',
    employeeSession: true,
    employeeId: 'employee-from-server',
    user: {
      id: 'effective-user',
      name: 'Ana Rojas',
      email: 'ana@example.cr',
      phone: '+506 8000-0000',
      restaurant_name: 'Restaurante',
      role: 'CAJERO',
      active: true
    },
    tenant: {
      id: tenantId,
      name: 'Restaurante',
      cedula_juridica: '3-101-123456',
      email: 'owner@example.cr',
      phone: '+506 2222-0000',
      location: 'San José',
      plan: 'pro',
      status: 'ACTIVE',
      currency: 'CRC',
      monthly_fee: 48000,
      onboardingCompleted: true,
      zones: ['Salón remoto']
    },
    subscription: { mode: 'TRIAL', activated_at: '2026-11-01T00:00:00.000Z', trial_ends_at: '2026-11-15T00:00:00.000Z' },
    ...overrides
  };
}

test('arranque local de demo omite la validación remota y termina la carga', async () => {
  await withFakeStorage(async storage => {
    storage.setItem('saborai_active_tenant_id', 'tenant_demo_1700000000000');
    storage.setItem('saborai_token', 'token-demo-obsoleto');
    let fetchCalls = 0;
    const { actions, state, calls } = createActions(async () => { fetchCalls += 1; throw new Error('unexpected fetch'); });

    await restoreStoredSession(actions);

    assert.equal(fetchCalls, 0);
    assert.equal(state.isLoadingAuth, false);
    assert.deepEqual(calls, []);
    assert.equal(storage.getItem('saborai_token'), 'token-demo-obsoleto');
  });
});

test('sin token no llama al backend ni altera la identidad persistida', async () => {
  await withFakeStorage(async storage => {
    storage.setItem('saborai_user', JSON.stringify({ id: 'cached-user', role: 'ADMIN' }));
    let fetchCalls = 0;
    const { actions, state, calls } = createActions(async () => { fetchCalls += 1; throw new Error('unexpected fetch'); });

    await restoreStoredSession(actions);

    assert.equal(fetchCalls, 0);
    assert.equal(state.isLoadingAuth, false);
    assert.deepEqual(calls, []);
    assert.equal(storage.getItem('saborai_user'), JSON.stringify({ id: 'cached-user', role: 'ADMIN' }));
  });
});

test('restaura identidad del backend, tenant aislado, suscripción y padrón sin PIN en sesión de empleado', async () => {
  await withFakeStorage(async storage => {
    const payload = successfulAuthResponse();
    const tenantId = payload.tenant.id;
    storage.setItem('saborai_token', 'valid-token');
    storage.setItem('saborai_user', JSON.stringify({ id: 'stale-user', role: 'ADMIN' }));
    storage.setItem(`saborai:tenant:${tenantId}:tenant_profile`, JSON.stringify({
      id: tenantId,
      cedulaJuridica: 'cached-cédula',
      taxRegime: 'SIMPLIFIED',
      includeService10ByDefault: false,
      zones: ['Zona del perfil viejo'],
      menuCategories: ['Postres'],
      haciendaConfig: { atvUsername: 'private-user', atvPassword: 'private-password', pinP12: '1234', p12Base64: 'private-cert', activityCode: '561001' }
    }));
    storage.setItem(`saborai:tenant:${tenantId}:zones`, JSON.stringify(['Zona local']));
    storage.setItem(`saborai:tenant:${tenantId}:menu`, JSON.stringify([{ id: 'menu-1', name: 'Café' }]));
    storage.setItem(`saborai:tenant:${tenantId}:tables`, JSON.stringify([{ id: 'table-1', x: 10, y: 20 }]));
    storage.setItem(`saborai:tenant:${tenantId}:staff`, JSON.stringify([
      { id: 'staff-1', name: 'Ana', role: 'CAJERO', pin: '4321' }
    ]));
    let request;
    const { actions, calls, state } = createActions(async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => payload };
    });

    await restoreStoredSession(actions);

    assert.equal(request.url, '/api/auth/me');
    assert.equal(request.options.headers.Authorization, 'Bearer valid-token');
    assert.equal(state.currentUser.id, 'effective-user');
    assert.equal(state.currentUser.role, 'CAJERO');
    assert.equal(storage.getItem('saborai_user'), JSON.stringify(state.currentUser));
    assert.equal(state.tenant.id, tenantId);
    assert.equal(state.tenant.taxRegime, 'SIMPLIFIED');
    assert.equal(state.tenant.includeService10ByDefault, false);
    assert.deepEqual(state.tenant.zones, ['Salón remoto']);
    assert.deepEqual(state.tenant.menuCategories, ['Postres']);
    assert.equal(state.tenant.haciendaConfig.atvUsername, undefined);
    assert.equal(state.tenant.haciendaConfig.atvPassword, undefined);
    assert.equal(state.tenant.haciendaConfig.pinP12, undefined);
    assert.equal(state.tenant.haciendaConfig.p12Base64, undefined);
    assert.equal(state.tenant.haciendaConfig.activityCode, '561001');
    assert.deepEqual(state.menuItems, [{ id: 'menu-1', name: 'Café' }]);
    assert.deepEqual(state.tables, [{ id: 'table-1', x: 10, y: 20, normalized: true }]);
    assert.deepEqual(state.staff, [{ id: 'staff-1', name: 'Ana', role: 'CAJERO' }]);
    assert.equal(JSON.parse(storage.getItem(`saborai:tenant:${tenantId}:staff`))[0].pin, undefined);
    assert.deepEqual(state.subscription, {
      mode: 'TRIAL',
      email: 'ana@example.cr',
      activatedAt: '2026-11-01T00:00:00.000Z',
      trialEndsAt: '2026-11-15T00:00:00.000Z'
    });
    assert.equal(storage.getItem('saborai_account_user_id'), 'owner-from-server');
    assert.equal(storage.getItem('saborai_employee_id'), 'employee-from-server');
    assert.equal(actions.activeTenantIdRef.current, tenantId);
    assert.equal(state.isLoadingAuth, false);
    assert.deepEqual(calls.map(call => call[0]), [
      'setLocalDbTenant', 'activateTenant', 'persistSubscription', 'resumePendingSync'
    ]);
    assert.deepEqual(calls.filter(call => call[0] !== 'persistSubscription').map(call => call[1]), [tenantId, tenantId, tenantId]);
    assert.equal(calls[2][2], tenantId);
  });
});

test('rechaza un token inválido y limpia solo las claves de sesión autenticada', async () => {
  await withFakeStorage(async storage => {
    storage.setItem('saborai_token', 'expired-token');
    storage.setItem('saborai_account_user_id', 'cached-account');
    storage.setItem('saborai_employee_id', 'cached-employee');
    storage.setItem('saborai_user', JSON.stringify({ id: 'cached-user' }));
    storage.setItem('saborai_tenant', JSON.stringify({ id: 'cached-tenant' }));
    const { actions, calls, state } = createActions(async () => ({
      ok: false,
      json: async () => ({ success: false })
    }));

    await restoreStoredSession(actions);

    assert.equal(storage.getItem('saborai_token'), null);
    assert.equal(storage.getItem('saborai_account_user_id'), null);
    assert.equal(storage.getItem('saborai_employee_id'), null);
    assert.notEqual(storage.getItem('saborai_user'), null);
    assert.notEqual(storage.getItem('saborai_tenant'), null);
    assert.equal(state.isLoadingAuth, false);
    assert.deepEqual(calls, []);
  });
});
