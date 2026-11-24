import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistBranchFloorplan,
  readBranchFloorplan,
  writeBranchFloorplan
} from '../src/services/branchFloorplanService.ts';

// Valores locales ficticios: importar el handler inicializa el cliente, pero estos
// tests nunca ejecutan consultas ni conexiones a Supabase.
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY = 'branch-floorplan-test-key';
const { BranchFloorplanError, cleanBranchFloorplanPayload, isBranchFloorplanUuid, readBranchFloorplan: readServerFloorplan } = await import('../api/_utils/branchFloorplan.ts');
const { requireRole } = await import('../api/_utils/security.ts');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';

const layoutItem = (id, number, x, zone = 'Principal') => ({
  id,
  number,
  name: `Mesa ${number}`,
  zone,
  seats: 2,
  shape: 'round',
  x,
  y: 25,
  rotation: 0
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function withLocalStorage(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => key === 'saborai_token' ? 'synthetic-session-token' : null }
  });
  try { return await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

function fakeFloorplanAdmin({ ownerTenantId = TENANT_ID, branchId = BRANCH_ID, floorplan = null, floorplanError = null } = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, columns: '', filters: [] };
      queries.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        async maybeSingle() {
          const filters = new Map(query.filters);
          if (table === 'pos_branches') {
            const matches = filters.get('tenant_id') === ownerTenantId
              && filters.get('id') === branchId
              && filters.get('is_active') === true;
            return { data: matches ? { id: branchId } : null, error: null };
          }
          if (table === 'pos_branch_floorplans') {
            if (floorplanError) return { data: null, error: floorplanError };
            const matches = filters.get('tenant_id') === ownerTenantId && filters.get('branch_id') === branchId;
            return { data: matches ? floorplan : null, error: null };
          }
          assert.fail(`Unexpected table query: ${table}`);
        }
      };
      return builder;
    }
  };
}

test('valida UUID, límites de payload y geometría del plano', () => {
  assert.equal(isBranchFloorplanUuid(TENANT_ID), true);
  assert.equal(isBranchFloorplanUuid('not-a-uuid'), false);
  assert.deepEqual(cleanBranchFloorplanPayload({ zones: ['Sala', 'Terraza'], layout: [layoutItem('table-a', 1, 45)] }), {
    zones: ['Sala', 'Terraza'],
    layout: [layoutItem('table-a', 1, 45)]
  });
  assert.equal(cleanBranchFloorplanPayload({ zones: ['Sala'], layout: [{ ...layoutItem('table-a', 1, 45), tenant_id: TENANT_ID }] }), null);
  assert.equal(cleanBranchFloorplanPayload({ zones: ['Sala'], layout: [layoutItem('table-a', 1, 101)] }), null);
  assert.equal(cleanBranchFloorplanPayload({ zones: Array.from({ length: 101 }, (_, index) => `Zone ${index}`), layout: [] }), null);
});

test('el API sólo carga una sucursal activa que pertenezca al tenant autenticado', async () => {
  const admin = fakeFloorplanAdmin({ ownerTenantId: TENANT_ID });
  const record = await readServerFloorplan(admin, TENANT_ID, BRANCH_ID);
  assert.deepEqual(record, { branchId: BRANCH_ID, zones: [], layout: [], updatedAt: null });
  assert.deepEqual(admin.queries.map(query => query.table), ['pos_branches', 'pos_branch_floorplans']);
  assert.deepEqual(admin.queries[0].filters, [
    ['tenant_id', TENANT_ID],
    ['id', BRANCH_ID],
    ['is_active', true]
  ]);
  assert.deepEqual(admin.queries[1].filters, [['tenant_id', TENANT_ID], ['branch_id', BRANCH_ID]]);

  const wrongTenantAdmin = fakeFloorplanAdmin({ ownerTenantId: TENANT_ID });
  await assert.rejects(
    readServerFloorplan(wrongTenantAdmin, OTHER_TENANT_ID, BRANCH_ID),
    error => error instanceof BranchFloorplanError && error.status === 404 && error.code === 'BRANCH_NOT_AVAILABLE'
  );
  assert.deepEqual(wrongTenantAdmin.queries.map(query => query.table), ['pos_branches']);
});

test('si pos_branch_floorplans no está disponible, la lectura falla cerrada con 503', async () => {
  const admin = fakeFloorplanAdmin({ floorplanError: { code: '42P01', message: 'relation missing' } });
  await assert.rejects(
    readServerFloorplan(admin, TENANT_ID, BRANCH_ID),
    error => error instanceof BranchFloorplanError
      && error.status === 503
      && error.code === 'FLOORPLAN_STORAGE_UNAVAILABLE'
  );
});

