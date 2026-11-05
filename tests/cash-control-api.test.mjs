import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assignCashTerminal,
  buildCashShiftClosePayload,
  closeCashShift,
  importCashShift
} from '../api/_utils/cashControlSync.ts';
import { hasRolePermission, ROLE_PERMISSIONS } from '../api/_utils/rolePermissions.ts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const shiftId = '33333333-3333-4333-8333-333333333333';
const registerId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const deviceKey = 'dev_1234567890abcdef';

function mockAdmin(responses) {
  const calls = [];
  const admin = {
    from(table) {
      const call = { table, method: null, values: null, options: null, filters: [], selection: null, limit: null };
      calls.push(call);
      const response = responses[calls.length - 1] || { data: null, error: null };
      const builder = {
        select(columns) { call.selection = columns; return builder; },
        update(values) { call.method = 'update'; call.values = values; return builder; },
        insert(values) { call.method = 'insert'; call.values = values; return builder; },
        upsert(values, options) { call.method = 'upsert'; call.values = values; call.options = options; return builder; },
        eq(column, value) { call.filters.push([column, value]); return builder; },
        limit(value) { call.limit = value; return builder; },
        async maybeSingle() { return typeof response === 'function' ? response(call, 'maybeSingle') : response; },
        async single() { return typeof response === 'function' ? response(call, 'single') : response; }
      };
      return builder;
    }
  };
  return { admin, calls };
}

function sampleShift(overrides = {}) {
  return {
    id: 'local-shift-8',
    shiftNumber: 8,
    status: 'OPEN',
    openedAt: '2026-11-05T14:00:00.000Z',
    initialCashFloat: 10000,
    notes: 'Turno de prueba',
    participants: [],
    movements: [],
    systemSummary: { expectedCashInDrawer: 12500, cashSales: 2500 },
    ...overrides
  };
}

function validCloseInput(overrides = {}) {
  return {
    shiftId,
    closure: {
      status: 'OPEN',
      closed_by: '99999999-9999-4999-8999-999999999999',
      legacy_id: 'local-shift-8',
      expected_cash: 12500,
      counted_cash: 12400,
      difference: -100,
      closed_at: '2026-11-05T15:00:00.000Z',
      participants: [],
      movements: [],
      system_summary: { expectedCashInDrawer: 12500 },
      ...overrides
    }
  };
}

test('normaliza el cierre y deriva closed_by del usuario autenticado, no del navegador', () => {
  const payload = buildCashShiftClosePayload(actorId, validCloseInput().closure);
  assert.equal(payload.status, 'CLOSED');
  assert.equal(payload.closed_by, actorId);
  assert.equal(payload.counted_cash, 12400);
  assert.equal('tenant_id' in payload, false);
  assert.throws(() => buildCashShiftClosePayload(actorId, { counted_cash: '12400' }), /número/);
  assert.throws(() => buildCashShiftClosePayload(actorId, { movements: [{}], notes: 'x'.repeat(4001) }), /notas/i);
});

test('cierra solo un turno OPEN del tenant autenticado con actualización condicional', async () => {
  const { admin, calls } = mockAdmin([{ data: { id: shiftId }, error: null }]);
  const result = await closeCashShift(admin, tenantId, actorId, validCloseInput());
  assert.deepEqual(result, { shiftId, updated: true, alreadyClosed: false });
  assert.equal(calls[0].table, 'pos_cash_shifts');
  assert.equal(calls[0].method, 'update');
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['id', shiftId], ['status', 'OPEN']]);
  assert.equal(calls[0].values.status, 'CLOSED');
  assert.equal(calls[0].values.closed_by, actorId);
  assert.equal(calls[0].values.tenant_id, undefined);
});

test('un reintento de cierre del mismo actor es idempotente; otro cierre no autorizado falla', async () => {
  const sameActor = mockAdmin([
    { data: null, error: null },
    { data: { id: shiftId, status: 'CLOSED', closed_by: actorId }, error: null }
  ]);
  assert.deepEqual(await closeCashShift(sameActor.admin, tenantId, actorId, validCloseInput()), {
    shiftId, updated: false, alreadyClosed: true
  });
  assert.deepEqual(sameActor.calls[1].filters, [['tenant_id', tenantId], ['id', shiftId]]);

  const otherActor = mockAdmin([
    { data: null, error: null },
    { data: { id: shiftId, status: 'CLOSED', closed_by: '66666666-6666-4666-8666-666666666666' }, error: null }
  ]);
  await assert.rejects(closeCashShift(otherActor.admin, tenantId, actorId, validCloseInput()), /no está abierto/i);
});

test('rechaza IDs de turno inválidos antes de consultar la base', async () => {
  const { admin, calls } = mockAdmin([]);
  await assert.rejects(closeCashShift(admin, tenantId, actorId, { ...validCloseInput(), shiftId: 'not-a-uuid' }), /UUID/i);
  assert.equal(calls.length, 0);
});

