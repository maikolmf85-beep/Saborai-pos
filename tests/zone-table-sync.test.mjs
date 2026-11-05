import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTenantZones,
  persistTenantZones,
  removeTenantZone,
  resolveRealtimeTenantZones,
  resolveTenantZones
} from '../src/services/tenantZones.ts';
import { canRespondToRealtimeSync, readTableSnapshot, resolveRealtimeTablePayload, resolveRealtimeTables } from '../src/services/tableSync.ts';
import { validateTableLayout } from '../src/services/tableLayoutValidation.ts';
import { mergeConcurrentTableLayouts, persistTableLayoutWithClient } from '../src/services/tableLayoutConcurrency.ts';
import { cleanTenantZones, updateTenantZonesInSupabase } from '../api/_utils/tenantZones.ts';

const layoutItem = (id, x, y = 25) => ({
  id,
  number: id.charCodeAt(0) - 64,
  name: `Mesa ${id}`,
  zone: 'Principal',
  seats: 2,
  shape: 'round',
  x,
  y
});

function parseLayoutRow(row) {
  if (!row || !Array.isArray(row.layout)) return null;
  return { layout: row.layout, updatedAt: row.updated_at || null };
}

function createLayoutClient({ initialRow = null, beforeUpdate, beforeInsert } = {}) {
  const state = { row: initialRow ? structuredClone(initialRow) : null, calls: [] };
  const client = {
    from(table) {
      assert.equal(table, 'pos_table_layouts');
      const query = { action: null, values: null, filters: [] };
      const builder = {
        select(columns) {
          query.columns = columns;
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        update(values) {
          query.action = 'update';
          query.values = values;
          return this;
        },
        insert(values) {
          query.action = 'insert';
          query.values = values;
          return this;
        },
        async maybeSingle() {
          state.calls.push({ ...query, filters: [...query.filters] });
          if (query.action !== 'update') return { data: state.row ? structuredClone(state.row) : null, error: null };
          if (beforeUpdate) await beforeUpdate(state, query);
          const tenantFilter = query.filters.find(([column]) => column === 'tenant_id')?.[1];
          const updatedAtFilter = query.filters.find(([column]) => column === 'updated_at')?.[1];
          if (!state.row || tenantFilter !== state.row.tenant_id || updatedAtFilter !== state.row.updated_at) {
            return { data: null, error: null };
          }
          state.row = {
            ...state.row,
            ...query.values,
            updated_at: `t${Number(String(state.row.updated_at).slice(1)) + 1}`
          };
          return { data: structuredClone(state.row), error: null };
        },
        async single() {
          state.calls.push({ ...query, filters: [...query.filters] });
          if (query.action !== 'insert') return { data: null, error: { code: 'unexpected' } };
          if (beforeInsert) await beforeInsert(state, query);
          if (state.row) return { data: null, error: { code: '23505' } };
          state.row = { ...query.values, updated_at: 't1' };
          return { data: structuredClone(state.row), error: null };
        }
      };
      return builder;
    }
  };
  return { client, state };
}

test('el servidor confirma borrados exactos de salones, incluso la última zona vacía', async () => {
  const zones = removeTenantZone(['Principal', 'Terraza'], 'Terraza');
  const requests = [];
  const confirmed = await persistTenantZones(zones, 'mock-token', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ success: true, zones: ['Principal'] }, { status: 200 });
  });
  assert.deepEqual(confirmed, ['Principal']);
  assert.equal(requests[0].url, '/api/tenant/profile');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), { zones: ['Principal'] });

  const empty = await persistTenantZones([], 'mock-token', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { zones: [] });
    return Response.json({ success: true, zones: [] }, { status: 200 });
  });
  assert.deepEqual(empty, []);
});

test('un PATCH fallido, una respuesta malformada o una lista distinta no se consideran guardados', async () => {
  await assert.rejects(persistTenantZones([], 'token', async () =>
    Response.json({ error: 'No se pudieron guardar los salones.' }, { status: 500 })
  ), /No se pudieron guardar/);
  await assert.rejects(persistTenantZones(['Principal'], 'token', async () =>
    Response.json({ success: true, zones: ['Principal', 'Terraza'] }, { status: 200 })
  ), /lista de salones distinta/);
  await assert.rejects(persistTenantZones([], 'token', async () => new Response(null, { status: 204 })), /no confirmó/);
});

