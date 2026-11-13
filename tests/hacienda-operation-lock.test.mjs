import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HACIENDA_OPERATION_LOCK_MAX_AGE_MS,
  createHaciendaOperationLockToken,
  isHaciendaOperationLock,
  isHaciendaOperationLockStale,
  publicHaciendaErrorMessage
} from '../api/_utils/haciendaOperationLock.ts';
import {
  canReserveHaciendaSubmission,
  claimHaciendaOperationLock,
  finishHaciendaOperationLock,
  updateHaciendaInvoiceIfSnapshot
} from '../api/_utils/haciendaInvoiceConcurrency.ts';

function fakeSupabase(initialRow) {
  return {
    from(table) {
      assert.equal(table, 'pos_invoices');
      return {
        update(values) {
          const filters = [];
          const query = {
            eq(field, value) { filters.push([field, 'eq', value]); return query; },
            is(field, value) { filters.push([field, 'is', value]); return query; },
            select() { return query; },
            async maybeSingle() {
              const matches = filters.every(([field, op, value]) => op === 'is'
                ? initialRow[field] === value
                : initialRow[field] === value);
              if (!matches) return { data: null, error: null };
              Object.assign(initialRow, values);
              return { data: { clave: initialRow.clave }, error: null };
            }
          };
          return query;
        }
      };
    }
  };
}

const snapshot = (overrides = {}) => ({
  tenantId: 'tenant-test',
  branchId: 'branch-test',
  clave: '1'.repeat(50),
  haciendaStatus: 'REJECTED',
  errorMessage: 'Rechazado por DGT',
  ...overrides
});

test('solo un registro nuevo/PENDING o un REJECTED confirmado por DGT puede reservar un POST', () => {
  assert.equal(canReserveHaciendaSubmission(null, 'emit', false), true);
  assert.equal(canReserveHaciendaSubmission(snapshot({ haciendaStatus: 'PENDING' }), 'emit', false), true);
  assert.equal(canReserveHaciendaSubmission(snapshot({ haciendaStatus: 'PROCESSING' }), 'emit', false), false);
  assert.equal(canReserveHaciendaSubmission(snapshot({ haciendaStatus: 'PROCESSING' }), 'resend', true), false);
  assert.equal(canReserveHaciendaSubmission(snapshot({ haciendaStatus: 'REJECTED' }), 'resend', false), false);
  assert.equal(canReserveHaciendaSubmission(snapshot({ haciendaStatus: 'REJECTED' }), 'resend', true), true);
  assert.equal(canReserveHaciendaSubmission(snapshot({
    haciendaStatus: 'PROCESSING', errorMessage: createHaciendaOperationLockToken()
  }), 'emit', false), false);
});

test('el marcador es único, se detecta como interno y se oculta del historial', () => {
  const first = createHaciendaOperationLockToken(1000);
  const second = createHaciendaOperationLockToken(1000);
  assert.notEqual(first, second);
  assert.equal(isHaciendaOperationLock(first), true);
  assert.match(publicHaciendaErrorMessage(first), /operación de Hacienda en curso/i);
  assert.equal(publicHaciendaErrorMessage('Rechazo DGT'), 'Rechazo DGT');
});

test('un lock solo se considera vencido después del límite y un token mal formado falla cerrado', () => {
  const createdAt = 10_000;
  const token = createHaciendaOperationLockToken(createdAt);
  assert.equal(isHaciendaOperationLockStale(token, createdAt + HACIENDA_OPERATION_LOCK_MAX_AGE_MS - 1), false);
  assert.equal(isHaciendaOperationLockStale(token, createdAt + HACIENDA_OPERATION_LOCK_MAX_AGE_MS), true);
  assert.equal(isHaciendaOperationLockStale('__HACIENDA_OPERATION_LOCK__:invalid'), false);
  assert.equal(isHaciendaOperationLockStale(token, createdAt - 1), false);
});