test('sólo ADMIN puede autorizar una escritura del plano', () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  assert.equal(requireRole({ role: 'ADMIN' }, response, ['ADMIN']), true);
  assert.equal(requireRole({ role: 'CAJERO' }, response, ['ADMIN']), false);
  assert.equal(response.statusCode, 403);
  assert.match(response.body.error, /permisos/i);
});

test('el cliente llama al endpoint protegido y rechaza una respuesta de otra sucursal', async () => withLocalStorage(async () => {
  let requestedUrl = '';
  let requestedInit;
  const result = await readBranchFloorplan(TENANT_ID, BRANCH_ID, async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return jsonResponse({
      success: true,
      floorplan: { branchId: BRANCH_ID, zones: ['Sala'], layout: [layoutItem('table-a', 1, 30)], updatedAt: 'v1' }
    });
  });
  assert.equal(requestedUrl, `/api/tenant/floorplan?branchId=${BRANCH_ID}`);
  assert.equal(requestedInit.method, 'GET');
  assert.equal(requestedInit.headers.Authorization, 'Bearer synthetic-session-token');
  assert.deepEqual(result.zones, ['Sala']);

  await assert.rejects(
    readBranchFloorplan(TENANT_ID, BRANCH_ID, async () => jsonResponse({
      success: true,
      floorplan: { branchId: OTHER_TENANT_ID, zones: [], layout: [], updatedAt: null }
    })),
    /otra sucursal/
  );
}));

test('reintenta CAS tras conflicto y mezcla altas locales con cambios remotos independientes', async () => withLocalStorage(async () => {
  let current = {
    branchId: BRANCH_ID,
    zones: [],
    layout: [layoutItem('table-a', 1, 10)],
    updatedAt: 'v1'
  };
  let causedConflict = false;
  let putCount = 0;
  const request = async (url, init = {}) => {
    if (init.method === 'GET') return jsonResponse({ success: true, floorplan: current });
    assert.equal(init.method, 'PUT');
    putCount += 1;
    const body = JSON.parse(init.body);
    if (!causedConflict) {
      causedConflict = true;
      current = {
        ...current,
        zones: ['Terraza'],
        layout: [layoutItem('table-a', 1, 40)],
        updatedAt: 'v2'
      };
      return jsonResponse({
        error: 'conflict',
        code: 'FLOORPLAN_CONFLICT',
        floorplan: current
      }, 409);
    }
    assert.equal(body.expectedUpdatedAt, 'v2');
    current = {
      branchId: BRANCH_ID,
      zones: body.zones,
      layout: body.layout,
      updatedAt: 'v3'
    };
    return jsonResponse({ success: true, floorplan: current });
  };

  const saved = await persistBranchFloorplan(TENANT_ID, BRANCH_ID, {
    branchId: BRANCH_ID,
    zones: [],
    layout: [layoutItem('table-a', 1, 10)],
    updatedAt: 'v1'
  }, {
    zones: ['Patio'],
    layout: [layoutItem('table-a', 1, 10), layoutItem('table-b', 2, 70, 'Patio')]
  }, request);

  assert.equal(putCount, 2);
  assert.deepEqual(saved.zones, ['Terraza', 'Patio']);
  assert.deepEqual(saved.layout, [layoutItem('table-a', 1, 40), layoutItem('table-b', 2, 70, 'Patio')]);
  assert.equal(saved.updatedAt, 'v3');
}));

test('writeBranchFloorplan envía la sucursal y la versión base exactas al API', async () => withLocalStorage(async () => {
  let body;
  const expected = {
    branchId: BRANCH_ID,
    zones: ['Sala'],
    layout: [layoutItem('table-a', 1, 55)],
    updatedAt: 'v2'
  };
  const saved = await writeBranchFloorplan(TENANT_ID, {
    zones: expected.zones,
    layout: expected.layout,
    updatedAt: 'v2'
  }, BRANCH_ID, async (url, init) => {
    assert.equal(String(url), '/api/tenant/floorplan');
    assert.equal(init.method, 'PUT');
    body = JSON.parse(init.body);
    return jsonResponse({ success: true, floorplan: expected });
  });
  assert.deepEqual(body, {
    branchId: BRANCH_ID,
    zones: ['Sala'],
    layout: expected.layout,
    expectedUpdatedAt: 'v2'
  });
  assert.deepEqual(saved, expected);
}));
