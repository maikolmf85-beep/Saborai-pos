import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureTenantCashControlSetup } from '../api/_utils/tenantCashControlSetup.ts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const adminAuth = { userId: '33333333-3333-4333-8333-333333333333', role: 'ADMIN', tenantId };

function fakeAdmin(initial = {}) {
  const state = {
    pos_branches: structuredClone(initial.pos_branches || []),
    pos_cash_registers: structuredClone(initial.pos_cash_registers || []),
    pos_printers: structuredClone(initial.pos_printers || [])
  };
  const calls = [];
  let nextId = 0;

  function from(table) {
    let operation = 'select';
    let values = null;
    let options = null;
    const filters = [];
    const builder = {
      select() { return builder; },
      insert(input) { operation = 'insert'; values = input; return builder; },
      update(input) { operation = 'update'; values = input; return builder; },
      upsert(input, inputOptions) { operation = 'upsert'; values = input; options = inputOptions; return builder; },
      eq(column, value) { filters.push([column, value]); return builder; },
      maybeSingle() { return execute(true); },
      single() { return execute(false); },
      then(resolve, reject) { return execute(false).then(resolve, reject); }
    };

    async function execute(_single) {
      calls.push({ table, operation, filters: [...filters], values: structuredClone(values), options: structuredClone(options) });
      const rows = state[table].filter(row => filters.every(([column, value]) => row[column] === value));
      if (operation === 'select') {
        return { data: rows[0] || null, error: null };
      }
      if (operation === 'insert') {
        const inserted = { id: `90000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`, ...values };
        state[table].push(inserted);
        return { data: inserted, error: null };
      }
      if (operation === 'update') {
        rows.forEach(row => Object.assign(row, values));
        return { data: rows[0] || null, error: null };
      }
      if (operation === 'upsert') {
        const saved = values.map(value => {
          const existing = state[table].find(row => row.tenant_id === value.tenant_id && row.id === value.id);
          if (existing) Object.assign(existing, value);
          else state[table].push(structuredClone(value));
          return existing || value;
        });
        return { data: saved, error: null };
      }
      return { data: null, error: { message: 'Operación inesperada en el test.' } };
    }

    return builder;
  }

  return { state, calls, from };
}

function setupPayload(overrides = {}) {
  return {
    action: 'ensure-cash-control-setup',
    tenantId,
    branch: { code: '001', name: 'Sucursal Principal' },
    register: {
      name: 'Caja 01 - Principal',
      terminalCode: '00001',
      legacyId: 'caja-01',
      allowsBilling: true,
      allowsOrdering: true,
      isActive: true,
      isDefault: true,
      linkedZones: ['Principal'],
      notes: 'Terminal principal',
      sourceDeviceKey: 'test-device-key'
    },
    ...overrides
  };
}

test('rechaza sesión ausente, rol distinto de ADMIN y sesión sin tenant antes de consultar la base', async () => {
  const unauthenticated = fakeAdmin();
  assert.equal((await ensureTenantCashControlSetup(unauthenticated, null, setupPayload())).status, 401);
  assert.equal(unauthenticated.calls.length, 0);

  const cashier = fakeAdmin();
  assert.equal((await ensureTenantCashControlSetup(cashier, { ...adminAuth, role: 'CAJERO' }, setupPayload())).status, 403);
  assert.equal(cashier.calls.length, 0);

  const noTenant = fakeAdmin();
  assert.equal((await ensureTenantCashControlSetup(noTenant, { ...adminAuth, tenantId: undefined }, setupPayload())).status, 403);
  assert.equal(noTenant.calls.length, 0);
});

test('rechaza una solicitud cuyo tenant no coincide con el tenant autenticado', async () => {
  const admin = fakeAdmin();
  const result = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({ tenantId: otherTenantId }));
  assert.equal(result.status, 403);
  assert.equal(admin.calls.length, 0);
});

