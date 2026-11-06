import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assignCashTerminal,
  assertCashRegisterOpenForPayment,
  buildCashShiftClosePayload,
  closeCashShift,
  closeDailyCash,
  DailyCashClosedError,
  DailyCashNotOpenError,
  getBusinessDateForInstant,
  getDailyCashStatus,
  importCashShift,
  openDailyCash,
  reassignCashTerminal
} from '../api/_utils/cashControlSync.ts';
import { hasRolePermission, ROLE_PERMISSIONS } from '../api/_utils/rolePermissions.ts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const shiftId = '33333333-3333-4333-8333-333333333333';
const registerId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const deviceKey = 'dev_1234567890abcdef';

function mockAdmin(responses, rpcResponses = []) {
  const calls = [];
  const admin = {
    async rpc(functionName, args) {
      const call = { rpc: functionName, method: 'rpc', values: args };
      calls.push(call);
      const response = rpcResponses[calls.filter(item => item.method === 'rpc').length - 1] || { data: null, error: null };
      return typeof response === 'function' ? response(call) : response;
    },
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

test('cierra un turno por RPC transaccional después de resolver su ID en el tenant autenticado', async () => {
  const { admin, calls } = mockAdmin(
    [{ data: { id: shiftId, status: 'OPEN' }, error: null }],
    [{ data: { shiftId, closedAt: '2026-11-05T15:00:00.000Z', summary: { cashSales: 2500 }, alreadyClosed: false }, error: null }]
  );
  const result = await closeCashShift(admin, tenantId, actorId, validCloseInput());
  assert.equal(result.shiftId, shiftId);
  assert.equal(result.updated, true);
  assert.equal(result.alreadyClosed, false);
  assert.deepEqual(result.summary, { cashSales: 2500 });
  assert.equal(calls[0].table, 'pos_cash_shifts');
  assert.equal(calls[0].method, null);
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['id', shiftId]]);
  assert.equal(calls[1].rpc, 'pos_close_cash_shift');
  assert.equal(calls[1].values.p_tenant_id, tenantId);
  assert.equal(calls[1].values.p_shift_id, shiftId);
  assert.equal(calls[1].values.p_closed_by, actorId);
  assert.equal(calls[1].values.p_counted_cash, 12400);
});

test('un reintento de cierre devuelve el turno ya cerrado desde la RPC', async () => {
  const sameActor = mockAdmin(
    [{ data: { id: shiftId, status: 'CLOSED' }, error: null }],
    [{ data: { shiftId, alreadyClosed: true, summary: { cashSales: 2500 } }, error: null }]
  );
  const result = await closeCashShift(sameActor.admin, tenantId, actorId, validCloseInput());
  assert.equal(result.updated, false);
  assert.equal(result.alreadyClosed, true);
  assert.deepEqual(result.summary, { cashSales: 2500 });
  assert.equal(sameActor.calls[1].rpc, 'pos_close_cash_shift');
});

test('resuelve IDs locales de turno por legacy_id y rechaza formatos inseguros', async () => {
  const localId = mockAdmin(
    [{ data: { id: shiftId, status: 'OPEN' }, error: null }],
    [{ data: { shiftId, alreadyClosed: false }, error: null }]
  );
  await closeCashShift(localId.admin, tenantId, actorId, { ...validCloseInput(), shiftId: 'local-shift-8' });
  assert.deepEqual(localId.calls[0].filters, [['tenant_id', tenantId], ['legacy_id', 'local-shift-8']]);

  const { admin, calls } = mockAdmin([]);
  await assert.rejects(closeCashShift(admin, tenantId, actorId, { ...validCloseInput(), shiftId: 'invalid/id' }), /formato inválido/i);
  assert.equal(calls.length, 0);
});

