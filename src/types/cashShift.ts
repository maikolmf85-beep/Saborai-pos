// SaborAI POS - Cash Shift & Cash Drawer Management Types (Apertura, Cierre y Arqueo)

export type ShiftStatus = 'OPEN' | 'CLOSING' | 'CLOSED';
export type CashMovementType = 'INFLOW' | 'OUTFLOW' | 'TIP_WITHDRAWAL';

export interface CashDenominationBreakdown {
  // Billetes CRC
  bills20000: number;
  bills10000: number;
  bills5000: number;
  bills2000: number;
  bills1000: number;
  // Monedas CRC
  coins500: number;
  coins100: number;
  coins50: number;
  coins25: number;
  coins10: number;
  coins5: number;
  // Divisas USD
  usdCashTotal?: number;
  usdExchangeRate?: number;
}

export interface CashMovement {
  id: string;
  shiftId: string;
  timestamp: string; // ISO string
  type: CashMovementType;
  amount: number;
  reason: string;
  authorizedBy: string;
  performedBy: string;
}

export interface ShiftSystemSummary {
  cashSales: number;
  cardSales: number;
  sinpeSales: number;
  totalSales: number;
  subtotal: number;
  totalTax: number;
  serviceTax10: number;
  totalInflows: number;
  totalOutflows: number;
  expectedCashInDrawer: number; // initialFloat + cashSales + totalInflows - totalOutflows
  invoicesCount: number;
}

export interface CashRegister {
  id: string; // ej. 'caja-01', 'caja-02'
  name: string; // ej. 'Caja 1 - Barra Principal'
  terminalCode: string; // '00001' (5 dígitos oficial DGT Hacienda)
  branchCode: string; // '001' (3 dígitos sucursal)
  isDefault?: boolean;
  allowsBilling: boolean;
  allowsOrdering: boolean;
  assignedPrinterId?: string;
  isActive: boolean;
  notes?: string;
}

export interface CashShift {
  id: string;
  shiftNumber: number;
  tenantId: string;
  terminalId: string;
  cashRegisterId?: string;
  cashRegisterName?: string;
  terminalCode?: string;
  openedBy: {
    userId: string;
    userName: string;
    userRole: string;
  };
  openedAt: string; // ISO string
  initialCashFloat: number; // Fondo de caja inicial
  status: ShiftStatus;
  notes?: string;

  // Movimientos registrados durante el turno (egresos / ingresos)
  movements: CashMovement[];

  // Cierre y Arqueo
  closedBy?: {
    userId: string;
    userName: string;
  };
  closedAt?: string;

  // Resumen teórico calculado por el sistema
  systemSummary: ShiftSystemSummary;

  // Declaración física del cajero (Arqueo ciego)
  countedCash?: number;
  cashBreakdown?: CashDenominationBreakdown;
  countedCards?: number; // Total vouchers datáfono (suma de todos los datáfonos)
  dataphonesBreakdown?: DataphoneClosingEntry[]; // Desglose de hasta 4 datáfonos físicos
  countedSinpe?: number; // Total transferencias SINPE
  
  // Balance y diferencias
  cashDifference?: number; // countedCash - expectedCashInDrawer
  differenceReason?: string;
  
  zReportGenerated?: boolean;
}

export interface DataphoneClosingEntry {
  id: string; // 'df_1', 'df_2', 'df_3', 'df_4'
  name: string; // ej. 'Datáfono 1 - BAC Credomatic'
  amount: number;
}

export interface ZReportData {
  shiftNumber: number;
  tenantName: string;
  cedulaJuridica: string;
  location: string;
  terminalId: string;
  cashRegisterName?: string;
  openedAt: string;
  closedAt: string;
  cashierName: string;
  supervisorName?: string;
  initialFloat: number;
  salesSummary: {
    grossTotal: number;
    subtotal: number;
    taxTotal: number;
    service10Total: number;
    cashTotal: number;
    cardTotal: number;
    sinpeTotal: number;
    invoicesCount: number;
  };
  cashFlowSummary: {
    initialFloat: number;
    cashSales: number;
    inflows: number;
    outflows: number; // Egresos
    expectedCash: number;
    countedCash: number;
    difference: number;
    status: 'EXACT' | 'SHORTAGE' | 'SURPLUS';
  };
  cardSummary: {
    expected: number;
    counted: number;
    difference: number;
    dataphonesBreakdown?: DataphoneClosingEntry[];
  };
  sinpeSummary: {
    expected: number;
    counted: number;
    difference: number;
  };
  movements: CashMovement[];
}

export interface ConsolidatedZReportData {
  reportDate: string;
  tenantName: string;
  cedulaJuridica: string;
  location: string;
  branchCode: string;
  generatedAt: string;
  generatedBy: string;
  registersSummary: {
    registerId: string;
    registerName: string;
    terminalCode: string;
    shiftsCount: number;
    initialFloatTotal: number;
    cashSales: number;
    cardSales: number;
    sinpeSales: number;
    totalSales: number;
    inflowsTotal: number;
    outflowsTotal: number;
    taxTotal: number;
    service10Total: number;
    expectedCash: number;
    countedCash: number;
    difference: number;
  }[];
  totals: {
    grossTotal: number;
    subtotal: number;
    taxTotal: number;
    service10Total: number;
    cashTotal: number;
    cardTotal: number;
    sinpeTotal: number;
    initialFloatTotal: number;
    inflowsTotal: number;
    outflowsTotal: number;
    expectedCashTotal: number;
    countedCashTotal: number;
    differenceTotal: number;
    invoicesCount: number;
  };
}
