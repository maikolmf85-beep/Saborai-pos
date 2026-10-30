import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261030000000_employee_credit_atomic_rpc.sql', import.meta.url), 'utf8');

test('la migración es autocontenida y crea las dos tablas con sus restricciones', () => {
  assert.match(migration, /create table if not exists public\.pos_employee_credit_accounts/i);
  assert.match(migration, /create table if not exists public\.pos_employee_credit_transactions/i);
  assert.match(migration, /unique \(tenant_id, employee_id\)/i);
  assert.match(migration, /unique \(tenant_id, idempotency_key\)/i);
  assert.match(migration, /foreign key \(tenant_id, account_id\)/i);
  assert.match(migration, /check \(balance >= 0\)/i);
  assert.match(migration, /check \(amount > 0\)/i);
  assert.match(migration, /references public\.pos_orders\(id\)/i);
  assert.match(migration, /references public\.pos_invoices\(id\)/i);
});

test('la migración activa RLS y restringe acceso directo a anon y authenticated', () => {
  assert.match(migration, /alter table public\.pos_employee_credit_accounts enable row level security/i);
  assert.match(migration, /alter table public\.pos_employee_credit_transactions enable row level security/i);
  assert.match(migration, /revoke all on table public\.pos_employee_credit_accounts from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.pos_employee_credit_transactions from public, anon, authenticated/i);
  assert.match(migration, /grant all on table public\.pos_employee_credit_accounts to service_role/i);
  assert.match(migration, /grant all on table public\.pos_employee_credit_transactions to service_role/i);
});

test('la función de crédito bloquea la cuenta y valida al colaborador del mismo tenant', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public, pg_temp/i);
  assert.match(migration, /e\.tenant_id\s*=\s*p_tenant_id/i);
  assert.match(migration, /e\.external_id\s*=\s*btrim\(p_employee_id\)/i);
  assert.match(migration, /e\.is_active\s*=\s*true/i);
  assert.match(migration, /o\.tenant_id\s*=\s*p_tenant_id/i);
  assert.match(migration, /v_account_status\s*<>\s*'ACTIVE'/i);
  assert.match(migration, /for update/i);
});

test('la función aplica idempotencia y actualiza saldo en la misma transacción', () => {
  assert.match(migration, /unique|idempotency_key/i);
  assert.match(migration, /on conflict \(tenant_id, idempotency_key\) do nothing/i);
  assert.match(migration, /update public\.pos_employee_credit_accounts/i);
  assert.match(migration, /p_transaction_type = 'PAYMENT'.*v_balance/s);
});

test('la RPC solo puede ejecutarla service_role', () => {
  assert.match(migration, /revoke all on function public\.apply_employee_credit_transaction[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.apply_employee_credit_transaction[\s\S]*to service_role/i);
});
