/**
 * Compacta una identificación costarricense a letras y números en mayúscula.
 * Conserva las cédulas jurídicas alfanuméricas admitidas por Hacienda; solo
 * elimina el cero inicial en la forma numérica antigua de 10 dígitos.
 */
export function normalizeFiscalIdentification(value: unknown): string {
  const compact = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^0\d{9}$/.test(compact) ? compact.slice(1) : compact;
}

/** La clave mantiene los 50 espacios y permite letras solo en el ID de 12 caracteres. */
export function isValidFiscalClave(value: unknown): value is string {
  return typeof value === 'string' && /^\d{9}[A-Z0-9]{12}\d{29}$/i.test(value);
}
