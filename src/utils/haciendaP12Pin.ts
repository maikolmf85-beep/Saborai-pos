export const HACIENDA_P12_PIN_FORMAT_ERROR =
  'Usa un PIN numérico de 4 dígitos o una contraseña de al menos 15 caracteres con una mayúscula, un número y un símbolo.';

/**
 * Accepts the legacy four-digit PIN or the reported long .p12 passphrase format.
 * It deliberately does not trim, case-fold, normalize, or otherwise rewrite input.
 */
export function isValidHaciendaP12Pin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^[0-9]{4}$/.test(value)) return true;

  const characterCount = Array.from(value).length;
  return characterCount >= 15
    && /\p{Lu}/u.test(value)
    && /\p{N}/u.test(value)
    && /[\p{P}\p{S}]/u.test(value);
}
