import {
  createCashShiftV2FiscalInvoiceProjection,
  isValidCashShiftV2ServerOrderFinancials,
  type CashShiftV2CalculatedOrderLine,
  type CashShiftV2ServerOrderFinancials,
  type CashShiftV2TaxBreakdown
} from './cashShiftV2Contract.ts';

/** Metadatos que deben venir del catálogo vigente y validado por el servidor. */
export interface CashShiftV2HaciendaCatalogMetadata {
  lineId: string;
  cabysCode: string;
  unit?: string;
}

/**
 * DTO de serialización, no XML ni autorización para emitir.
 * Todos los montos permanecen como strings numeric(18,5). El serializador futuro
 * debe copiar estos valores y no volver a calcular subtotal, IVA, servicio o total.
 */
export interface CashShiftV2HaciendaSerializationInput {
  authority: 'SERVER';
  policy: 'PRESERVE_SERVER_FINANCIALS_NO_RECALCULATION';
  currency: 'CRC' | 'USD';
  taxRegime: 'IVA_13' | 'IVA_0';
  subtotal: string;
  taxBreakdown: CashShiftV2TaxBreakdown[];
  vatTotal: string;
  serviceRate: '0.1000';
  serviceAmount: string;
  totalComprobante: string;
  lines: CashShiftV2HaciendaSerializationLine[];
}

export interface CashShiftV2HaciendaSerializationLine {
  lineNumber: number;
  lineId: string;
  cabysCode: string;
  unit: string;
  description: string;
  quantity: string;
  unitPrice: string;
  baseAmount: string;
  vatRate: string;
  vatTariffCode: '10' | '02' | '03' | '04' | '08';
  vatAmount: string;
  totalLine: string;
}

const VAT_TARIFF_CODE: Record<CashShiftV2CalculatedOrderLine['taxRate'], CashShiftV2HaciendaSerializationLine['vatTariffCode']> = {
  '0.0000': '10',
  '0.0100': '02',
  '0.0200': '03',
  '0.0400': '04',
  '0.1300': '08'
};
const DEFAULT_SERVICE_UNIT = 'Os';
const DEFAULT_GOODS_UNIT = 'Unid';
const MAX_CABYS = 13;
const MAX_UNIT_LENGTH = 20;

function isValidCabysCode(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^\\d{${MAX_CABYS}}$`).test(value) && !/^0+$/.test(value);
}

function isValidUnit(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_UNIT_LENGTH;
}

function defaultUnitForCabys(cabysCode: string): string {
  return Number(cabysCode[0]) >= 5 ? DEFAULT_SERVICE_UNIT : DEFAULT_GOODS_UNIT;
}

/**
 * Construye la proyección de serialización desde finanzas server-authoritative.
 * Falla cerrado si falta o se duplica metadata fiscal del catálogo; no repara CABYS,
 * no convierte importes a Number y no llama al generador XML legacy.
 */
export function createCashShiftV2HaciendaSerializationInput(
  serverOrder: CashShiftV2ServerOrderFinancials,
  catalogMetadata: readonly CashShiftV2HaciendaCatalogMetadata[]
): CashShiftV2HaciendaSerializationInput {
  if (!isValidCashShiftV2ServerOrderFinancials(serverOrder)) {
    throw new Error('La proyección Hacienda V2 requiere finanzas autoritativas verificadas por servidor.');
  }
  if (!Array.isArray(catalogMetadata)) {
    throw new Error('Falta metadata fiscal validada por el servidor para Hacienda V2.');
  }

  const fiscal = createCashShiftV2FiscalInvoiceProjection(serverOrder);
  const byLineId = new Map<string, CashShiftV2HaciendaCatalogMetadata>();
  for (const metadata of catalogMetadata) {
    if (!metadata || typeof metadata.lineId !== 'string' || !metadata.lineId.trim()
      || !isValidCabysCode(metadata.cabysCode) || (metadata.unit !== undefined && !isValidUnit(metadata.unit))
      || byLineId.has(metadata.lineId)) {
      throw new Error('Metadata CABYS duplicada o inválida para Hacienda V2.');
    }
    byLineId.set(metadata.lineId, metadata);
  }

  if (byLineId.size !== fiscal.lines.length) {
    throw new Error('La metadata CABYS no corresponde exactamente a las líneas fiscales V2.');
  }

  const lines = fiscal.lines.map((line, index) => {
    const metadata = byLineId.get(line.lineId);
    if (!metadata || line.resolutionState === 'VOIDED' || line.resolutionState === 'PRICE_REVIEW'
      || line.resolutionState === 'MISSING_ITEM') {
      throw new Error('No se serializan líneas V2 ausentes, retenidas o anuladas.');
    }
    const tariffCode = VAT_TARIFF_CODE[line.taxRate];
    if (!tariffCode) throw new Error('La tasa de IVA V2 no tiene código fiscal permitido.');
    return {
      lineNumber: index + 1,
      lineId: line.lineId,
      cabysCode: metadata.cabysCode,
      unit: metadata.unit?.trim() || defaultUnitForCabys(metadata.cabysCode),
      description: line.itemName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      baseAmount: line.lineSubtotal,
      vatRate: line.taxRate,
      vatTariffCode: tariffCode,
      vatAmount: line.lineVat,
      totalLine: line.lineTotal
    };
  });

  return {
    authority: 'SERVER',
    policy: 'PRESERVE_SERVER_FINANCIALS_NO_RECALCULATION',
    currency: fiscal.currency,
    taxRegime: serverOrder.branchFiscalProfile.taxRegime,
    subtotal: fiscal.subtotal,
    taxBreakdown: fiscal.taxBreakdown.map(entry => ({ ...entry })),
    vatTotal: fiscal.vatTotal,
    serviceRate: fiscal.serviceRate,
    serviceAmount: fiscal.serviceAmount,
    totalComprobante: fiscal.totalComprobante,
    lines
  };
}
