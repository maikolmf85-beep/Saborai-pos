export const HACIENDA_P12_PIN_FORMAT_ERROR =
  'Usa exactamente 4 o 14 dígitos numéricos para el PIN de la llave .p12.';

/**
 * Accepts the legacy four-digit PIN or the current fourteen-digit numeric PIN.
 * It deliberately does not trim, case-fold, normalize, or otherwise rewrite input.
 */
export function isValidHaciendaP12Pin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9]{4}$/.test(value) || /^[0-9]{14}$/.test(value);
}

export function isValidHaciendaP12PinInput(value: unknown): boolean {
  return value === '' || isValidHaciendaP12Pin(value);
}
