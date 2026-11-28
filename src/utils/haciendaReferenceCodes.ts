const REFERENCE_REASON_CODES = new Set([
  '01', '02', '04', '05', '06', '07', '08', '09', '10', '11', '12',
  '13', '14', '15', '16', '17', '99'
]);

const REFERENCE_DOCUMENT_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
  '12', '13', '14', '15', '16', '17', '18', '19', '20', '99'
]);

const LEGACY_DOCUMENT_ALIASES: Record<string, string> = {
  FE: '01',
  ND: '02',
  NC: '03',
  TE: '04'
};

/** Map existing internal FE/TE/NC/ND names to Hacienda's note 10 codes. */
export function normalizeReferenceDocumentCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = LEGACY_DOCUMENT_ALIASES[value] || value;
  return REFERENCE_DOCUMENT_CODES.has(code) ? code : null;
}

/** Validate a note 9 reason; code 17 is reserved for Recibo Electrónico de Pago. */
export function isValidReferenceReasonCode(value: unknown, currentDocumentType?: unknown): value is string {
  if (typeof value !== 'string' || !REFERENCE_REASON_CODES.has(value)) return false;
  if (value !== '17') return true;
  return currentDocumentType === 'REP' || currentDocumentType === '10';
}
