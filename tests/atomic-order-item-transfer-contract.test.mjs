import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = resolve(root, 'supabase/proposals/atomic-order-item-transfer.sql');
const integrationPath = resolve(root, 'supabase/proposals/atomic-order-item-transfer.integration.sql');
const proposalPath = resolve(root, 'docs/proposals/atomic-order-item-transfer.md');
const sql = readFileSync(sqlPath, 'utf8');
const integration = readFileSync(integrationPath, 'utf8');
const proposal = readFileSync(proposalPath, 'utf8');

test('la propuesta define una única RPC protegida y una identidad estable de línea', () => {
  assert.match(sql, /create or replace function public\.transfer_pos_order_item\s*\(/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path\s*=\s*public,\s*pg_temp/i);
  assert.match(sql, /add column if not exists client_item_id text/i);
  assert.match(sql, /create unique index if not exists pos_order_items_client_item_id_uidx/i);
  assert.match(sql, /grant execute on function public\.transfer_pos_order_item[\s\S]*to service_role/i);
});

test('el ledger idempotente y los locks cubren el movimiento y rechazan reutilizar payload', () => {
  assert.match(sql, /create table if not exists public\.pos_order_item_transfer_requests/i);
  assert.match(sql, /on conflict \(tenant_id, operation_id\) do nothing/i);
  assert.match(sql, /request_payload is distinct from v_payload/i);
  assert.match(sql, /order by t\.id\s+for update/i);
  assert.match(sql, /order by o\.id\s+for update/i);
  assert.match(sql, /insert into public\.pos_audit_events/i);
  assert.match(sql, /update public\.pos_order_item_transfer_requests\s+set result = v_result/i);
});

test('el test PostgreSQL cubre rollback tras fallo parcial y retries sin duplicación', () => {
  assert.match(integration, /before insert on public\.pos_order_items/i);
  assert.match(integration, /fallo parcial dejó la cantidad origen/i);
  assert.match(integration, /test-failed-then-retry/i);
  assert.match(integration, /el replay duplicó la línea destino/i);
  assert.match(integration, /rollback;/i);
});

test('la propuesta advierte el límite actual y el SQL no está en migraciones aplicables', () => {
  assert.match(proposal, /no es atómico en la nube/i);
  assert.match(proposal, /no se ha aplicado/i);
  assert.equal(existsSync(resolve(root, 'supabase/migrations/20261101100000_atomic_order_item_transfer.sql')), false);
  assert.equal(
    readdirSync(resolve(root, 'supabase/migrations')).some(name => name.includes('atomic_order_item_transfer')),
    false
  );
});