test('la actualización API confirma zona persistida y conserva filtros tenant_id y user_id', async () => {
  assert.equal(cleanTenantZones(undefined), null);
  assert.deepEqual(cleanTenantZones([]), []);
  assert.deepEqual(cleanTenantZones([' Principal ', 'Principal', '', null]), ['Principal']);
  const state = { filters: [], update: null, selection: null, table: null };
  const mockSupabase = {
    from(table) {
      state.table = table;
      return {
        update(values) { state.update = values; return this; },
        eq(column, value) { state.filters.push([column, value]); return this; },
        select(columns) { state.selection = columns; return this; },
        async single() { return { data: { id: 'tenant-test', zones: state.update.zones }, error: null }; }
      };
    }
  };
  const result = await updateTenantZonesInSupabase(mockSupabase, 'tenant-test', 'owner-test', []);
  assert.equal(state.table, 'tenants');
  assert.deepEqual(state.update, { zones: [] });
  assert.deepEqual(state.filters, [['id', 'tenant-test'], ['user_id', 'owner-test']]);
  assert.equal(state.selection, 'id, zones');
  assert.deepEqual(result.data.zones, []);
});

test('una lista del servidor vacía prevalece sobre caché; una actualización Realtime exacta propaga borrados', () => {
  assert.deepEqual(normalizeTenantZones([' Principal ', 'Principal', '', null, 7]), ['Principal']);
  assert.deepEqual(resolveTenantZones([], ['Salón eliminado']), []);
  assert.deepEqual(resolveTenantZones(null, [' Terraza ']), ['Terraza']);
  assert.deepEqual(resolveRealtimeTenantZones(['Principal'], ['Principal', 'Terraza'], false, true), ['Principal']);
  assert.deepEqual(resolveRealtimeTenantZones(['Principal', 'Terraza'], ['Principal'], true, true), ['Principal']);
  assert.deepEqual(resolveRealtimeTenantZones(['Principal'], [], true, false), ['Principal']);
});

test('snapshots de mesas reemplazan IDs y aceptan arreglos vacíos; payloads delta conservan IDs no mencionados', () => {
  const oldTables = [{ id: 'a', name: 'Vieja' }, { id: 'b', name: 'B' }];
  assert.deepEqual(readTableSnapshot([]), []);
  assert.equal(readTableSnapshot(undefined), null);
  assert.deepEqual(resolveRealtimeTables(oldTables, [{ id: 'a', name: 'Actual' }], true), [{ id: 'a', name: 'Actual' }]);
  assert.deepEqual(resolveRealtimeTables(oldTables, [], true), []);
  assert.deepEqual(resolveRealtimeTables(oldTables, [{ id: 'a', name: 'Actual' }], false), [
    { id: 'a', name: 'Actual' },
    { id: 'b', name: 'B' }
  ]);
  assert.equal(resolveRealtimeTables(oldTables, [{ name: 'malformada' }], true), null);
});

test('Realtime no anuncia ni aplica tablas vacías hasta hidratarse; snapshots legacy vacíos no borran mesas', () => {
  const localTables = [{ id: 'mesa-1', name: 'Mesa 1' }, { id: 'mesa-2', name: 'Mesa 2' }];

  assert.equal(canRespondToRealtimeSync({ hasLocalData: true, tablesHydrated: false }), false);
  assert.equal(canRespondToRealtimeSync({ hasLocalData: true, tablesHydrated: true }), true);
  assert.equal(canRespondToRealtimeSync({ hasLocalData: false, tablesHydrated: true }), false);

  assert.equal(resolveRealtimeTablePayload(localTables, { tables: [], snapshot: true, tablesHydrated: true }, false), null);
  assert.deepEqual(
    resolveRealtimeTablePayload(localTables, { tables: [], snapshot: true }, true),
    localTables
  );
  assert.deepEqual(
    resolveRealtimeTablePayload(localTables, { tables: [], snapshot: true, tablesHydrated: true }, true),
    []
  );
});