test('cierra una vez por caja y fecha local, con validación del servidor', async () => {
  const closure = {
    closureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cashRegisterId: registerId,
    businessDate: '2026-11-05',
    closedAt: '2026-11-06T05:00:00.000Z',
    summary: { totalSales: 5000 },
    alreadyClosed: false
  };
  const { admin, calls } = mockAdmin(
    [{ data: { id: registerId }, error: null }],
    [{ data: closure, error: null }]
  );
  assert.deepEqual(await closeDailyCash(admin, tenantId, actorId, { registerId, businessDate: '2026-11-05' }), closure);
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['is_active', true], ['id', registerId]]);
  assert.equal(calls[1].rpc, 'pos_close_daily_cash');
  assert.equal(calls[1].values.p_cash_register_id, registerId);
  assert.equal(calls[1].values.p_business_date, '2026-11-05');
  assert.equal(calls[1].values.p_closed_by, actorId);

  const invalid = mockAdmin([]);
  await assert.rejects(closeDailyCash(invalid.admin, tenantId, actorId, { registerId, businessDate: '2026-02-30' }), /YYYY-MM-DD/i);
  assert.equal(invalid.calls.length, 0);
});

test('abre la caja una vez por RPC con caja, tenant y responsable autenticado', async () => {
  const resultFromServer = {
    openingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cashRegisterId: registerId,
    businessDate: '2026-11-06',
    timezone: 'America/Costa_Rica',
    openedAt: '2026-11-06T14:00:00.000Z',
    alreadyOpened: false
  };
  const { admin, calls } = mockAdmin(
    [{ data: { id: registerId }, error: null }],
    [{ data: resultFromServer, error: null }]
  );
  assert.deepEqual(await openDailyCash(admin, tenantId, actorId, { registerId }), resultFromServer);
  assert.deepEqual(calls[0].filters, [['tenant_id', tenantId], ['is_active', true], ['id', registerId]]);
  assert.equal(calls[1].rpc, 'pos_open_daily_cash');
  assert.deepEqual(calls[1].values, {
    p_tenant_id: tenantId,
    p_cash_register_id: registerId,
    p_opened_by: actorId
  });
  const closed = mockAdmin(
    [{ data: { id: registerId }, error: null }],
    [{ data: null, error: { message: 'DAILY_CASH_CLOSED|La caja ya cerró el día.' } }]
  );
  await assert.rejects(openDailyCash(closed.admin, tenantId, actorId, { registerId }), error =>
    error instanceof DailyCashClosedError && /ya cerró el día/.test(error.message)
  );
});

test('consulta el estado diario por la fecha local devuelta por la sucursal', async () => {
  const now = new Date().toISOString();
  const expectedDate = getBusinessDateForInstant(now, 'America/Costa_Rica');
  const { admin, calls } = mockAdmin([
    { data: { id: registerId, branch_id: branchId, name: 'Caja Principal' }, error: null },
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: { id: 'daily-opening', opened_at: now, opened_by: actorId, timezone: 'America/Costa_Rica' }, error: null },
    { data: null, error: null }
  ]);
  const status = await getDailyCashStatus(admin, tenantId, { registerId });
  assert.equal(status.isOpen, true);
  assert.equal(status.isClosed, false);
  assert.equal(status.businessDate, expectedDate);
  assert.equal(status.openedBy, actorId);
  assert.deepEqual(calls[2].filters, [
    ['tenant_id', tenantId], ['branch_id', branchId], ['cash_register_id', registerId], ['business_date', expectedDate]
  ]);
  assert.equal(calls[3].table, 'pos_daily_cash_closures');
});

test('rechaza un cobro en línea de caja/fecha local ya cerrada con mensaje claro', async () => {
  const { admin, calls } = mockAdmin([
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: { id: 'daily-closure' }, error: null }
  ]);
  await assert.rejects(
    assertCashRegisterOpenForPayment(admin, tenantId, branchId, registerId, 'Caja Principal', '2026-11-05T18:00:00.000Z'),
    error => error instanceof DailyCashClosedError
      && error.code === 'DAILY_CASH_CLOSED'
      && /Caja Principal/.test(error.message)
      && /2026-11-05/.test(error.message)
      && /contacte al administrador/i.test(error.message)
  );
  assert.deepEqual(calls[1].filters, [
    ['tenant_id', tenantId],
    ['branch_id', branchId],
    ['cash_register_id', registerId],
    ['business_date', '2026-11-05']
  ]);
});

