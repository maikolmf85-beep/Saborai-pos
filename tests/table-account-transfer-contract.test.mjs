import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sqlPath = resolve(root, 'supabase/proposals/table-account-transfer.sql');
const sql = readFileSync(sqlPath, 'utf8');
const api = readFileSync(resolve(root, 'api/offline/sync.ts'), 'utf8');
const permissions = readFileSync(resolve(root, 'api/_utils/rolePermissions.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');

test('la RPC mueve la relación de la cuenta y los estados de ambas mesas dentro de la sucursal origen', () => {
  assert.match(sql, /create or replace function public\.transfer_pos_table_account/i);
  assert.match(sql, /v_order_branch_id <> v_branch_id/);
  assert.match(sql, /branch_id = v_branch_id[\s\S]*table_number = v_destination_table_number/);
  assert.match(sql, /update public\.pos_orders[\s\S]*set table_id = v_destination_table_id/i);
  assert.match(sql, /set status = 'AVAILABLE'[\s\S]*update public\.pos_tables[\s\S]*set status = v_source_status/i);
  assert.match(sql, /pos_audit_events_tenant_request_uidx/);
});

test('API y permisos habilitan la nueva operación sin reutilizar la acción de traslado de productos', () => {
  assert.match(api, /TRANSFER_TABLE_ACCOUNT/);
  assert.match(api, /rpc\('transfer_pos_table_account'/);
  assert.match(permissions, /TRANSFER_TABLE_ACCOUNT: \['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'\]/);
  assert.doesNotMatch(api, /TRANSFER_TABLE_ITEM/);
  assert.match(app, /transferTableAccount\(/);
});

test('la propuesta no se aplica como migración automáticamente', () => {
  assert.equal(existsSync(sqlPath), true);
  const migrations = readdirSync(resolve(root, 'supabase/migrations'));
  assert.equal(migrations.some(name => name.includes('table_account_transfer')), false);
});
