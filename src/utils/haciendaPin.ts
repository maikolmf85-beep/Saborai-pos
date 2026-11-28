const LEGACY_P12_PIN_PATTERN = /^\d{4}$/;
const NEW_P12_PIN_LENGTH = 14;

/**
 * Hacienda legacy keys use a four-digit PIN. New keys use exactly 14
 * characters. This validator deliberately does not trim or normalize the
 * supplied value because the exact password bytes are significant to PKCS#12.
 */
export function isValidP12Pin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return LEGACY_P12_PIN_PATTERN.test(value) || Array.from(value).length === NEW_P12_PIN_LENGTH;
}