test('rechaza un cobro del día si falta la apertura diaria de caja', async () => {
  const { admin, calls } = mockAdmin([
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  await assert.rejects(
    assertCashRegisterOpenForPayment(admin, tenantId, branchId, registerId, 'Caja Principal', '2026-11-06T18:00:00.000Z'),
    error => error instanceof DailyCashNotOpenError
      && error.code === 'DAILY_CASH_NOT_OPEN'
      && /Caja Principal/.test(error.message)
      && /2026-11-06/.test(error.message)
  );
  assert.equal(calls[2].table, 'pos_daily_cash_openings');
});

test('rechaza el cobro offline si su instante es anterior a la apertura diaria', async () => {
  const { admin } = mockAdmin([
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: null, error: null },
    { data: { id: 'daily-opening', opened_at: '2026-11-06T17:00:00.000Z' }, error: null }
  ]);
  await assert.rejects(
    assertCashRegisterOpenForPayment(admin, tenantId, branchId, registerId, 'Caja Principal', '2026-11-06T16:59:00.000Z'),
    error => error.code === 'DAILY_CASH_NOT_OPEN' && /anterior a la apertura/i.test(error.message)
  );
});

test('rechaza la sincronización tardía offline cuyo paidAt sigue perteneciendo al día local ya cerrado', async () => {
  const paidAt = '2026-11-06T05:30:00.000Z'; // 23:30 del 5 de noviembre en Costa Rica
  assert.equal(getBusinessDateForInstant(paidAt, 'America/Costa_Rica'), '2026-11-05');
  const { admin, calls } = mockAdmin([
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: { id: 'daily-closure' }, error: null }
  ]);
  await assert.rejects(
    assertCashRegisterOpenForPayment(admin, tenantId, branchId, registerId, 'Caja Principal', paidAt),
    error => error.code === 'DAILY_CASH_CLOSED' && /2026-11-05/.test(error.message)
  );
  assert.deepEqual(calls[1].filters.at(-1), ['business_date', '2026-11-05']);
});

test('el bloqueo de caja/fecha local no afecta a la misma caja en el siguiente día', async () => {
  const { admin } = mockAdmin([
    { data: { timezone: 'America/Costa_Rica' }, error: null },
    { data: null, error: null },
    { data: { id: 'daily-opening', opened_at: '2026-11-06T06:00:00.000Z' }, error: null }
  ]);
  const nextDay = await assertCashRegisterOpenForPayment(
    admin, tenantId, branchId, registerId, 'Caja Principal', '2026-11-06T06:30:00.000Z'
  );
  assert.equal(nextDay, '2026-11-06');
});

test('un reintento con todos los pagos ya aplicados evita el guard y no crea una segunda venta', async () => {
  const handler = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  const replayIndex = handler.indexOf('if (existingPayments.size === preparedPayments.length)');
  const guardIndex = handler.indexOf('assertCashRegisterOpenForPayment(supabaseAdmin');
  assert.ok(replayIndex >= 0 && guardIndex > replayIndex);
  assert.match(handler.slice(replayIndex, guardIndex), /alreadyApplied: true/);
  assert.match(handler, /DAILY_CASH_CLOSED/);
  assert.match(handler, /DAILY_CASH_NOT_OPEN/);
  const migration = await readFile(new URL('../supabase/migrations/20261105170000_shift_and_daily_cash_closures.sql', import.meta.url), 'utf8');
  assert.match(migration, /from public\.pos_cash_registers[\s\S]*for update[\s\S]*pos_daily_cash_closures/);
  assert.match(migration, /create trigger pos_payments_guard_daily_cash_closure[\s\S]*before insert or update of[\s\S]*on public\.pos_payments/i);
  assert.match(migration, /before insert or update of tenant_id, cash_shift_id, paid_at, amount, method, status on public\.pos_payments/i);
  assert.match(migration, /DAILY_CASH_CLOSED\|/);
  assert.match(handler, /typeof error\?\.code === 'string'[\s\S]*\{ code: error\.code \}/);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /\['DAILY_CASH_CLOSED', 'DAILY_CASH_NOT_OPEN'\]\.includes\(error\.code \|\| ''\)[\s\S]*return;/);
  const openingMigration = await readFile(new URL('../supabase/migrations/20261106100000_daily_cash_openings.sql', import.meta.url), 'utf8');
  assert.match(openingMigration, /create table if not exists public\.pos_daily_cash_openings/);
  assert.match(openingMigration, /unique \(tenant_id, branch_id, cash_register_id, business_date\)/);
  assert.match(openingMigration, /create trigger pos_cash_shifts_guard_daily_opening/);
  assert.match(openingMigration, /create trigger pos_payments_guard_daily_cash_opening/);
  assert.match(openingMigration, /DAILY_CASH_NOT_OPEN\|/);
  assert.match(openingMigration, /20261024020000_phase3_hacienda_history\.sql/);
});

