// SaborAI POS - Cash Shift Service Multi-Caja (Apertura, Movimientos, Arqueo Ciego y Reporte Z por Terminal)
import { 
  CashShift, 
  CashMovement, 
  CashMovementType, 
  CashDenominationBreakdown, 
  ZReportData, 
  ShiftSystemSummary,
  CashRegister,
  ConsolidatedZReportData,
  DataphoneClosingEntry
} from '../types/cashShift';
import { UserProfile, TenantInfo } from '../types';

const STORAGE_KEY_ACTIVE_SHIFTS_MAP = 'saborai_active_shifts_map';
const STORAGE_KEY_CURRENT_TERMINAL_ID = 'saborai_current_terminal_id';
const STORAGE_KEY_CASH_REGISTERS = 'saborai_cash_registers';
const STORAGE_KEY_SHIFTS_HISTORY = 'saborai_shifts_history';
const STORAGE_KEY_ACTIVE_SHIFT_LEGACY = 'saborai_active_shift';

const DEFAULT_REGISTERS: CashRegister[] = [
  {
    id: 'caja-01',
    name: 'Caja 1 - Barra Principal',
    terminalCode: '00001',
    branchCode: '001',
    isDefault: true,
    allowsBilling: true,
    allowsOrdering: true,
    isActive: true,
    notes: 'Terminal de cobro principal en barra'
  },
  {
    id: 'caja-02',
    name: 'Caja 2 - Salón Principal',
    terminalCode: '00002',
    branchCode: '001',
    isDefault: false,
    allowsBilling: true,
    allowsOrdering: true,
    isActive: true,
    notes: 'Terminal secundaria de cobro y comandas en salón'
  },
  {
    id: 'caja-03',
    name: 'Caja 3 - Terraza / Delivery',
    terminalCode: '00003',
    branchCode: '001',
    isDefault: false,
    allowsBilling: true,
    allowsOrdering: true,
    isActive: true,
    notes: 'Punto de cobro para pedidos de terraza y despacho'
  }
];

