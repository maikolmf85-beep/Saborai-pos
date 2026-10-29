import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandoffReference, hashHandoffReference } from '../api/_utils/tilopayHandoffCrypto.ts';
import {
  PurchaseIntentError,
  subscribeToPurchaseIntent,
  tokenizeForPurchaseIntent
} from '../api/_utils/tilopayPurchaseFlow.ts';

const TEST_TOKEN = 'test_token_v2_123456';

function fixture({ transaction, chargeError, tokenizeError, initialStatus = 'CREATED', tokenizationAllowed = true } = {}) {
  const reference = createHandoffReference();
  const referenceHash = hashHandoffReference(reference);
  const intent = {
    planId: 'pro',
    amount: '45000.00',
    currency: 'CRC',
    orderNumber: 'SA00000000000000000000000000000001',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    paymentStatus: initialStatus,
    paymentTokenHash: initialStatus === 'PROCESSING' || initialStatus === 'UNKNOWN' ? null : null,
    paymentTransactionId: null,
    paymentResult: null,
    customerEmail: 'stored-customer@example.test',
    customerFirstName: 'Nombre guardado'
  };
  let leaseActive = initialStatus === 'PROCESSING';
  let tokenizationCount = 0;
  const calls = { tokenize: [], charge: [], consult: [] };

  const store = {
    async find(hash) {
      return hash === referenceHash ? { ...intent } : null;
    },
    async reserveTokenization(hash) {
      if (hash !== referenceHash || !tokenizationAllowed || tokenizationCount >= 3) return false;
      tokenizationCount += 1;
      return true;
    },
    async releaseTokenization(hash) {
      assert.equal(hash, referenceHash);
      tokenizationCount = Math.max(0, tokenizationCount - 1);
    },
    async claimPayment(hash, tokenHash) {
      if (hash !== referenceHash) return { status: 'INVALID' };
      if (intent.paymentTokenHash && intent.paymentTokenHash !== tokenHash) return { status: 'TOKEN_MISMATCH', intent: { ...intent } };
      if (intent.paymentStatus === 'SUCCEEDED') return { status: 'SUCCEEDED', intent: { ...intent } };
      if (intent.paymentStatus === 'DECLINED') return { status: 'DECLINED', intent: { ...intent } };
      if (intent.paymentStatus === 'CREATED') {
        if (Date.parse(intent.expiresAt) <= Date.now()) return { status: 'EXPIRED', intent: { ...intent }, expired: true };
        intent.paymentStatus = 'PROCESSING';
        intent.paymentTokenHash = tokenHash;
        leaseActive = true;
        return { status: 'CLAIMED', intent: { ...intent } };
      }
      if (intent.paymentStatus === 'PROCESSING' && leaseActive) return { status: 'IN_PROGRESS', intent: { ...intent } };
      intent.paymentStatus = 'PROCESSING';
      intent.paymentTokenHash = tokenHash;
      leaseActive = true;
      return { status: 'RECOVERY', intent: { ...intent } };
    },
    async recordPayment(hash, tokenHash, status, transactionId, result) {
      assert.equal(hash, referenceHash);
      assert.equal(intent.paymentTokenHash, tokenHash);
      intent.paymentStatus = status;
      intent.paymentTransactionId = transactionId;
      intent.paymentResult = result;
      leaseActive = false;
    }
  };

  const gateway = {
    async tokenize(input) {
      calls.tokenize.push(input);
      if (tokenizeError) throw tokenizeError;
      return 'https://secure.tilopay.com/tokenize/test';
    },
    async charge(input) {
      calls.charge.push(input);
      if (chargeError) throw chargeError;
    },
    async consult(orderNumber) {
      calls.consult.push(orderNumber);
      return typeof transaction === 'function' ? transaction(calls) : (transaction || null);
    }
  };
  return { reference, referenceHash, intent, store, gateway, calls };
}

const approvedTransaction = (amount = '45000.00', currency = 'CRC') => ({
  amount,
  currency,
  code: '1',
  id_tilopay: 'tx-test-123'
});