test('snapshot IndexedDB vacío conserva borrados locales con su base y no borra altas remotas posteriores', () => {
  const emptySnapshot = readTableSnapshot([]);
  assert.ok(emptySnapshot);
  assert.deepEqual(emptySnapshot, []);
  const base = [layoutItem('A', 10)];
  assert.deepEqual(mergeConcurrentTableLayouts(base, [], base), []);
  assert.deepEqual(
    mergeConcurrentTableLayouts(base, [], [...base, layoutItem('B', 60)]),
    [layoutItem('B', 60)]
  );
});

test('validador cliente acepta límites SQL y rechaza layouts que la restricción SQL rechaza', () => {
  const valid = layoutItem('A', 0, 100);
  assert.deepEqual(validateTableLayout([valid]), [valid]);
  assert.deepEqual(validateTableLayout([]), []);
  for (const invalid of [
    { ...valid, number: 1.5 },
    { ...valid, number: 0 },
    { ...valid, name: '  ' },
    { ...valid, x: -0.01 },
    { ...valid, x: 100.01 },
    { ...valid, y: -1 },
    { ...valid, y: 101 },
    { ...valid, rotation: null },
    { ...valid, operationalStatus: 'OCCUPIED' }
  ]) {
    assert.equal(validateTableLayout([invalid]), null, JSON.stringify(invalid));
  }
  assert.equal(validateTableLayout([valid, valid]), null);
});

test('merge concurrente conserva cambios independientes, adiciones y borrados, con remoto prioritario en conflicto por misma mesa', () => {
  const base = [layoutItem('A', 10), layoutItem('B', 20)];
  const local = [layoutItem('A', 30)]; // mueve A y elimina B
  const remote = [layoutItem('A', 10), layoutItem('B', 20), layoutItem('C', 60)];
  assert.deepEqual(mergeConcurrentTableLayouts(base, local, remote), [layoutItem('A', 30), layoutItem('C', 60)]);
  assert.deepEqual(
    mergeConcurrentTableLayouts([layoutItem('A', 10)], [layoutItem('A', 30)], [layoutItem('A', 40)]),
    [layoutItem('A', 40)]
  );
});

test('compare-and-swap reintenta tras carrera y conserva cambios remotos en otras mesas sin salir del tenant', async () => {
  const base = [layoutItem('A', 10), layoutItem('B', 20)];
  const local = [layoutItem('A', 30), layoutItem('B', 20)];
  let injectRace = true;
  const { client, state } = createLayoutClient({
    initialRow: { tenant_id: 'tenant-one', layout: base, updated_at: 't1' },
    beforeUpdate(current) {
      if (!injectRace) return;
      injectRace = false;
      current.row.layout = [layoutItem('A', 10), layoutItem('B', 50), layoutItem('C', 70)];
      current.row.updated_at = 't2';
    }
  });

  const saved = await persistTableLayoutWithClient(client, 'tenant-one', local, base, parseLayoutRow);
  assert.ok(saved);
  assert.deepEqual(saved.layout, [layoutItem('A', 30), layoutItem('B', 50), layoutItem('C', 70)]);
  assert.deepEqual(state.row.layout, saved.layout);
  const updates = state.calls.filter(call => call.action === 'update');
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].filters, [['tenant_id', 'tenant-one'], ['updated_at', 't1']]);
  assert.deepEqual(updates[1].filters, [['tenant_id', 'tenant-one'], ['updated_at', 't2']]);
  assert.ok(state.calls.every(call => call.filters.some(([column, value]) => column === 'tenant_id' && value === 'tenant-one')));
});

test('carrera de primera inserción no usa upsert destructivo y vuelve a mezclar el layout que ganó', async () => {
  const local = [layoutItem('A', 30)];
  const { client, state } = createLayoutClient({
    beforeInsert(current) {
      current.row = { tenant_id: 'tenant-one', layout: [layoutItem('B', 60)], updated_at: 't1' };
    }
  });
  const saved = await persistTableLayoutWithClient(client, 'tenant-one', local, [], parseLayoutRow);
  assert.ok(saved);
  assert.deepEqual(saved.layout, [layoutItem('B', 60), layoutItem('A', 30)]);
  assert.equal(state.calls.filter(call => call.action === 'insert').length, 1);
  assert.equal(state.calls.filter(call => call.action === 'update').length, 1);
});