class CashShiftService {
  private registers: CashRegister[] = [];
  private currentTerminalId: string = 'caja-01';
  private activeShiftsMap: Record<string, CashShift> = {}; // key: registerId (e.g. 'caja-01')
  private shiftsHistory: CashShift[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      // 1. Load registers
      const savedRegisters = localStorage.getItem(STORAGE_KEY_CASH_REGISTERS);
      if (savedRegisters) {
        this.registers = JSON.parse(savedRegisters);
      } else {
        this.registers = [...DEFAULT_REGISTERS];
        localStorage.setItem(STORAGE_KEY_CASH_REGISTERS, JSON.stringify(this.registers));
      }

      // 2. Load current terminal ID for this device
      const savedTerminalId = localStorage.getItem(STORAGE_KEY_CURRENT_TERMINAL_ID);
      if (savedTerminalId && this.registers.some(r => r.id === savedTerminalId)) {
        this.currentTerminalId = savedTerminalId;
      } else {
        const defaultReg = this.registers.find(r => r.isDefault) || this.registers[0];
        this.currentTerminalId = defaultReg ? defaultReg.id : 'caja-01';
        localStorage.setItem(STORAGE_KEY_CURRENT_TERMINAL_ID, this.currentTerminalId);
      }

      // 3. Load active shifts map
      const savedShiftsMap = localStorage.getItem(STORAGE_KEY_ACTIVE_SHIFTS_MAP);
      if (savedShiftsMap) {
        this.activeShiftsMap = JSON.parse(savedShiftsMap);
      } else {
        // Check legacy single active shift for migration
        const legacyActive = localStorage.getItem(STORAGE_KEY_ACTIVE_SHIFT_LEGACY);
        if (legacyActive) {
          const parsedLegacy: CashShift = JSON.parse(legacyActive);
          parsedLegacy.cashRegisterId = parsedLegacy.cashRegisterId || 'caja-01';
          parsedLegacy.cashRegisterName = parsedLegacy.cashRegisterName || 'Caja 1 - Barra Principal';
          parsedLegacy.terminalCode = parsedLegacy.terminalCode || '00001';
          this.activeShiftsMap['caja-01'] = parsedLegacy;
        }
      }

      // 4. Load shifts history
      const savedHistory = localStorage.getItem(STORAGE_KEY_SHIFTS_HISTORY);
      if (savedHistory) {
        this.shiftsHistory = JSON.parse(savedHistory);
      } else {
        this.shiftsHistory = [
          this.createMockHistoricalShift()
        ];
      }
    } catch (e) {
      console.warn('Error loading shifts from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY_CASH_REGISTERS, JSON.stringify(this.registers));
      localStorage.setItem(STORAGE_KEY_CURRENT_TERMINAL_ID, this.currentTerminalId);
      localStorage.setItem(STORAGE_KEY_ACTIVE_SHIFTS_MAP, JSON.stringify(this.activeShiftsMap));
      localStorage.setItem(STORAGE_KEY_SHIFTS_HISTORY, JSON.stringify(this.shiftsHistory));

      // Keep legacy active shift key updated for any direct legacy consumer
      const currentShift = this.activeShiftsMap[this.currentTerminalId];
      if (currentShift) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_SHIFT_LEGACY, JSON.stringify(currentShift));
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_SHIFT_LEGACY);
      }
    } catch (e) {
      console.warn('Error saving shifts to storage:', e);
    }
  }

  // --- Cash Registers Management ---

  getCashRegisters(): CashRegister[] {
    return this.registers;
  }

  getCurrentRegisterId(): string {
    return this.currentTerminalId;
  }

  setCurrentRegisterId(id: string): CashRegister {
    const target = this.registers.find(r => r.id === id);
    if (!target) {
      throw new Error(`La caja con ID "${id}" no existe.`);
    }
    this.currentTerminalId = id;
    this.saveToStorage();
    return target;
  }

  getCurrentRegister(): CashRegister {
    const reg = this.registers.find(r => r.id === this.currentTerminalId);
    if (reg) return reg;
    return this.registers[0] || DEFAULT_REGISTERS[0];
  }

  createCashRegister(data: {
    name: string;
    terminalCode: string;
    branchCode?: string;
    allowsBilling?: boolean;
    allowsOrdering?: boolean;
    assignedPrinterId?: string;
    notes?: string;
  }): CashRegister {
    // Format terminal code to 5 digits
    const paddedTerminal = data.terminalCode.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5) || '00001';
    const paddedBranch = (data.branchCode || '001').replace(/[^0-9]/g, '').padStart(3, '0').slice(-3);

    const nextId = `caja_${Date.now().toString().slice(-4)}_${Math.random().toString(36).substring(2, 5)}`;
    const newReg: CashRegister = {
      id: nextId,
      name: data.name.trim(),
      terminalCode: paddedTerminal,
      branchCode: paddedBranch,
      isDefault: false,
      allowsBilling: data.allowsBilling ?? true,
      allowsOrdering: data.allowsOrdering ?? true,
      assignedPrinterId: data.assignedPrinterId,
      isActive: true,
      notes: data.notes?.trim() || ''
    };

    this.registers.push(newReg);
    this.saveToStorage();
    return newReg;
  }

  updateCashRegister(id: string, updates: Partial<CashRegister>): CashRegister {
    const index = this.registers.findIndex(r => r.id === id);
    if (index === -1) {
      throw new Error(`Caja con ID "${id}" no encontrada.`);
    }

    if (updates.terminalCode) {
      updates.terminalCode = updates.terminalCode.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5);
    }
    if (updates.branchCode) {
      updates.branchCode = updates.branchCode.replace(/[^0-9]/g, '').padStart(3, '0').slice(-3);
    }

    if (updates.name && updates.name.trim()) {
      updates.name = updates.name.trim();
    }

    this.registers[index] = {
      ...this.registers[index],
      ...updates
    };

    // Keep active shift metadata synced immediately if open
    if (this.activeShiftsMap[id]) {
      if (updates.name) {
        this.activeShiftsMap[id].cashRegisterName = updates.name;
      }
      if (updates.terminalCode) {
        this.activeShiftsMap[id].terminalCode = updates.terminalCode;
        this.activeShiftsMap[id].terminalId = updates.terminalCode;
      }
    }

    this.saveToStorage();
    return this.registers[index];
  }

  deleteCashRegister(id: string): boolean {
    if (this.registers.length <= 1) {
      throw new Error('El restaurante debe contar con al menos una caja activa.');
    }
    if (this.activeShiftsMap[id]) {
      throw new Error('No se puede eliminar una caja con un turno abierto. Primero debe cerrarse el turno.');
    }

    this.registers = this.registers.filter(r => r.id !== id);
    if (this.currentTerminalId === id) {
      this.currentTerminalId = this.registers[0].id;
    }
    this.saveToStorage();
    return true;
  }

  // --- Active Shifts Management (Per Register) ---

  getActiveShift(registerId?: string): CashShift | null {
    const targetId = registerId || this.currentTerminalId;
    return this.activeShiftsMap[targetId] || null;
  }

  getAllActiveShifts(): { register: CashRegister; shift: CashShift | null }[] {
    return this.registers.map(reg => ({
      register: reg,
      shift: this.activeShiftsMap[reg.id] || null
    }));
  }

  getShiftsHistory(registerId?: string): CashShift[] {
    if (registerId) {
      return this.shiftsHistory.filter(s => s.cashRegisterId === registerId);
    }
    return this.shiftsHistory;
  }

  openShift(
    tenant: TenantInfo,
    openedByUser: UserProfile,
    initialFloat: number,
    notes?: string,
    registerId?: string
  ): CashShift {
    const targetRegisterId = registerId || this.currentTerminalId;
    const register = this.registers.find(r => r.id === targetRegisterId) || this.getCurrentRegister();

    if (this.activeShiftsMap[targetRegisterId] && this.activeShiftsMap[targetRegisterId].status === 'OPEN') {
      throw new Error(`La ${register.name} ya tiene un turno de caja activo. Debe cerrarse antes de abrir uno nuevo.`);
    }

    const nextShiftNumber = this.shiftsHistory.filter(s => s.cashRegisterId === targetRegisterId).length + 1;

    const initialSummary: ShiftSystemSummary = {
      cashSales: 0,
      cardSales: 0,
      sinpeSales: 0,
      totalSales: 0,
      subtotal: 0,
      totalTax: 0,
      serviceTax10: 0,
      totalInflows: 0,
      totalOutflows: 0,
      expectedCashInDrawer: initialFloat,
      invoicesCount: 0
    };

    const newShift: CashShift = {
      id: `shift_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      shiftNumber: nextShiftNumber,
      tenantId: tenant.id,
      terminalId: register.terminalCode,
      cashRegisterId: register.id,
      cashRegisterName: register.name,
      terminalCode: register.terminalCode,
      openedBy: {
        userId: openedByUser.id,
        userName: openedByUser.name,
        userRole: openedByUser.role
      },
      openedAt: new Date().toISOString(),
      initialCashFloat: initialFloat,
      status: 'OPEN',
      notes: notes || '',
      movements: [],
      systemSummary: initialSummary
    };

    this.activeShiftsMap[targetRegisterId] = newShift;
    this.saveToStorage();
    return newShift;
  }

  recordSalePayment(params: {
    cashAmount?: number;
    cardAmount?: number;
    sinpeAmount?: number;
    subtotal?: number;
    tax?: number;
    service10?: number;
    registerId?: string;
  }): void {
    const targetRegisterId = params.registerId || this.currentTerminalId;
    const shift = this.activeShiftsMap[targetRegisterId];

    if (!shift || shift.status !== 'OPEN') {
      return; // No active shift to accumulate
    }

    const s = shift.systemSummary;
    const cash = params.cashAmount || 0;
    const card = params.cardAmount || 0;
    const sinpe = params.sinpeAmount || 0;
    const subtotal = params.subtotal || 0;
    const tax = params.tax || 0;
    const serv10 = params.service10 || 0;

    s.cashSales += cash;
    s.cardSales += card;
    s.sinpeSales += sinpe;
    s.totalSales += (cash + card + sinpe);
    s.subtotal += subtotal;
    s.totalTax += tax;
    s.serviceTax10 += serv10;
    s.invoicesCount += 1;

    // Recalculate expected cash in drawer
    s.expectedCashInDrawer = shift.initialCashFloat + s.cashSales + s.totalInflows - s.totalOutflows;

    this.saveToStorage();
  }

  recordCashMovement(
    type: CashMovementType,
    amount: number,
    reason: string,
    authorizedBy: string,
    performedBy: string,
    registerId?: string
  ): CashMovement {
    const targetRegisterId = registerId || this.currentTerminalId;
    const shift = this.activeShiftsMap[targetRegisterId];

    if (!shift || shift.status !== 'OPEN') {
      throw new Error(`No hay un turno abierto en esta caja (${targetRegisterId}) para registrar movimientos.`);
    }

    const movement: CashMovement = {
      id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      shiftId: shift.id,
      timestamp: new Date().toISOString(),
      type,
      amount,
      reason,
      authorizedBy,
      performedBy
    };

    shift.movements.push(movement);

    if (type === 'INFLOW') {
      shift.systemSummary.totalInflows += amount;
    } else {
      shift.systemSummary.totalOutflows += amount;
    }

    // Recalculate expected cash
    const s = shift.systemSummary;
    s.expectedCashInDrawer = shift.initialCashFloat + s.cashSales + s.totalInflows - s.totalOutflows;

    this.saveToStorage();
    return movement;
  }

  calculateDenominationsTotal(breakdown: CashDenominationBreakdown): number {
    const billsTotal = 
      (breakdown.bills20000 || 0) * 20000 +
      (breakdown.bills10000 || 0) * 10000 +
      (breakdown.bills5000  || 0) * 5000 +
      (breakdown.bills2000  || 0) * 2000 +
      (breakdown.bills1000  || 0) * 1000;

    const coinsTotal = 
      (breakdown.coins500 || 0) * 500 +
      (breakdown.coins100 || 0) * 100 +
      (breakdown.coins50  || 0) * 50 +
      (breakdown.coins25  || 0) * 25 +
      (breakdown.coins10  || 0) * 10 +
      (breakdown.coins5   || 0) * 5;

    const usdInCRC = (breakdown.usdCashTotal || 0) * (breakdown.usdExchangeRate || 515);

    return billsTotal + coinsTotal + Math.round(usdInCRC);
  }

  closeShift(
    countedCash: number,
    countedCards: number,
    countedSinpe: number,
    closedByUser: UserProfile,
    cashBreakdown?: CashDenominationBreakdown,
    differenceReason?: string,
    registerId?: string,
    dataphonesBreakdown?: DataphoneClosingEntry[]
  ): { closedShift: CashShift; zReport: ZReportData } {
    const targetRegisterId = registerId || this.currentTerminalId;
    const shift = this.activeShiftsMap[targetRegisterId];

    if (!shift || shift.status !== 'OPEN') {
      throw new Error(`No hay un turno abierto en esta caja para cerrar.`);
    }

    const expected = shift.systemSummary.expectedCashInDrawer;
    const diff = countedCash - expected;

    shift.status = 'CLOSED';
    shift.closedBy = {
      userId: closedByUser.id,
      userName: closedByUser.name
    };
    shift.closedAt = new Date().toISOString();
    shift.countedCash = countedCash;
    shift.countedCards = countedCards;
    shift.dataphonesBreakdown = dataphonesBreakdown;
    shift.countedSinpe = countedSinpe;
    shift.cashBreakdown = cashBreakdown;
    shift.cashDifference = diff;
    shift.differenceReason = differenceReason || '';
    shift.zReportGenerated = true;

    // Archive into history (newest first)
    this.shiftsHistory = [shift, ...this.shiftsHistory];
    delete this.activeShiftsMap[targetRegisterId];
    this.saveToStorage();

    const zReport = this.generateZReport(shift);
    return { closedShift: shift, zReport };
  }

  generateZReport(shift: CashShift, tenant?: TenantInfo): ZReportData {
    const s = shift.systemSummary || {
      cashSales: 0,
      cardSales: 0,
      sinpeSales: 0,
      totalSales: 0,
      subtotal: 0,
      totalTax: 0,
      serviceTax10: 0,
      totalInflows: 0,
      totalOutflows: 0,
      expectedCashInDrawer: shift.initialCashFloat || 0,
      invoicesCount: 0
    };
    const diff = shift.cashDifference ?? 0;
    let diffStatus: 'EXACT' | 'SHORTAGE' | 'SURPLUS' = 'EXACT';
    if (diff < -100) diffStatus = 'SHORTAGE';
    else if (diff > 100) diffStatus = 'SURPLUS';

    const register = this.registers.find(r => r.id === shift.cashRegisterId) || this.getCurrentRegister();
    const gross = s.totalSales || 0;

    return {
      shiftNumber: shift.shiftNumber || 1,
      tenantName: tenant?.name || 'Restaurante Fuego & Palmera S.A.',
      cedulaJuridica: tenant?.cedulaJuridica || '3-101-884920',
      location: tenant?.location || 'San José, Escazú',
      terminalId: shift.terminalCode || register?.terminalCode || '00001',
      cashRegisterName: shift.cashRegisterName || register?.name || 'Caja Principal',
      openedAt: shift.openedAt || new Date().toISOString(),
      closedAt: shift.closedAt || new Date().toISOString(),
      cashierName: shift.closedBy?.userName || shift.openedBy?.userName || 'Cajero',
      supervisorName: shift.openedBy?.userRole === 'ADMIN' ? shift.openedBy.userName : undefined,
      initialFloat: shift.initialCashFloat || 0,
      salesSummary: {
        grossTotal: gross,
        subtotal: s.subtotal || Math.round(gross / 1.23),
        taxTotal: s.totalTax || Math.round(gross * 0.13),
        service10Total: s.serviceTax10 || Math.round(gross * 0.10),
        cashTotal: s.cashSales || 0,
        cardTotal: s.cardSales || 0,
        sinpeTotal: s.sinpeSales || 0,
        invoicesCount: s.invoicesCount || 0
      },
      cashFlowSummary: {
        initialFloat: shift.initialCashFloat || 0,
        cashSales: s.cashSales || 0,
        inflows: s.totalInflows || 0,
        outflows: s.totalOutflows || 0,
        expectedCash: s.expectedCashInDrawer || 0,
        countedCash: shift.countedCash ?? s.expectedCashInDrawer ?? 0,
        difference: diff,
        status: diffStatus
      },
      cardSummary: {
        expected: s.cardSales || 0,
        counted: shift.countedCards ?? s.cardSales ?? 0,
        difference: (shift.countedCards ?? s.cardSales ?? 0) - (s.cardSales || 0),
        dataphonesBreakdown: shift.dataphonesBreakdown || []
      },
      sinpeSummary: {
        expected: s.sinpeSales || 0,
        counted: shift.countedSinpe ?? s.sinpeSales ?? 0,
        difference: (shift.countedSinpe ?? s.sinpeSales ?? 0) - (s.sinpeSales || 0)
      },
      movements: shift.movements || []
    };
  }

  generateConsolidatedZReport(tenant?: TenantInfo, dateFilter?: string): ConsolidatedZReportData {
    const todayStr = dateFilter || new Date().toISOString().split('T')[0];

    // Find all shifts closed on this date (or currently active)
    const matchingShifts = [
      ...Object.values(this.activeShiftsMap),
      ...this.shiftsHistory
    ].filter(s => {
      const openedDate = s.openedAt.split('T')[0];
      const closedDate = s.closedAt ? s.closedAt.split('T')[0] : openedDate;
      return openedDate === todayStr || closedDate === todayStr;
    });

    const registersSummary = this.registers.map(reg => {
      const regShifts = matchingShifts.filter(s => s.cashRegisterId === reg.id || (!s.cashRegisterId && reg.isDefault));
      
      let initialFloatTotal = 0;
      let cashSales = 0;
      let cardSales = 0;
      let sinpeSales = 0;
      let totalSales = 0;
      let inflowsTotal = 0;
      let outflowsTotal = 0;
      let taxTotal = 0;
      let service10Total = 0;
      let expectedCash = 0;
      let countedCash = 0;
      let difference = 0;

      regShifts.forEach(s => {
        initialFloatTotal += s.initialCashFloat;
        cashSales += s.systemSummary.cashSales;
        cardSales += s.systemSummary.cardSales;
        sinpeSales += s.systemSummary.sinpeSales;
        totalSales += s.systemSummary.totalSales;
        inflowsTotal += s.systemSummary.totalInflows;
        outflowsTotal += s.systemSummary.totalOutflows;
        taxTotal += s.systemSummary.totalTax;
        service10Total += s.systemSummary.serviceTax10;
        expectedCash += s.systemSummary.expectedCashInDrawer;
        countedCash += s.countedCash ?? s.systemSummary.expectedCashInDrawer;
        difference += (s.cashDifference ?? 0);
      });

      return {
        registerId: reg.id,
        registerName: reg.name,
        terminalCode: reg.terminalCode,
        shiftsCount: regShifts.length,
        initialFloatTotal,
        cashSales,
        cardSales,
        sinpeSales,
        totalSales,
        inflowsTotal,
        outflowsTotal,
        taxTotal,
        service10Total,
        expectedCash,
        countedCash,
        difference
      };
    });

    const totals = registersSummary.reduce((acc, curr) => {
      acc.grossTotal += curr.totalSales;
      acc.subtotal += Math.round(curr.totalSales / 1.23);
      acc.taxTotal += curr.taxTotal;
      acc.service10Total += curr.service10Total;
      acc.cashTotal += curr.cashSales;
      acc.cardTotal += curr.cardSales;
      acc.sinpeTotal += curr.sinpeSales;
      acc.initialFloatTotal += curr.initialFloatTotal;
      acc.inflowsTotal += curr.inflowsTotal;
      acc.outflowsTotal += curr.outflowsTotal;
      acc.expectedCashTotal += curr.expectedCash;
      acc.countedCashTotal += curr.countedCash;
      acc.differenceTotal += curr.difference;
      return acc;
    }, {
      grossTotal: 0,
      subtotal: 0,
      taxTotal: 0,
      service10Total: 0,
      cashTotal: 0,
      cardTotal: 0,
      sinpeTotal: 0,
      initialFloatTotal: 0,
      inflowsTotal: 0,
      outflowsTotal: 0,
      expectedCashTotal: 0,
      countedCashTotal: 0,
      differenceTotal: 0,
      invoicesCount: matchingShifts.reduce((sum, s) => sum + s.systemSummary.invoicesCount, 0)
    });

    return {
      reportDate: todayStr,
      tenantName: tenant?.name || 'Restaurante Fuego & Palmera S.A.',
      cedulaJuridica: tenant?.cedulaJuridica || '3-101-884920',
      location: tenant?.location || 'San José, Escazú',
      branchCode: '001',
      generatedAt: new Date().toISOString(),
      generatedBy: 'Administración SaborAI',
      registersSummary,
      totals
    };
  }

  private createMockHistoricalShift(): CashShift {
    const yesterday = new Date(Date.now() - 86400000);
    return {
      id: 'shift_mock_yesterday',
      shiftNumber: 1,
      tenantId: 'tenant_mock_01',
      terminalId: '00001',
      cashRegisterId: 'caja-01',
      cashRegisterName: 'Caja 1 - Barra Principal',
      terminalCode: '00001',
      openedBy: {
        userId: 'usr_cajero_01',
        userName: 'Laura Mora (Cajera)',
        userRole: 'CAJERO'
      },
      openedAt: new Date(yesterday.setHours(11, 0, 0)).toISOString(),
      closedBy: {
        userId: 'usr_admin_01',
        userName: 'Carlos Administrador'
      },
      closedAt: new Date(yesterday.setHours(23, 15, 0)).toISOString(),
      initialCashFloat: 50000,
      status: 'CLOSED',
      movements: [
        {
          id: 'mov_mock_1',
          shiftId: 'shift_mock_yesterday',
          timestamp: new Date(yesterday.setHours(16, 30, 0)).toISOString(),
          type: 'OUTFLOW',
          amount: 15000,
          reason: 'Pago de emergencia de cilindro de gas cocina',
          authorizedBy: 'Carlos Administrador',
          performedBy: 'Laura Mora (Cajera)'
        }
      ],
      systemSummary: {
        cashSales: 185000,
        cardSales: 340000,
        sinpeSales: 89000,
        totalSales: 614000,
        subtotal: 499187,
        totalTax: 64894,
        serviceTax10: 49919,
        totalInflows: 0,
        totalOutflows: 15000,
        expectedCashInDrawer: 220000,
        invoicesCount: 28
      },
      countedCash: 220000,
      countedCards: 340000,
      countedSinpe: 89000,
      cashDifference: 0,
      zReportGenerated: true
    };
  }
}

export const cashShiftService = new CashShiftService();