test('tokenize usa cliente de la intención y no identidad, plan o callback del navegador', async () => {
  const f = fixture();
  const url = await tokenizeForPurchaseIntent(
    f.reference,
    'https://saborai.site/?tilopay_success=true&ref=opaco',
    f.store,
    f.gateway
  );

  assert.match(url, /^https:\/\/secure\.tilopay\.com\//);
  assert.deepEqual(f.calls.tokenize[0], {
    email: 'stored-customer@example.test',
    firstName: 'Nombre guardado',
    lastName: 'Saborai',
    redirect: 'https://saborai.site/?tilopay_success=true&ref=opaco'
  });
});

test('rechaza intento de tokenización que excede el límite persistente', async () => {
  const f = fixture({ tokenizationAllowed: false });
  await assert.rejects(
    tokenizeForPurchaseIntent(f.reference, 'https://saborai.site/', f.store, f.gateway),
    error => error instanceof PurchaseIntentError && error.statusCode === 429
  );
  assert.equal(f.calls.tokenize.length, 0);
});

test('un fallo transitorio al tokenizar libera el cupo y permite reintentar', async () => {
  const f = fixture({ tokenizeError: new Error('provider unavailable') });
  await assert.rejects(
    tokenizeForPurchaseIntent(f.reference, 'https://saborai.site/', f.store, f.gateway),
    /provider unavailable/
  );
  f.gateway.tokenize = async input => {
    f.calls.tokenize.push(input);
    return 'https://secure.tilopay.com/tokenize/retry';
  };
  const url = await tokenizeForPurchaseIntent(f.reference, 'https://saborai.site/', f.store, f.gateway);
  assert.equal(url, 'https://secure.tilopay.com/tokenize/retry');
});

test('rechaza un token manipulado o excesivo antes de llamar al proveedor', async () => {
  const f = fixture();
  await assert.rejects(
    subscribeToPurchaseIntent(f.reference, 'x'.repeat(2049), f.store, f.gateway),
    error => error instanceof PurchaseIntentError && error.statusCode === 400
  );
  assert.equal(f.calls.charge.length, 0);
  assert.equal(f.calls.consult.length, 0);
});

test('rechaza solicitudes sin una intención válida antes de procesar el token', async () => {
  const f = fixture();
  await assert.rejects(
    subscribeToPurchaseIntent('referencia-forjada', TEST_TOKEN, f.store, f.gateway),
    error => error instanceof PurchaseIntentError && error.statusCode === 400
  );
  assert.equal(f.calls.charge.length, 0);
});

test('el plan, email, precio y moneda vienen de la intención y no del payload manipulable', async () => {
  const f = fixture({ transaction: approvedTransaction() });
  // La función solo recibe referencia y token; planId/email/amount/currency del navegador no forman parte del contrato.
  const forgedBrowserPayload = {
    planId: 'multibranch', email: 'attacker@example.test', amount: 1, currency: 'USD'
  };
  assert.deepEqual(Object.keys(forgedBrowserPayload).sort(), ['amount', 'currency', 'email', 'planId']);

  const result = await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);
  assert.equal(result.success, true);
  assert.equal(result.planId, 'pro');
  assert.equal(result.amount, 45000);
  assert.equal(result.currency, 'CRC');
  assert.deepEqual(f.calls.charge[0], {
    amount: '45000.00',
    currency: 'CRC',
    orderNumber: f.intent.orderNumber,
    email: 'stored-customer@example.test',
    token: TEST_TOKEN
  });
});

test('un reintento de la misma intención devuelve el recibo guardado y no vuelve a cobrar', async () => {
  const f = fixture({ transaction: approvedTransaction() });
  const first = await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);
  const second = await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.transactionId, first.transactionId);
  assert.equal(f.calls.charge.length, 1);
});

test('no permite sustituir el token tras reservar la intención', async () => {
  const f = fixture({ transaction: approvedTransaction() });
  await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);
  await assert.rejects(
    subscribeToPurchaseIntent(f.reference, 'different_test_token_987', f.store, f.gateway),
    error => error instanceof PurchaseIntentError && error.statusCode === 409
  );
  assert.equal(f.calls.charge.length, 1);
});

test('consulta el orderNumber existente antes de reintentar tras estado ambiguo', async () => {
  const f = fixture({ initialStatus: 'UNKNOWN', transaction: approvedTransaction() });
  f.intent.paymentTokenHash = null;
  const result = await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);

  assert.equal(result.success, true);
  assert.equal(f.calls.consult[0], f.intent.orderNumber);
  assert.equal(f.calls.charge.length, 0);
});

test('no marca como exitoso un importe o una moneda distintos de la intención', async () => {
  const f = fixture({ transaction: approvedTransaction('1.00', 'USD') });
  await assert.rejects(
    subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway),
    error => error instanceof PurchaseIntentError && error.statusCode === 502
  );
  assert.equal(f.intent.paymentStatus, 'UNKNOWN');
});

test('un timeout sin transacción consultable queda pendiente y no crea otro orderNumber', async () => {
  const f = fixture({ chargeError: new Error('timeout'), transaction: null });
  const result = await subscribeToPurchaseIntent(f.reference, TEST_TOKEN, f.store, f.gateway);

  assert.equal(result.pending, true);
  assert.equal(f.intent.paymentStatus, 'UNKNOWN');
  assert.equal(f.calls.charge[0].orderNumber, f.intent.orderNumber);
  assert.equal(f.calls.consult[0], f.intent.orderNumber);
});