test('importa un turno usando tenant y sucursal obtenidos por el servidor', async () => {
  const { admin, calls } = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: { id: shiftId }, error: null }
  ]);
  const result = await importCashShift(admin, tenantId, {
    tenantId: 'attacker-tenant',
    cashRegisterId: registerId,
    deviceKey,
    shift: sampleShift()
  });
  assert.deepEqual(result, { shiftId, alreadyExists: false });
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['id', registerId]]);
  assert.deepEqual(calls[2].filters, [['tenant_id', tenantId], ['cash_register_id', registerId], ['status', 'OPEN']]);
  assert.equal(calls[3].method, 'insert');
  assert.equal(calls[3].values.tenant_id, tenantId);
  assert.equal(calls[3].values.branch_id, branchId);
  assert.equal(calls[3].values.cash_register_id, registerId);
  assert.equal(calls[3].values.source_device_key, deviceKey);
  assert.equal(calls[3].values.tenantId, undefined);
});

test('no inserta un segundo turno abierto para la misma caja', async () => {
  const { admin, calls } = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: null, error: null },
    { data: { id: 'existing-open-shift' }, error: null }
  ]);
  await assert.rejects(importCashShift(admin, tenantId, {
    cashRegisterId: registerId, deviceKey, shift: sampleShift()
  }), /ya tiene un turno abierto/i);
  assert.equal(calls.some(call => call.method === 'insert'), false);
});

test('reutiliza el turno ya importado solo si pertenece a la misma caja', async () => {
  const sameRegister = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: { id: shiftId, cash_register_id: registerId }, error: null }
  ]);
  assert.deepEqual(await importCashShift(sameRegister.admin, tenantId, {
    cashRegisterId: registerId, deviceKey, shift: sampleShift()
  }), { shiftId, alreadyExists: true });
  assert.equal(sameRegister.calls.length, 2);

  const otherRegister = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: { id: shiftId, cash_register_id: '77777777-7777-4777-8777-777777777777' }, error: null }
  ]);
  await assert.rejects(importCashShift(otherRegister.admin, tenantId, {
    cashRegisterId: registerId, deviceKey, shift: sampleShift()
  }), /otra caja/i);
});

test('asigna el dispositivo solo a una caja activa del tenant y deriva sucursal en servidor', async () => {
  const { admin, calls } = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: { id: '88888888-8888-4888-8888-888888888888' }, error: null }
  ]);
  const result = await assignCashTerminal(admin, tenantId, {
    tenantId: 'attacker-tenant', branchId: 'attacker-branch', registerId, deviceKey, deviceName: 'POS navegador'
  });
  assert.equal(result.assigned, true);
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['id', registerId]]);
  assert.equal(calls[1].table, 'pos_terminals');
  assert.equal(calls[1].method, 'upsert');
  assert.equal(calls[1].options.onConflict, 'tenant_id,device_key');
  assert.equal(calls[1].values.tenant_id, tenantId);
  assert.equal(calls[1].values.branch_id, branchId);
  assert.equal(calls[1].values.cash_register_id, registerId);
  assert.equal(calls[1].values.device_key, deviceKey);
});

test('el permiso de caja no se concede a roles sin caja y el handler enruta acciones autenticadas', async () => {
  for (const action of ['CLOSE_CASH_SHIFT', 'IMPORT_CASH_SHIFT', 'ASSIGN_CASH_TERMINAL']) {
    assert.equal(hasRolePermission('ADMIN', ROLE_PERMISSIONS.offlineSync[action]), true);
    assert.equal(hasRolePermission('CAJERO', ROLE_PERMISSIONS.offlineSync[action]), true);
    assert.equal(hasRolePermission('SALONERO_CAJA', ROLE_PERMISSIONS.offlineSync[action]), true);
    assert.equal(hasRolePermission('WAITER', ROLE_PERMISSIONS.offlineSync[action]), false);
  }
  const handler = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  assert.match(handler, /requireAuth\(req, res\)/);
  assert.match(handler, /tenantId !== auth\.tenantId/);
  assert.match(handler, /employeeSessionActorMatches\(/);
  assert.match(handler, /CLOSE_CASH_SHIFT/);
  assert.match(handler, /IMPORT_CASH_SHIFT/);
  assert.match(handler, /ASSIGN_CASH_TERMINAL/);
});

test('el cliente envía las escrituras por el endpoint seguro y no escribe directamente en las tablas protegidas', async () => {
  const client = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');
  assert.match(client, /syncOperation\('CLOSE_CASH_SHIFT'/);
  assert.match(client, /'IMPORT_CASH_SHIFT'/);
  assert.match(client, /syncOperation\('ASSIGN_CASH_TERMINAL'/);
  assert.doesNotMatch(client, /from\(['"]pos_cash_shifts['"]\)\s*\.(?:insert|update|upsert)/);
  assert.doesNotMatch(client, /from\(['"]pos_terminals['"]\)\s*\.(?:insert|update|upsert)/);
});
