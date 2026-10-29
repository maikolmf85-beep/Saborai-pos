import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  hashPasswordResetToken
} from '../api/_utils/passwordReset.ts';

class FakeTokenDatabase {
  rows = [];

  from(table) {
    assert.equal(table, 'password_reset_tokens');
    return {
      delete: () => {
        const filters = {};
        const query = {
          eq: (field, value) => {
            filters[field] = value;
            return query;
          },
          gt: (field, value) => {
            filters[`${field}_gt`] = value;
            return query;
          },
          select: field => {
            filters.select = field;
            return query;
          },
          maybeSingle: async () => {
            const index = this.rows.findIndex(row =>
              row.token_hash === filters.token_hash &&
              row.expires_at > filters.expires_at_gt
            );
            if (index < 0) return { data: null, error: null };
            const [row] = this.rows.splice(index, 1);
            return { data: { user_id: row.user_id }, error: null };
          }
        };
        return query;
      }
    };
  }
}

test('emite tokens opacos aleatorios y conserva únicamente una huella SHA-256', () => {
  const first = createPasswordResetToken();
  const second = createPasswordResetToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.equal(hashPasswordResetToken(first.token), first.tokenHash);
});

test('rechaza JWT de sesión y valores malformados antes de consultar el almacén', async () => {
  const database = new FakeTokenDatabase();
  assert.equal(hashPasswordResetToken('eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.signature'), null);
  assert.equal(await consumePasswordResetToken('bad-token', database), null);
  assert.equal(database.rows.length, 0);
});

test('el vencimiento se valida en servidor y el token solo se consume una vez', async () => {
  const database = new FakeTokenDatabase();
  const { token, tokenHash } = createPasswordResetToken();
  const now = new Date('2026-10-28T19:00:00.000Z');
  database.rows.push({
    token_hash: tokenHash,
    user_id: 'user-123',
    expires_at: '2026-10-28T20:00:00.000Z'
  });

  assert.equal(await consumePasswordResetToken(token, database, now), 'user-123');
  assert.equal(await consumePasswordResetToken(token, database, now), null);
});

test('dos reclamos concurrentes del mismo token producen un solo consumo', async () => {
  const database = new FakeTokenDatabase();
  const { token, tokenHash } = createPasswordResetToken();
  const now = new Date('2026-10-28T19:00:00.000Z');
  database.rows.push({
    token_hash: tokenHash,
    user_id: 'user-123',
    expires_at: '2026-10-28T20:00:00.000Z'
  });

  const results = await Promise.all([
    consumePasswordResetToken(token, database, now),
    consumePasswordResetToken(token, database, now)
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(database.rows.length, 0);
});

test('no consume un token expirado', async () => {
  const database = new FakeTokenDatabase();
  const { token, tokenHash } = createPasswordResetToken();
  database.rows.push({
    token_hash: tokenHash,
    user_id: 'user-123',
    expires_at: '2026-10-28T18:59:59.000Z'
  });

  assert.equal(await consumePasswordResetToken(token, database, new Date('2026-10-28T19:00:00.000Z')), null);
  assert.equal(database.rows.length, 1);
});