test('crea sucursal y caja con tenant derivado de la sesión e ignora tenant_id enviado dentro de los datos', async () => {
  const admin = fakeAdmin();
  const payload = setupPayload({
    branch: { code: '001', name: 'Sucursal Principal', tenant_id: otherTenantId },
    register: { ...setupPayload().register, tenant_id: otherTenantId }
  });

  const result = await ensureTenantCashControlSetup(admin, adminAuth, payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(admin.state.pos_branches.length, 1);
  assert.equal(admin.state.pos_cash_registers.length, 1);
  assert.equal(admin.state.pos_branches[0].tenant_id, tenantId);
  assert.equal(admin.state.pos_cash_registers[0].tenant_id, tenantId);
  assert.equal(admin.state.pos_cash_registers[0].branch_id, admin.state.pos_branches[0].id);
  assert.equal(admin.state.pos_cash_registers[0].is_default, true);
  assert.equal(admin.state.pos_cash_registers[0].legacy_id, 'caja-01');
  assert.equal(admin.state.pos_cash_registers[0].tenant_id === otherTenantId, false);
});

test('registra un ID local de impresora por tenant y lo valida antes de asignarlo', async () => {
  const admin = fakeAdmin();
  const printerId = 'prn_1700000000000';
  const result = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({
    printers: [{ id: printerId, name: 'Impresora caja', role: 'caja', enabled: true, tenant_id: otherTenantId }],
    register: { ...setupPayload().register, assignedPrinterId: printerId }
  }));

  assert.equal(result.status, 200);
  assert.equal(admin.state.pos_printers.length, 1);
  assert.equal(admin.state.pos_printers[0].tenant_id, tenantId);
  assert.equal(admin.state.pos_printers[0].id, printerId);
  assert.equal(admin.state.pos_cash_registers[0].assigned_printer_id, printerId);
  const upsert = admin.calls.find(call => call.table === 'pos_printers' && call.operation === 'upsert');
  assert.equal(upsert.values[0].tenant_id, tenantId);
  assert.equal(upsert.options.onConflict, 'tenant_id,id');
});

test('rechaza asignar una impresora que solo está registrada en otro tenant', async () => {
  const printerId = 'prn_other_tenant';
  const admin = fakeAdmin({
    pos_printers: [{ tenant_id: otherTenantId, id: printerId, name: 'Otra impresora', role: 'caja', is_active: true }]
  });
  const result = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({
    register: { ...setupPayload().register, assignedPrinterId: printerId }
  }));

  assert.equal(result.status, 409);
  assert.match(result.body.error, /no está registrada para este restaurante/);
  assert.equal(admin.state.pos_branches.length, 0);
  assert.equal(admin.state.pos_cash_registers.length, 0);
  assert.equal(admin.calls.some(call => call.operation === 'insert'), false);
});

test('no devuelve como existente una caja cuya impresora cloud no pertenece al tenant de la caja', async () => {
  const branchId = '77777777-7777-4777-8777-777777777777';
  const printerId = 'prn_cross_tenant_link';
  const admin = fakeAdmin({
    pos_branches: [{ id: branchId, tenant_id: tenantId, code: '001', name: 'Sucursal Principal' }],
    pos_cash_registers: [{
      id: '88888888-8888-4888-8888-888888888888',
      tenant_id: tenantId,
      branch_id: branchId,
      name: 'Caja 01 - Principal',
      terminal_code: '00001',
      allows_billing: true,
      allows_ordering: true,
      is_active: true,
      is_default: true,
      linked_zones: [],
      assigned_printer_id: printerId,
      notes: null,
      legacy_id: 'caja-01'
    }],
    pos_printers: [{ tenant_id: otherTenantId, id: printerId, name: 'Impresora ajena', role: 'caja', is_active: true }]
  });
  const result = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload());

  assert.equal(result.status, 409);
  assert.match(result.body.error, /no está registrada para el mismo restaurante/);
  assert.equal(admin.state.pos_cash_registers[0].assigned_printer_id, printerId);
  assert.equal(admin.calls.some(call => call.operation === 'update' || call.operation === 'insert'), false);
});

