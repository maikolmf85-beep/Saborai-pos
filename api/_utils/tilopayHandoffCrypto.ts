import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto';

const HANDOFF_CONTEXT = 'saborai:tilopay-signup-handoff:v1';

export interface EncryptedHandoffPayload {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
}

function deriveEncryptionKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error('El secreto de cifrado de referencias no está configurado correctamente.');
  }

  return createHash('sha256')
    .update(HANDOFF_CONTEXT)
    .update('\0')
    .update(secret, 'utf8')
    .digest();
}

export function createHandoffReference(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidHandoffReference(reference: unknown): reference is string {
  return typeof reference === 'string' && /^[A-Za-z0-9_-]{43}$/.test(reference);
}

export function hashHandoffReference(reference: string): string {
  return createHash('sha256').update(reference, 'utf8').digest('hex');
}

export function encryptHandoffPayload(payload: unknown, secret: string): EncryptedHandoffPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(HANDOFF_CONTEXT, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);

  return {
    version: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

export function decryptHandoffPayload<T>(
  encrypted: EncryptedHandoffPayload,
  secret: string
): T {
  try {
    if (
      encrypted?.version !== 1 ||
      typeof encrypted.iv !== 'string' ||
      typeof encrypted.ciphertext !== 'string' ||
      typeof encrypted.tag !== 'string'
    ) {
      throw new Error('Invalid encrypted handoff payload.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(secret),
      Buffer.from(encrypted.iv, 'base64url')
    );
    decipher.setAAD(Buffer.from(HANDOFF_CONTEXT, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new Error('No se pudo validar el estado temporal del registro.');
  }
}