test('pagos y comprobantes usan solo los enlaces existentes del esquema de producción', async () => {
  const handler = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/services/posCloudService.ts', import.meta.url), 'utf8');
  const sql = await readFile(new URL('../supabase/migrations/20261105170000_shift_and_daily_cash_closures.sql', import.meta.url), 'utf8');
  const syncTableStart = handler.indexOf('async function syncTable(');
  const syncTableEnd = handler.indexOf('\nasync function syncEmployeeCredit(', syncTableStart);
  assert.ok(syncTableStart >= 0 && syncTableEnd > syncTableStart);
  assert.doesNotMatch(handler.slice(syncTableStart, syncTableEnd), /\b(?:cash_register_id|terminal_id)\s*:/);
  assert.match(handler, /\.select\('id, branch_id, status'\)/);
  const paymentInsertStart = handler.indexOf("const paymentResult = await supabaseAdmin\n      .from('pos_payments')");
  const paymentInsertEnd = handler.indexOf('if (paymentResult.error', paymentInsertStart);
  assert.ok(paymentInsertStart >= 0 && paymentInsertEnd > paymentInsertStart);
  assert.doesNotMatch(handler.slice(paymentInsertStart, paymentInsertEnd), /\b(?:branch_id|cash_register_id|terminal_id)\s*:/);
  assert.match(handler, /insert\(missingPaymentRows\)[\s\S]*select\('id, idempotency_key'\)/);
  assert.match(handler, /\.select\('id, order_id, cash_shift_id'\)/);
  assert.match(handler, /payment\.data\.order_id !== order\.id/);

  const invoiceInsertStart = handler.indexOf("const invoice = await supabaseAdmin.from('pos_invoices').insert");
  const invoiceInsertEnd = handler.indexOf('if (invoice.error', invoiceInsertStart);
  assert.ok(invoiceInsertStart >= 0 && invoiceInsertEnd > invoiceInsertStart);
  assert.match(handler.slice(invoiceInsertStart, invoiceInsertEnd), /payment_id: linkedPaymentId/);
  assert.doesNotMatch(handler.slice(invoiceInsertStart, invoiceInsertEnd), /\b(?:cash_shift_id|cash_register_id|terminal_id)\s*:/);
  assert.match(client, /paymentId: paymentResult\.paymentIds\?\.length === 1 \? paymentResult\.paymentIds\[0\] : undefined/);

  assert.doesNotMatch(sql, /p\.(?:branch_id|cash_register_id)|i\.(?:cash_shift_id|cash_register_id)/i);
  assert.doesNotMatch(sql, /phase9_operational_scope|\('pos_orders', 'cash_register_id'\)/i);
  assert.match(sql, /where tenant_id = new\.tenant_id and id = new\.cash_shift_id[\s\S]*v_shift\.cash_register_id/i);
  assert.match(sql, /join public\.pos_payments p on p\.tenant_id = i\.tenant_id and p\.id = i\.payment_id/i);
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

test('explica la colisión con otra terminal activa sin cambiar la restricción de una terminal por caja', async () => {
  const { admin } = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "pos_one_active_terminal_per_register"'
      }
    }
  ]);
  await assert.rejects(assignCashTerminal(admin, tenantId, { registerId, deviceKey }), error => {
    assert.equal(error.code, 'CASH_TERMINAL_ALREADY_ASSIGNED');
    assert.match(error.message, /otra terminal activa/i);
    return true;
  });

  const migration = await readFile(new URL('../supabase/migrations/20261026000000_phase8_central_cash_registers.sql', import.meta.url), 'utf8');
  assert.match(migration, /create unique index if not exists pos_one_active_terminal_per_register[\s\S]*?where is_active = true/i);
});

