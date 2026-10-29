import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHandoffReference,
  decryptHandoffPayload,
  encryptHandoffPayload,
  hashHandoffReference,
  isValidHandoffReference
} from '../api/_utils/tilopayHandoffCrypto.ts';

const TEST_ONLY_SECRET = 'test-only-secret-not-used-in-any-environment-0123456789';

test('genera una referencia opaca de 256 bits y solo se acepta su formato', () => {
  const reference = createHandoffReference();

  assert.equal(reference.length, 43);
  assert.equal(isValidHandoffReference(reference), true);
  assert.equal(isValidHandoffReference('short-reference'), false);
  assert.equal(hashHandoffReference(reference).length, 64);
  assert.notEqual(hashHandoffReference(reference), reference);
});

test('cifra y recupera el contenido manteniendo integridad', () => {
  const payload = {
    email: 'demo@example.test',
    password: 'solo-para-pruebas',
    phone: '+506 0000-0000'
  };
  const encrypted = encryptHandoffPayload(payload, TEST_ONLY_SECRET);

  assert.notEqual(JSON.stringify(encrypted), JSON.stringify(payload));
  assert.deepEqual(
    decryptHandoffPayload(encrypted, TEST_ONLY_SECRET),
    payload
  );
});

test('rechaza descifrar con una clave incorrecta', () => {
  const encrypted = encryptHandoffPayload({ value: 'test' }, TEST_ONLY_SECRET);

  assert.throws(
    () => decryptHandoffPayload(encrypted, 'another-test-only-secret-that-is-long-enough'),
    /No se pudo validar/
  );
});
