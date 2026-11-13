export const HACIENDA_P12_PIN_FORMAT_ERROR =
  'Usa exactamente 4 dígitos numéricos para el PIN legacy o 14 caracteres para la contraseña de la llave .p12.';

/**
 * Accepts the legacy four-digit numeric PIN or the current fourteen-character password.
 * It deliberately does not trim, case-fold, normalize, or otherwise rewrite input.
 */
export function isValidHaciendaP12Pin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9]{4}$/.test(value) || value.length === 14;
}

export function isValidHaciendaP12PinInput(value: unknown): boolean {
  return value === '' || isValidHaciendaP12Pin(value);
}
