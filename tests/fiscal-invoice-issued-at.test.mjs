import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFiscalInvoiceIssuedAt } from '../api/_utils/fiscalInvoiceIssuedAt.ts';

test('normaliza una fecha fiscal con offset de Costa Rica a UTC', () => {
  assert.equal(
    parseFiscalInvoiceIssuedAt('2026-11-05T10:30:00-06:00'),
    '2026-11-05T16:30:00.000Z'
  );
});

test('acepta un instante UTC explícito', () => {
  assert.equal(
    parseFiscalInvoiceIssuedAt('2026-11-05T16:30:00Z'),
    '2026-11-05T16:30:00.000Z'
  );
});

test('no inventa zona para fecha naive ni acepta fechas inválidas', () => {
  assert.equal(parseFiscalInvoiceIssuedAt('2026-11-05T10:30:00'), null);
  assert.equal(parseFiscalInvoiceIssuedAt('2026-99-99T10:30:00-06:00'), null);
  assert.equal(parseFiscalInvoiceIssuedAt('2026-02-30T10:30:00-06:00'), null);
  assert.equal(parseFiscalInvoiceIssuedAt(undefined), null);
});

test('los endpoints guardan la fecha fiscal tipada y el cierre no inventa fecha de emisión con paid_at/created_at', async () => {
  const sync = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  const hacienda = await readFile(new URL('../api/hacienda.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261105170000_shift_and_daily_cash_closures.sql', import.meta.url), 'utf8');
  assert.match(sync, /issued_at: parseFiscalInvoiceIssuedAt\(payload\?\.invoiceData\?\.fechaEmision\)/);
  assert.match(hacienda, /const issuedAt = parseFiscalInvoiceIssuedAt\(invoiceData\.fechaEmision\)/);
  assert.match(hacienda, /\.\.\.\(issuedAt \? \{ issued_at: issuedAt \} : \{\}\)/);
  assert.match(migration, /add column if not exists issued_at timestamptz/i);
  assert.match(migration, /i\.issued_at is null[\s\S]*v_documents_count_available := false/i);
  assert.doesNotMatch(migration, /coalesce\(i\.issued_at, p\.paid_at, i\.created_at\)/i);
});