test('distingue permisos y conserva SQLSTATE/restricción cuando falla la escritura de terminal', async () => {
  const permissionFailure = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    { data: null, error: { code: '42501', message: 'permission denied for table pos_terminals' } }
  ]);
  await assert.rejects(assignCashTerminal(permissionFailure.admin, tenantId, { registerId, deviceKey }), error => {
    assert.equal(error.code, 'CASH_TERMINAL_PERMISSION_DENIED');
    assert.match(error.message, /SQLSTATE 42501/);
    assert.match(error.message, /RLS/i);
    return true;
  });

  const otherFailure = mockAdmin([
    { data: { id: registerId, branch_id: branchId, is_active: true }, error: null },
    {
      data: null,
      error: {
        code: '23503',
        message: 'insert or update violates foreign key constraint "pos_terminals_branch_id_fkey"',
        details: 'sensitive row detail is not shown to the user'
      }
    }
  ]);
  await assert.rejects(assignCashTerminal(otherFailure.admin, tenantId, { registerId, deviceKey }), error => {
    assert.equal(error.code, 'CASH_TERMINAL_ASSIGNMENT_FAILED');
    assert.match(error.message, /SQLSTATE 23503/);
    assert.match(error.message, /pos_terminals_branch_id_fkey/);
    assert.doesNotMatch(error.message, /sensitive row detail/i);
    return true;
  });
});

test('reasigna una terminal solo con confirmación y envía al servidor el tenant y las identidades validadas', async () => {
  const terminalId = '66666666-6666-4666-8666-666666666666';
  const { admin, calls } = mockAdmin([], [{
    data: {
      terminalId: '77777777-7777-4777-8777-777777777777',
      deactivatedTerminalId: terminalId,
      registerId,
      assigned: true,
      alreadyAssigned: false
    },
    error: null
  }]);
  const result = await reassignCashTerminal(admin, tenantId, {
    previousTerminalId: terminalId,
    registerId,
    deviceKey,
    deviceName: 'POS de caja 2',
    confirmed: true,
    tenantId: 'attacker-tenant'
  });
  assert.equal(result.assigned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rpc, 'pos_reassign_cash_terminal');
  assert.deepEqual(calls[0].values, {
    p_tenant_id: tenantId,
    p_previous_terminal_id: terminalId,
    p_register_id: registerId,
    p_device_key: deviceKey,
    p_device_name: 'POS de caja 2',
    p_confirmed: true
  });
});

test('no permite reasignar sin confirmación y mapea el turno abierto a un bloqueo seguro', async () => {
  const terminalId = '66666666-6666-4666-8666-666666666666';
  const notConfirmed = mockAdmin([]);
  await assert.rejects(reassignCashTerminal(notConfirmed.admin, tenantId, {
    previousTerminalId: terminalId, registerId, deviceKey, confirmed: false
  }), error => error.code === 'CASH_TERMINAL_CONFIRMATION_REQUIRED');
  assert.equal(notConfirmed.calls.length, 0);

  const openShift = mockAdmin([], [{
    data: null,
    error: { code: 'P0001', message: 'CASH_TERMINAL_OPEN_SHIFT|La caja tiene un turno abierto.' }
  }]);
  await assert.rejects(reassignCashTerminal(openShift.admin, tenantId, {
    previousTerminalId: terminalId, registerId, deviceKey, confirmed: true
  }), error => {
    assert.equal(error.code, 'CASH_TERMINAL_OPEN_SHIFT');
    assert.match(error.message, /turno abierto/i);
    return true;
  });
});

test('la migración atómica conserva la regla de terminal única y no modifica pagos ni cierres', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261106120000_safe_cash_terminal_reassignment.sql', import.meta.url), 'utf8');
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /pos_one_active_terminal_per_register/);
  assert.match(migration, /pos_one_open_shift_per_register/);
  assert.match(migration, /from public\.pos_cash_registers[\s\S]*?for update/i);
  assert.match(migration, /s\.status = 'OPEN'/);
  assert.match(migration, /update public\.pos_terminals[\s\S]*?set is_active = false/i);
  assert.match(migration, /on conflict \(tenant_id, device_key\) do update/i);
  assert.match(migration, /revoke all on function[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*?to service_role/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:pos_payments|pos_daily_cash_closures|pos_daily_cash_openings)/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.pos_cash_shifts/i);
});

