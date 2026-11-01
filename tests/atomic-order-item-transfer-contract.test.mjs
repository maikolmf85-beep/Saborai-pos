import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = resolve(root, 'supabase/proposals/atomic-order-item-transfer.sql');
const integrationPath = resolve(root, 'supabase/proposals/atomic-order-item-transfer.integration.sql');
const proposalPath = resolve(root, 'docs/proposals/atomic-order-item-transfer.md');
const apiPath = resolve(root, 'api/offline/sync.ts');
const appPath = resolve(root, 'src/App.tsx');
const permissionsPath = resolve(root, 'api/_utils/rolePermissions.ts');
const sql = readFileSync(sqlPath, 'utf8');
const integration = readFileSync(integrationPath, 'utf8');
const proposal = readFileSync(proposalPath, 'utf8');
const api = readFileSync(apiPath, 'utf8');
const app = readFileSync(appPath, 'utf8');
const permissions = readFileSync(permissionsPath, 'utf8');
const queue = readFileSync(resolve(root, 'src/services/db.ts'), 'utf8');

test('la propuesta declara revisiones y RPCs protegidas para orden y traslado', () => {
  assert.match(sql, /add column if not exists cloud_revision integer not null default 0/i);
  assert.match(sql, /add column if not exists cash_register_id uuid references public\.pos_cash_registers\(id\) on delete set null/i);
  assert.match(sql, /add column if not exists terminal_id uuid references public\.pos_terminals\(id\) on delete set null/i);
  assert.match(sql, /to_regclass\('public\.pos_terminals'\)/i);
  assert.match(sql, /add column if not exists linked_zones jsonb/i);
  assert.match(sql, /create table if not exists public\.pos_cash_shift_sync_requests/i);
  assert.match(sql, /create or replace function public\.sync_pos_cash_shift\s*\(/i);
  assert.match(sql, /create or replace function public\.sync_pos_table_order\s*\(/i);
  assert.match(sql, /create or replace function public\.transfer_pos_order_item\s*\(/i);
  assert.match(sql, /p_cash_shift_id uuid/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /add column if not exists client_item_id text/i);
  assert.match(sql, /create unique index if not exists pos_order_items_client_item_id_uidx/i);
  assert.match(sql, /grant execute on function public\.sync_pos_table_order[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.transfer_pos_order_item[\s\S]*to service_role/i);
});

test('las RPC no dependen del trigger Phase 9 para validar alcance operativo', () => {
  assert.match(sql, /v_cash_register_id is not null[\s\S]*from public\.pos_cash_registers/i);
  assert.match(sql, /v_cash_shift_id is not null[\s\S]*from public\.pos_cash_shifts/i);
  assert.match(sql, /v_terminal_id is not null[\s\S]*from public\.pos_terminals/i);
  assert.match(sql, /v_scope_tenant is distinct from p_tenant_id/i);
  assert.match(sql, /v_scope_branch is distinct from v_branch_id/i);
});

test('UPDATE_TABLE usa ledger idempotente y compara cloud_revision antes de reemplazar líneas', () => {
  assert.match(sql, /create table if not exists public\.pos_order_sync_requests/i);
  assert.match(sql, /request_payload is distinct from p_payload/i);
  assert.match(sql, /v_current_revision <> v_expected_revision/i);
  assert.match(sql, /delete from public\.pos_order_items[\s\S]*insert into public\.pos_order_items/i);
  assert.match(sql, /update public\.pos_order_sync_requests\s+set result = v_result/i);
  assert.match(sql, /bump_pos_order_revision_on_status_change/i);
  const orderUpdate = sql.slice(sql.indexOf('update public.pos_orders set'), sql.indexOf('where id = v_order_id', sql.indexOf('update public.pos_orders set')));
  assert.doesNotMatch(orderUpdate, /status\s*=\s*'OPEN'/i, 'un guardado de mesa no debe revertir el estado de cocina');
  assert.match(sql, /v_scope_shift_status <> 'OPEN'/i);
});

test('el traslado valida ambas revisiones y las incrementa en una sola función transaccional', () => {
  assert.match(sql, /create table if not exists public\.pos_order_item_transfer_requests/i);
  assert.match(sql, /on conflict \(tenant_id, operation_id\) do nothing/i);
  assert.match(sql, /request_payload is distinct from v_payload/i);
  assert.match(sql, /order by t\.id\s+for update/i);
  assert.match(sql, /order by o\.id\s+for update/i);
  assert.match(sql, /v_cash_shift\.status <> 'OPEN'/i);
  assert.match(sql, /jsonb_array_elements_text\(v_effective_zones\)[\s\S]*v_destination_table\.zone/i);
  assert.match(sql, /v_source_order\.cloud_revision <> p_expected_source_revision/i);
  assert.match(sql, /v_destination_order\.cloud_revision <> p_expected_destination_revision/i);
  assert.match(sql, /set cloud_revision = cloud_revision \+ 1/i);
  assert.match(sql, /insert into public\.pos_audit_events/i);
});

test('API y cliente despachan el traslado como una sola acción RPC autorizada', () => {
  assert.match(api, /TRANSFER_TABLE_ITEM/);
  assert.match(api, /rpc\('sync_pos_table_order'/);
  assert.match(api, /rpc\('transfer_pos_order_item'/);
  assert.match(api, /'UPDATE_TABLE', 'TRANSFER_TABLE_ITEM', 'OPEN_CASH_SHIFT', 'CLOSE_CASH_SHIFT'/);
  assert.match(api, /p_cash_shift_id: shift\.id/);
  assert.match(api, /cashShiftCloseOverride/);
  assert.match(api, /CASH_SHIFT_SYNC_REJECTED/);
  assert.match(api, /String\(error\?\.message \|\| ''\)\.includes\('STALE_ORDER_REVISION'\)/);
  assert.doesNotMatch(api, /error\?\.code === '40001' \|\|/);
  assert.match(api, /\['22023', '23505', '23503'\]\.includes\(rpc\.error\.code \|\| ''\)/);
  assert.match(permissions, /TRANSFER_TABLE_ITEM: \['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'\]/);
  assert.match(permissions, /OPEN_CASH_SHIFT: \['ADMIN', 'SALONERO', 'CAJERO', 'SALONERO_CAJA', 'WAITER'\]/);

  const start = app.indexOf('const handleTransferItemToTable');
  const end = app.indexOf('const handleUpdateTenantStatus', start);
  assert.ok(start >= 0 && end > start, 'handler de traslado encontrado');
  const transferHandler = app.slice(start, end);
  assert.match(transferHandler, /syncOperation<TransferSyncResult>\(\s*'TRANSFER_TABLE_ITEM'/);
  assert.match(transferHandler, /createOperationId\('TRANSFER_TABLE_ITEM'\)/);
  assert.doesNotMatch(transferHandler, /syncOperation(?:<[^>]+>)?\(\s*'UPDATE_TABLE'/);
});

test('la cola persiste el mismo ID de operación y detiene acciones dependientes ante conflictos', () => {
  assert.match(queue, /id: stableOperationId/);
  assert.match(queue, /\['STALE_ORDER_REVISION', 'ORDER_SYNC_REJECTED', 'CASH_SHIFT_SYNC_REJECTED', 'CASH_SHIFT_NOT_OPEN'\]\.includes\(data\.code\)/);
  assert.match(queue, /affectedCashShifts\.some\(shiftId => blockedCashShifts\.has\(shiftId\)\)\) \{[\s\S]*affectedOrders\.forEach/);
  assert.match(queue, /originalItem\.status === 'CONFLICT'/);
  assert.match(queue, /affectedOrders\.some\(orderNumber => blockedOrders\.has\(orderNumber\)\)/);
  assert.match(queue, /processingItem\.id/);
});

test('el test PostgreSQL cubre rollback, replay, escritor obsoleto y revisión de estado', () => {
  assert.match(integration, /before insert on public\.pos_order_items/i);
  assert.match(integration, /test-stale-table-save/i);
  assert.match(integration, /test-writer-stale/i);
  assert.match(integration, /test-stale-transfer/i);
  assert.match(integration, /test-failed-then-retry/i);
  assert.match(integration, /test-open-shift/i);
  assert.match(integration, /test-zone-rejected/i);
  assert.match(integration, /test-register-zone-fallback/i);
  assert.match(integration, /test-after-close-transfer/i);
  assert.match(integration, /UPDATE_TABLE revirtió el estado de cocina/i);
  assert.match(integration, /el replay duplicó la línea destino/i);
  assert.match(integration, /cierre debe incrementar revisión/i);
  assert.match(integration, /rollback;/i);
});

test('la documentación advierte que el contrato no está activo y la SQL queda fuera de migraciones', () => {
  assert.match(proposal, /la nube aún no ofrece esta garantía/i);
  assert.match(proposal, /no se ejecutó ni se conectó a Supabase/i);
  assert.equal(existsSync(resolve(root, 'supabase/migrations/20261101100000_atomic_order_item_transfer.sql')), false);
  assert.equal(
    readdirSync(resolve(root, 'supabase/migrations')).some(name => name.includes('atomic_order_item_transfer')),
    false
  );
});