test('reintentar el onboarding devuelve la misma sucursal y caja sin duplicarlas', async () => {
  const admin = fakeAdmin();
  const first = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload());
  const writesAfterFirst = admin.calls.filter(call => call.operation === 'insert').length;
  const second = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload());

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyExists, true);
  assert.equal(admin.state.pos_branches.length, 1);
  assert.equal(admin.state.pos_cash_registers.length, 1);
  assert.equal(admin.calls.filter(call => call.operation === 'insert').length, writesAfterFirst);
});

test('rechaza reutilizar o sobrescribir una caja cuyo legacy_id pertenece a otra sucursal', async () => {
  const branchOneId = '44444444-4444-4444-8444-444444444444';
  const branchTwoId = '55555555-5555-4555-8555-555555555555';
  for (const overwriteExisting of [false, true]) {
    const admin = fakeAdmin({
      pos_branches: [
        { id: branchOneId, tenant_id: tenantId, code: '001', name: 'Sucursal 001' },
        { id: branchTwoId, tenant_id: tenantId, code: '002', name: 'Sucursal 002' }
      ],
      pos_cash_registers: [{
        id: '66666666-6666-4666-8666-666666666666',
        tenant_id: tenantId,
        branch_id: branchOneId,
        name: 'Caja original',
        terminal_code: '00001',
        allows_billing: true,
        allows_ordering: true,
        is_active: true,
        is_default: true,
        linked_zones: [],
        assigned_printer_id: null,
        notes: null,
        legacy_id: 'caja-01'
      }]
    });
    const result = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({
      branch: { code: '002', name: 'Sucursal 002' },
      register: { ...setupPayload().register, terminalCode: '00002', isDefault: false },
      overwriteExisting
    }));

    assert.equal(result.status, 409);
    assert.match(result.body.error, /otra sucursal/);
    assert.equal(admin.state.pos_cash_registers[0].branch_id, branchOneId);
    assert.equal(admin.calls.some(call => call.operation === 'insert' || call.operation === 'update'), false);
  }
});

test('valida los códigos de sucursal y caja antes de realizar escrituras', async () => {
  const admin = fakeAdmin();
  const invalidBranch = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({ branch: { code: '1', name: 'Sucursal' } }));
  assert.equal(invalidBranch.status, 400);
  assert.equal(admin.calls.length, 0);

  const invalidRegister = await ensureTenantCashControlSetup(admin, adminAuth, setupPayload({
    register: { ...setupPayload().register, terminalCode: '123' }
  }));
  assert.equal(invalidRegister.status, 400);
  assert.equal(admin.calls.length, 0);
});

