import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const migration = fileURLToPath(new URL('supabase/migrations/20261119101500_cash_shift_v2_backend.sql', root));
const sql = readFileSync(migration, 'utf8');

function functionBody(name, nextName) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextName
    ? sql.indexOf(`create or replace function public.${nextName}`, start + 1)
    : sql.indexOf('end $$;', start) + 'end $$;'.length;
  assert.ok(end > start, `missing function end for ${name}`);
  return sql.slice(start, end);
}

test('OPEN_SHIFT bloquea T2 hasta el cierre T1 de todas las cajas activas y llama al handoff en la misma RPC', () => {
  const open = functionBody('pos_cash_v2_open_shift', 'pos_cash_v2_sync_order');
  assert.match(open, /pos_cash_v2_require_scope\(/);
  assert.match(open, /from public\.pos_branches[\s\S]*?for update/i);
  assert.match(open, /from public\.pos_cash_registers[\s\S]*?rr\.is_active[\s\S]*?order by rr\.id for update/i);
  assert.match(open, /T2_REQUIRES_BRANCHWIDE_CLOSED_T1/);
  assert.match(open, /pos_cash_v2_t1_handoff_snapshot\(/);
  assert.match(open, /pos_cash_v2_finish_idempotent\(/);
});

test('snapshot T1 valida caja/sesión, orden/mesa, salonero, totales y pagos por receiving_session', () => {
  const handoff = functionBody('pos_cash_v2_t1_handoff_snapshot', 'pos_cash_v2_open_shift');
  for (const marker of [
    'ACTIVE_REGISTER_ROSTER_EMPTY_OR_INVALID', 'T2_REQUIRES_BRANCHWIDE_CLOSED_T1',
    'OPEN_ORDER_OR_WAITER_OR_TOTAL_UNVERIFIABLE', 'ORPHAN_OCCUPIED_TABLE_OR_ORDER',
    'UNMAPPED_LEGACY_OPEN_ORDER', 'UNRESOLVED_LEGACY_PAYMENT',
    'originSessionId', 'fromServingSessionId', 'toServingSessionId',
    'validatedWaiters', 'authorizedPaymentsByReceivingSession',
    'required_register_ids', 'covered_session_ids'
  ]) assert.ok(handoff.includes(marker), `handoff is missing ${marker}`);
  assert.match(handoff, /p\.receiving_session_id/);
  assert.match(handoff, /p\.status='AUTHORIZED'/);
  assert.match(handoff, /set serving_session_id=p_target_t2_session_id/);
  assert.doesNotMatch(handoff, /set\s+origin_session_id\s*=/i);
  assert.doesNotMatch(handoff, /pos_orders\.cash_shift_id|lo\.cash_shift_id/i);
});

test('daily close prueba igualdad entre roster activo, sesiones y snapshots de cada T2', () => {
  const daily = functionBody('pos_close_daily_cash_v2_aware', 'pos_cash_v2_resolve_held_line');
  for (const marker of [
    'v_register_ids', 'v_expected_session_ids', 'v_session_ids',
    'BRANCH_REGISTER_SESSION_SET_MISMATCH', 'BOTH_SESSIONS_REQUIRED_FOR_EVERY_ACTIVE_REGISTER',
    'T1_T2_HANDOFF_SNAPSHOT_ROSTER_MISMATCH', 'required_register_ids',
    'covered_session_ids', 'activeRequiredRegisterIds', 'expectedSessionIds',
    'countablePaymentIds', 'sessionReconciliations'
  ]) assert.ok(daily.includes(marker), `daily close is missing ${marker}`);
  assert.match(daily, /v_session_ids is distinct from v_expected_session_ids/i);
  assert.match(daily, /p\.receiving_session_id=any\(v_target_session_ids\)/i);
  assert.match(daily, /pos_cash_v2_snapshots\([^)]*required_register_ids,covered_session_ids/i);
  assert.doesNotMatch(daily, /pos_orders\.cash_shift_id|lo\.cash_shift_id/i);
});

test('RPC helper del handoff permanece privado; V2 sigue explícitamente no aplicable', () => {
  assert.match(sql, /revoke all on function [^;]*public\.pos_cash_v2_t1_handoff_snapshot\([^;]+from public,anon,authenticated,service_role/i);
  assert.match(sql, /NOT READY FOR APPLY/);
  assert.match(sql, /no aplicar/i);
});
