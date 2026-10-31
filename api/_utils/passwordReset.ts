import { createHash, randomBytes } from 'node:crypto';

const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PASSWORD_RESET_TOKEN_TABLE = 'password_reset_tokens';

export interface IssuedPasswordResetToken {
  token: string;
  tokenHash: string;
}

export function createPasswordResetToken(): IssuedPasswordResetToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token, 'ascii').digest('hex')
  };
}

export function hashPasswordResetToken(token: unknown): string | null {
  if (typeof token !== 'string' || !PASSWORD_RESET_TOKEN_PATTERN.test(token)) return null;
  return createHash('sha256').update(token, 'ascii').digest('hex');
}

/**
 * Consumes a valid token in one atomic DELETE statement. Only one concurrent
 * request can receive the row; expired or already-used tokens return null.
 */
export async function consumePasswordResetToken(
  token: unknown,
  database: any,
  now = new Date()
): Promise<string | null> {
  const tokenHash = hashPasswordResetToken(token);
  if (!tokenHash) return null;

  const { data, error } = await database
    .from(PASSWORD_RESET_TOKEN_TABLE)
    .delete()
    .eq('token_hash', tokenHash)
    .gt('expires_at', now.toISOString())
    .select('user_id')
    .maybeSingle();

  if (error) throw error;
  return typeof data?.user_id === 'string' ? data.user_id : null;
}