test('las columnas consultadas o insertadas existen en las migraciones versionadas', async () => {
  const core = await readFile(new URL('../supabase/migrations/20261017000000_pos_core.sql', import.meta.url), 'utf8');
  const phase8 = await readFile(new URL('../supabase/migrations/20261026000000_phase8_central_cash_registers.sql', import.meta.url), 'utf8');
  const phase2 = await readFile(new URL('../supabase/migrations/20261026010000_phase2_cash_control_sync.sql', import.meta.url), 'utf8');
  const printerRegistry = await readFile(new URL('../supabase/migrations/20261106203000_pos_tenant_printer_registry.sql', import.meta.url), 'utf8');
  const printerForeignKey = await readFile(new URL('../supabase/migrations/20261106204000_pos_tenant_printer_assignment_fk.sql', import.meta.url), 'utf8');
  const branchSchema = core.split('create table if not exists public.pos_branches (')[1]?.split('\n);')[0] || '';
  const registerSchema = core.split('create table if not exists public.pos_cash_registers (')[1]?.split('\n);')[0] || '';

  for (const column of ['id', 'tenant_id', 'name', 'code', 'timezone', 'currency', 'is_active']) {
    assert.match(branchSchema, new RegExp(`\\b${column}\\b`), `columna pos_branches.${column}`);
  }
  for (const column of ['id', 'tenant_id', 'branch_id', 'name', 'terminal_code', 'allows_billing', 'allows_ordering', 'is_active']) {
    assert.match(registerSchema, new RegExp(`\\b${column}\\b`), `columna pos_cash_registers.${column}`);
  }
  for (const column of ['is_default', 'linked_zones', 'assigned_printer_id', 'notes']) {
    assert.match(phase8, new RegExp(`add column if not exists ${column}\\b`), `columna pos_cash_registers.${column}`);
  }
  for (const column of ['legacy_id', 'source_device_key']) {
    assert.match(phase2, new RegExp(`add column if not exists ${column}\\b`), `columna pos_cash_registers.${column}`);
  }
  assert.match(printerRegistry, /create table if not exists public\.pos_printers/i);
  assert.match(printerRegistry, /primary key \(tenant_id, id\)/i);
  assert.match(printerRegistry, /alter column assigned_printer_id type text/i);
  for (const expected of [
    /\('tenant_id', 'uuid'/,
    /\('id', 'string', 200\)/,
    /\('name', 'string', 120\)/,
    /\('role', 'string', 6\)/,
    /\('is_active', 'boolean'/,
    /\('updated_at', 'timestamp with time zone'/
  ]) assert.match(printerRegistry, expected);
  assert.match(printerRegistry, /i\.indisunique[\s\S]*i\.indisvalid[\s\S]*i\.indimmediate[\s\S]*i\.indpred IS NULL[\s\S]*i\.indexprs IS NULL/i);
  assert.match(printerRegistry, /ARRAY\['tenant_id', 'id'\]::text\[\]/);
  assert.match(printerRegistry, /c\.is_nullable <> 'NO'/);
  assert.match(printerRegistry, /ON CONFLICT; no se modificó/i);
  assert.ok(printerRegistry.indexOf("IF to_regclass('public.pos_printers') IS NOT NULL") < printerRegistry.indexOf('CREATE TABLE IF NOT EXISTS public.pos_printers'));
  assert.match(printerRegistry, /enable row level security/i);
  assert.match(printerRegistry, /revoke all on table public\.pos_printers from public, anon, authenticated/i);
  assert.match(printerForeignKey, /foreign key \(tenant_id, assigned_printer_id\)[\s\S]*references public\.pos_printers\(tenant_id, id\)/i);
  assert.match(printerForeignKey, /p\.tenant_id = r\.tenant_id and p\.id = r\.assigned_printer_id/i);
  assert.match(printerForeignKey, /i\.indisunique[\s\S]*i\.indisvalid[\s\S]*i\.indimmediate[\s\S]*i\.indpred IS NULL[\s\S]*i\.indexprs IS NULL/i);
  assert.match(printerForeignKey, /ARRAY\['tenant_id', 'id'\]::text\[\]/);
  assert.match(printerForeignKey, /orphan_count > 0[\s\S]*raise exception/i);
  assert.match(printerForeignKey, /position\('foreign key \(tenant_id, assigned_printer_id\)' IN lower\(existing_definition\)\)/);
  assert.match(printerForeignKey, /position\('pos_printers' IN lower\(existing_definition\)\)/);
  assert.doesNotMatch(printerForeignKey, /position\('FOREIGN KEY[^\n]*IN upper\(existing_definition\)\)/);
});

test('la ruta de onboarding exige sesión y ADMIN; el cliente envía la operación al servidor sin insertar sucursales/cajas', async () => {
  const onboarding = await readFile(new URL('../api/tenant/onboarding.ts', import.meta.url), 'utf8');
  const clientService = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');

  assert.match(onboarding, /await requireAuth\(req, res\)/);
  assert.match(onboarding, /requireRole\(auth, res, \['ADMIN'\]\)/);
  assert.match(onboarding, /body\.action === 'ensure-cash-control-setup'/);
  assert.match(onboarding, /ensureTenantCashControlSetup\(supabase, auth, body\)/);
  assert.match(onboarding, /onboarding_completed: true/);
  assert.match(clientService, /fetch\('\/api\/tenant\/onboarding'/);
  assert.match(clientService, /printers: localPrinters\.map/);
  assert.match(clientService, /assignedPrinterId: local\.assignedPrinterId \|\| null/);
  assert.doesNotMatch(clientService, /\.from\('pos_branches'\)\s*\.insert\(/);
  assert.doesNotMatch(clientService, /\.from\('pos_cash_registers'\)\s*\.insert\(/);
});