test('solo la primera solicitud que compara el snapshot puede reclamar un reenvío', async () => {
  const row = {
    tenant_id: 'tenant-test',
    branch_id: 'branch-test',
    clave: '1'.repeat(50),
    hacienda_status: 'REJECTED',
    error_message: 'Rechazado por DGT',
    accepted_at: 'old'
  };
  const client = fakeSupabase(row);
  const original = snapshot();
  const firstToken = createHaciendaOperationLockToken();
  const secondToken = createHaciendaOperationLockToken();
  const first = await updateHaciendaInvoiceIfSnapshot(client, original, {
    hacienda_status: 'PROCESSING', error_message: firstToken, accepted_at: null
  });
  const second = await updateHaciendaInvoiceIfSnapshot(client, original, {
    hacienda_status: 'PROCESSING', error_message: secondToken, accepted_at: null
  });
  assert.equal(first.updated, true);
  assert.equal(second.updated, false);
  assert.equal(row.error_message, firstToken);
});

test('un lock fresco no se puede reclamar ni liberar por una solicitud que no posee el token', async () => {
  const token = createHaciendaOperationLockToken();
  const row = {
    tenant_id: 'tenant-test',
    branch_id: 'branch-test',
    clave: '1'.repeat(50),
    hacienda_status: 'PROCESSING',
    error_message: token,
    accepted_at: null
  };
  const client = fakeSupabase(row);
  const competing = await claimHaciendaOperationLock(client, snapshot({
    haciendaStatus: 'PROCESSING', errorMessage: token
  }), createHaciendaOperationLockToken());
  const wrongOwner = await finishHaciendaOperationLock(
    client, 'tenant-test', 'branch-test', '1'.repeat(50), createHaciendaOperationLockToken(),
    { hacienda_status: 'REJECTED', error_message: 'stale' }
  );
  assert.equal(competing.updated, false);
  assert.equal(wrongOwner.updated, false);
  assert.equal(row.error_message, token);
});

test('un lock vencido se recupera con CAS y no puede ser reclamado por segunda vez', async () => {
  const createdAt = 10_000;
  const staleToken = createHaciendaOperationLockToken(createdAt);
  const currentTime = createdAt + HACIENDA_OPERATION_LOCK_MAX_AGE_MS;
  const row = {
    tenant_id: 'tenant-test',
    branch_id: 'branch-test',
    clave: '1'.repeat(50),
    hacienda_status: 'PROCESSING',
    error_message: staleToken,
    accepted_at: null
  };
  const client = fakeSupabase(row);
  const nextToken = createHaciendaOperationLockToken(currentTime);
  const recovered = await claimHaciendaOperationLock(client, snapshot({
    haciendaStatus: 'PROCESSING', errorMessage: staleToken
  }), nextToken, currentTime);
  const competing = await claimHaciendaOperationLock(client, snapshot({
    haciendaStatus: 'PROCESSING', errorMessage: staleToken
  }), createHaciendaOperationLockToken(currentTime + 1), currentTime);
  assert.equal(recovered.updated, true);
  assert.equal(competing.updated, false);
  assert.equal(row.error_message, nextToken);
});

test('el dueño del lock puede finalizar la operación con una sola transición', async () => {
  const token = createHaciendaOperationLockToken();
  const row = {
    tenant_id: 'tenant-test',
    branch_id: 'branch-test',
    clave: '1'.repeat(50),
    hacienda_status: 'PROCESSING',
    error_message: token,
    accepted_at: null
  };
  const result = await finishHaciendaOperationLock(
    fakeSupabase(row), 'tenant-test', 'branch-test', '1'.repeat(50), token,
    { hacienda_status: 'REJECTED', error_message: 'Rechazado por DGT' }
  );
  assert.equal(result.updated, true);
  assert.equal(row.hacienda_status, 'REJECTED');
  assert.equal(row.error_message, 'Rechazado por DGT');
});