test('el permiso de caja no se concede a roles sin caja y el handler enruta acciones autenticadas', async () => {
  for (const action of ['CLOSE_CASH_SHIFT', 'CLOSE_DAILY_CASH', 'GET_DAILY_CASH_STATUS', 'OPEN_DAILY_CASH', 'IMPORT_CASH_SHIFT', 'ASSIGN_CASH_TERMINAL', 'REASSIGN_CASH_TERMINAL']) {
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
  assert.match(handler, /CLOSE_DAILY_CASH/);
  assert.match(handler, /GET_DAILY_CASH_STATUS/);
  assert.match(handler, /OPEN_DAILY_CASH/);
  assert.match(handler, /IMPORT_CASH_SHIFT/);
  assert.match(handler, /ASSIGN_CASH_TERMINAL/);
  assert.match(handler, /REASSIGN_CASH_TERMINAL/);
  assert.match(handler, /reassignCashTerminal\(supabaseAdmin, tenantId, body\.payload\)/);
});

test('el cliente envía las escrituras por el endpoint seguro y no escribe directamente en las tablas protegidas', async () => {
  const client = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');
  assert.match(client, /syncOperation<Record<string, any>>\([\s\S]*?'CLOSE_CASH_SHIFT'/);
  assert.match(client, /'IMPORT_CASH_SHIFT'/);
  assert.match(client, /'GET_DAILY_CASH_STATUS'/);
  assert.match(client, /'OPEN_DAILY_CASH'/);
  assert.match(client, /syncOperation\('ASSIGN_CASH_TERMINAL'/);
  assert.match(client, /syncOperation\('REASSIGN_CASH_TERMINAL'/);
  assert.doesNotMatch(client, /from\(['"]pos_cash_shifts['"]\)\s*\.(?:insert|update|upsert)/);
  assert.doesNotMatch(client, /from\(['"]pos_terminals['"]\)\s*\.(?:insert|update|upsert)/);
  const modal = await readFile(new URL('../src/components/CashShiftModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /'CLOSE_DAILY_CASH'/);
  const quickPayment = await readFile(new URL('../src/components/QuickPaymentModal.tsx', import.meta.url), 'utf8');
  assert.match(quickPayment, /shouldCloseOrderAfterPayment\(rawItems, subAccountId\)/);
  assert.match(quickPayment, /closeOrder/);
});

test('el pago rápido verifica apertura diaria antes de registrar ventas y mantiene un estado cacheado para efectivo offline', async () => {
  const quickPayment = await readFile(new URL('../src/components/QuickPaymentModal.tsx', import.meta.url), 'utf8');
  const preflight = quickPayment.indexOf('getDailyCashStatus(tenant.id, currentRegister.id)');
  const localSale = quickPayment.indexOf('cashShiftService.recordSalePayment');
  assert.ok(preflight >= 0 && localSale > preflight);
  assert.match(quickPayment, /getCachedDailyCashStatus\(tenant\.id, currentRegister\.id\)/);
  assert.match(quickPayment, /isDailyCashStatusForCurrentDate\(dailyCashStatus\)/);
  const service = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');
  assert.match(service, /cacheDailyCashStatus\(tenantId, registerId, status\)/);
  assert.match(service, /getCachedDailyCashStatus\(tenantId: string, registerId: string\)/);
});

test('la interfaz exige confirmación de que la terminal anterior está apagada y sus cobros sincronizados', async () => {
  const settings = await readFile(new URL('../src/components/SettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(settings, /checked=\{terminalReleaseConfirmed\}/);
  assert.match(settings, /disabled=\{cloudMigrationBusy \|\| !terminalReleaseConfirmed\}/);
  assert.match(settings, /terminal anterior está fuera de servicio y que todos sus cobros pendientes ya se sincronizaron/i);
  assert.match(settings, /no puede revisar la cola de cobros offline del otro dispositivo/i);
  assert.match(settings, /reassignTerminal\(tenant\.id, cloudTerminalConflict\)/);
});
