import type { ElectronicInvoiceItem } from '../types/index.js';

type UnknownRecord = Record<string, unknown>;

const INTERNAL_ACCOUNT_FIELDS = new Set(['dinerName', 'subAccountId', 'subAccounts', 'activeOrder']);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectFiscalItem(value: unknown): ElectronicInvoiceItem {
  const item = isRecord(value) ? value : {};
  const projected: ElectronicInvoiceItem = {
    name: typeof item.name === 'string' ? item.name : '',
    price: typeof item.price === 'number' ? item.price : 0,
    quantity: typeof item.quantity === 'number' ? item.quantity : 0,
    cabysCode: typeof item.cabysCode === 'string' ? item.cabysCode : '',
    taxRate: typeof item.taxRate === 'number' ? item.taxRate : 0,
    category: typeof item.category === 'string' ? item.category : ''
  };

  if (typeof item.unidadMedida === 'string') projected.unidadMedida = item.unidadMedida;
  if (typeof item.unit === 'string') projected.unit = item.unit;
  return projected;
}

function stripInternalAccountFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalAccountFields);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INTERNAL_ACCOUNT_FIELDS.has(key))
      .map(([key, entry]) => [key, stripInternalAccountFields(entry)])
  );
}

/** Project order items onto the small set of fields needed by an electronic invoice. */
export function toFiscalInvoiceItems(items: readonly unknown[]): ElectronicInvoiceItem[] {
  return sanitizeFiscalInvoiceItems(items);
}

/** Project untrusted API item arrays onto the same fiscal-only field set. */
export function sanitizeFiscalInvoiceItems(items: readonly unknown[]): ElectronicInvoiceItem[] {
  return items.map(projectFiscalItem);
}

/** Remove account/order metadata and non-fiscal item fields from invoice data at API boundaries. */
export function sanitizeFiscalInvoiceData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { items: [] };

  const sanitized = stripInternalAccountFields(value) as UnknownRecord;
  sanitized.items = Array.isArray(value.items)
    ? sanitizeFiscalInvoiceItems(value.items)
    : [];
  return sanitized;
}
