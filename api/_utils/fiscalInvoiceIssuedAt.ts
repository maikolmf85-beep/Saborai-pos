const ZONED_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** Returns a canonical UTC instant only for ISO timestamps with an explicit zone. */
export function parseFiscalInvoiceIssuedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!ZONED_ISO_TIMESTAMP.test(source)) return null;
  const datePart = source.slice(0, 10);
  const calendarDate = Date.parse(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate) || new Date(calendarDate).toISOString().slice(0, 10) !== datePart) return null;
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}
