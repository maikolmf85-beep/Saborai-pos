export const HACIENDA_P12_PIN_FORMAT_ERROR =
  'Ingresa el PIN legacy de 4 dígitos o una contraseña de exactamente 14 caracteres (letras, números o símbolos).';

/**
 * Accepts exactly the supported legacy PIN or new passphrase formats.
 * The input is validated as entered and is never trimmed or normalized.
 */
export function isValidHaciendaP12Pin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^[0-9]{4}$/.test(value)) return true;

  const characters = Array.from(value);
  return characters.length === 14
    && characters.every(character => /[\p{L}\p{N}\p{P}\p{S}\p{M}]/u.test(character));
}
