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
  DataphoneClosingEntry,
  CashShiftParticipant
} from '../types/cashShift';
import { UserProfile, TenantInfo } from '../types';
import { clearLegacyCashControlData, getTenantItem, removeTenantItem, setTenantItem } from './tenantStorage';
import { auditService } from './auditService';
import { cashControlCloudService } from './cashControlCloudService';

const TENANT_KEY_ACTIVE_SHIFTS_MAP = 'shifts_map';
const TENANT_KEY_CURRENT_TERMINAL_ID = 'current_terminal_id';
const TENANT_KEY_CASH_REGISTERS = 'cash_registers';
const TENANT_KEY_SHIFTS_HISTORY = 'shifts_history';

export const DEFAULT_REGISTERS: CashRegister[] = [
  {
    id: 'caja-01',
    name: 'Caja 01 - Principal',
    terminalCode: '00001',
    branchCode: '001',
    isDefault: true,
    allowsBilling: true,
    allowsOrdering: true,
    isActive: true,
    notes: 'Terminal de facturación principal'
  }
];

class CashShiftService {
  private registers: CashRegister[] = [];
  private currentTerminalId: string = '';
  private activeShiftsMap: Record<string, CashShift> = {}; // key: registerId (e.g. 'caja-01')
  private shiftsHistory: CashShift[] = [];
  private tenantId: string | null = null;
  private cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudSyncInFlight = false;
  private cloudHydrating = false;
  private cloudRealtimeUnsubscribe: (() => void) | null = null;

  constructor() {
    this.resetInMemoryState();
  }

  setTenantContext(tenantId: string): void {
    if (!tenantId || this.tenantId === tenantId) return;
    this.tenantId = tenantId;
    if (this.cloudSyncTimer) {
      clearTimeout(this.cloudSyncTimer);
      this.cloudSyncTimer = null;
    }
    if (cashControlCloudService.isAvailable()) {
      // Supabase es la fuente de verdad. No reutilizar catálogos/turnos antiguos
      // que puedan volver a insertarse después de un Ctrl+Shift+R.
      this.resetInMemoryState();
      clearLegacyCashControlData();
      removeTenantItem(TENANT_KEY_CASH_REGISTERS, tenantId);
      removeTenantItem(TENANT_KEY_CURRENT_TERMINAL_ID, tenantId);
      removeTenantItem(TENANT_KEY_ACTIVE_SHIFTS_MAP, tenantId);
      removeTenantItem(TENANT_KEY_SHIFTS_HISTORY, tenantId);
    } else {
      this.loadFromStorage();
    }
    this.cloudRealtimeUnsubscribe?.();
    this.cloudRealtimeUnsubscribe = cashControlCloudService.subscribe(tenantId, () => {
      void this.refreshFromCloud();
    });
    void this.reconcileWithCloud(tenantId);
  }

  private resetInMemoryState(): void {
    this.registers = [...DEFAULT_REGISTERS];
    this.currentTerminalId = this.registers[0].id;
    this.activeShiftsMap = {};
    this.shiftsHistory = [];
  }

  private loadFromStorage(): void {
    this.resetInMemoryState();
    if (!this.tenantId) return;

    try {
      // 1. Load registers
      const parsedRegisters = getTenantItem<CashRegister[]>(TENANT_KEY_CASH_REGISTERS, this.tenantId);
      this.registers = Array.isArray(parsedRegisters) && parsedRegisters.length > 0
        ? parsedRegisters
        : [...DEFAULT_REGISTERS];

      // 2. Load current terminal ID for this device
      const savedTerminalId = getTenantItem<string>(TENANT_KEY_CURRENT_TERMINAL_ID, this.tenantId);
      if (savedTerminalId && this.registers.some(r => r.id === savedTerminalId)) {
        this.currentTerminalId = savedTerminalId;
      } else {
        const defaultReg = this.registers.find(r => r.isDefault) || this.registers[0] || DEFAULT_REGISTERS[0];
        this.currentTerminalId = defaultReg.id;
      }

      // 3. Load active shifts map
      this.activeShiftsMap = getTenantItem<Record<string, CashShift>>(TENANT_KEY_ACTIVE_SHIFTS_MAP, this.tenantId) || {};

      // 4. Load shifts history
      this.shiftsHistory = getTenantItem<CashShift[]>(TENANT_KEY_SHIFTS_HISTORY, this.tenantId) || [];
      // La carga inicial no debe volver a subir una caché local antigua a Supabase.
      this.saveToStorage(false);
    } catch (e) {
      console.warn('Error loading shifts from storage:', e);
    }
  }

  private saveToStorage(syncCloud = true): void {
    if (!this.tenantId) return;
    try {
      setTenantItem(TENANT_KEY_CASH_REGISTERS, this.registers, this.tenantId);
      setTenantItem(TENANT_KEY_CURRENT_TERMINAL_ID, this.currentTerminalId, this.tenantId);
      setTenantItem(TENANT_KEY_ACTIVE_SHIFTS_MAP, this.activeShiftsMap, this.tenantId);
      setTenantItem(TENANT_KEY_SHIFTS_HISTORY, this.shiftsHistory, this.tenantId);
      if (syncCloud) this.queueCloudSync();
    } catch (e) {
      console.warn('Error saving shifts to storage:', e);
    }
  }

  // --- Cash Registers Management ---

  getCashRegisters(): CashRegister[] {
    if (this.registers.length === 0) {
      this.registers = [...DEFAULT_REGISTERS];
      this.saveToStorage();
    }
    return this.registers;
  }

  getCurrentRegisterId(): string {
    return this.currentTerminalId || (this.registers[0]?.id || 'caja-01');
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
    if (this.registers.length > 0) return this.registers[0];
    return DEFAULT_REGISTERS[0];
  }

  createCashRegister(data: {
    name: string;
    terminalCode: string;
    branchCode?: string;
    allowsBilling?: boolean;
    allowsOrdering?: boolean;
    assignedPrinterId?: string;
    notes?: string;
    linkedZone?: string;
    linkedZones?: string[];
  }): CashRegister {
    // Format terminal code to 5 digits
    const paddedTerminal = data.terminalCode.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5) || '00001';
    const paddedBranch = (data.branchCode || '001').replace(/[^0-9]/g, '').padStart(3, '0').slice(-3);

    const zones = data.linkedZones && data.linkedZones.length > 0 
      ? data.linkedZones.filter(Boolean)
      : (data.linkedZone ? [data.linkedZone] : undefined);

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
      notes: data.notes?.trim() || '',
      linkedZone: zones && zones.length === 1 ? zones[0] : undefined,
      linkedZones: zones && zones.length > 0 ? zones : undefined
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
    if (this.activeShiftsMap[id]) {
      throw new Error('No se puede eliminar una caja con un turno abierto. Primero debe cerrarse el turno.');
    }

    this.registers = this.registers.filter(r => r.id !== id);
    if (this.currentTerminalId === id) {
      this.currentTerminalId = this.registers[0]?.id || '';
    }
    this.saveToStorage();
    return true;
  }

  // --- Active Shifts Management (Per Register) ---

  syncShiftsMap(incomingMap: Record<string, CashShift>): void {
    this.activeShiftsMap = incomingMap;
    this.saveToStorage();
  }

  getAllActiveShiftsMap(): Record<string, CashShift> {
    return this.activeShiftsMap;
  }

  getActiveShift(registerId?: string): CashShift | null {
    const targetId = registerId || this.currentTerminalId;
    return this.activeShiftsMap[targetId] || null;
  }

  /** Añade al usuario al turno abierto; cambiar de usuario no cambia el turno. */
  registerUserOnActiveShift(user: UserProfile, registerId?: string): CashShift | null {
    const shift = this.getActiveShift(registerId);
    if (!shift || shift.status !== 'OPEN' || !user?.id) return shift;

    const participants: CashShiftParticipant[] = Array.isArray(shift.participants)
      ? [...shift.participants]
      : [{
          userId: shift.openedBy.userId,
          userName: shift.openedBy.userName,
          userRole: shift.openedBy.userRole,
          joinedAt: shift.openedAt
        }];

    if (!participants.some(participant => participant.userId === user.id)) {
      participants.push({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        joinedAt: new Date().toISOString()
      });
      shift.participants = participants;
      this.saveToStorage();
    } else if (!shift.participants) {
      shift.participants = participants;
      this.saveToStorage();
    }

    return shift;
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
    registerId?: string,
    linkedZone?: string,
    linkedZones?: string[]
  ): CashShift {
    const targetRegisterId = registerId || this.currentTerminalId || 'caja-01';
    const register = this.registers.find(r => r.id === targetRegisterId);

    if (!register) {
      throw new Error(`La caja con ID "${targetRegisterId}" no existe.`);
    }
    if (!register.isActive) {
      throw new Error(`La caja "${register.name}" está inactiva y no puede abrir un turno.`);
    }
    if (!openedByUser?.id || !openedByUser.name?.trim() || openedByUser.active === false) {
      throw new Error('Selecciona un colaborador activo para asignarlo como responsable del turno.');
    }
    if (!Number.isFinite(initialFloat) || !Number.isInteger(initialFloat) || initialFloat < 0) {
      throw new Error('El fondo inicial debe ser un monto entero igual o mayor que ₡0.');
    }

    if (this.activeShiftsMap[targetRegisterId] && this.activeShiftsMap[targetRegisterId].status === 'OPEN') {
      throw new Error(`La ${register?.name || 'caja'} ya tiene un turno de caja activo. Debe cerrarse antes de abrir uno nuevo.`);
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

    // Determinar salones a enlazar
    let zonesToUse: string[] | undefined = undefined;
    if (linkedZones !== undefined) {
      zonesToUse = linkedZones.map(zone => zone.trim()).filter(Boolean);
    } else if (linkedZone !== undefined) {
      zonesToUse = linkedZone.trim() ? [linkedZone.trim()] : undefined;
    } else if (register?.linkedZones && register.linkedZones.length > 0) {
      zonesToUse = register.linkedZones;
    } else if (register?.linkedZone) {
      zonesToUse = [register.linkedZone];
    }

    // Sincronizar en la configuración de la caja si se envió explícitamente
    if (zonesToUse !== undefined && register) {
      register.linkedZones = zonesToUse;
      register.linkedZone = zonesToUse.length === 1 ? zonesToUse[0] : undefined;
    }

    const primaryZone = zonesToUse && zonesToUse.length > 0 ? zonesToUse[0] : undefined;

    const newShift: CashShift = {
      id: `shift_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      shiftNumber: nextShiftNumber,
      tenantId: tenant?.id || 'tenant_default',
      terminalId: register?.terminalCode || '00001',
      cashRegisterId: register?.id || 'caja-01',
      cashRegisterName: register?.name || 'Caja 01 - Principal',
      terminalCode: register?.terminalCode || '00001',
      linkedZone: primaryZone,
      linkedZones: zonesToUse,
      openedBy: {
        userId: openedByUser?.id || 'usr_matamoros_admin',
        userName: openedByUser?.name || 'Maikol Matamoros',
        userRole: openedByUser?.role || 'ADMIN'
      },
      participants: [{
        userId: openedByUser?.id || 'usr_matamoros_admin',
        userName: openedByUser?.name || 'Maikol Matamoros',
        userRole: openedByUser?.role || 'ADMIN',
        joinedAt: new Date().toISOString()
      }],
      openedAt: new Date().toISOString(),
      initialCashFloat: initialFloat,
      status: 'OPEN',
      notes: notes || '',
      movements: [],
      systemSummary: initialSummary
    };

    this.activeShiftsMap[targetRegisterId] = newShift;
    this.saveToStorage();
    auditService.record({
      tenantId: newShift.tenantId,
      action: 'SHIFT_OPENED',
      actor: openedByUser,
      registerId: register.id,
      shiftId: newShift.id,
      amount: initialFloat,
      reference: `Turno #${newShift.shiftNumber}`,
      reason: notes,
      metadata: {
        cashRegisterName: register.name,
        terminalCode: register.terminalCode,
        linkedZones: zonesToUse || []
      }
    });
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
    tenantId?: string;
    actor?: UserProfile | { id?: string; name?: string; role?: string };
    reference?: string;
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
    if (params.tenantId) {
      auditService.record({
        tenantId: params.tenantId,
        action: 'SALE_RECORDED',
        actor: params.actor,
        registerId: targetRegisterId,
        shiftId: shift.id,
        amount: cash + card + sinpe,
        reference: params.reference,
        metadata: { cashAmount: cash, cardAmount: card, sinpeAmount: sinpe }
      });
    }
  }

  private queueCloudSync(): void {
    if (this.cloudHydrating || !this.tenantId || !cashControlCloudService.isAvailable()) return;
    if (this.cloudSyncTimer) clearTimeout(this.cloudSyncTimer);
    this.cloudSyncTimer = setTimeout(() => {
      void this.syncToCloud();
    }, 800);
  }

  private async syncToCloud(): Promise<void> {
    if (this.cloudSyncInFlight || !this.tenantId || !cashControlCloudService.isAvailable()) return;
    this.cloudSyncInFlight = true;
    try {
      const result = await cashControlCloudService.importLocalConfiguration(this.tenantId, {
        deviceName: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'Dispositivo POS'
      });
      // Si PostgreSQL rechazó una operación por concurrencia (por ejemplo, dos
      // dispositivos abriendo la misma caja), el estado confirmado prevalece.
      if (result.conflicts.length > 0) await this.refreshFromCloud();
    } catch (error) {
      console.warn('[CashControl] No se pudo sincronizar con Supabase; se conserva la caché local:', error);
    } finally {
      this.cloudSyncInFlight = false;
    }
  }

  private async reconcileWithCloud(tenantId: string): Promise<void> {
    if (!cashControlCloudService.isAvailable()) return;
    try {
      // Al iniciar o cambiar de tenant, Supabase es la fuente de verdad.
      // La importación local solo debe ejecutarse por una acción explícita de migración;
      // hacerlo aquí puede recrear turnos abiertos de una caché antigua.
      await this.refreshFromCloud();
    } catch (error) {
      console.warn('[CashControl] Supabase no disponible; el POS continúa offline:', error);
    }
  }

  private async refreshFromCloud(): Promise<void> {
    if (!this.tenantId || !cashControlCloudService.isAvailable()) return;
    try {
      const snapshot = await cashControlCloudService.getCloudSnapshot(this.tenantId);
      const state = cashControlCloudService.toLocalState(snapshot);
      if (state.registers.length === 0) return;
      this.cloudHydrating = true;
      this.registers = state.registers;
      this.activeShiftsMap = state.activeShiftsMap;
      this.shiftsHistory = state.shiftsHistory;
      if (state.currentTerminalId && this.registers.some(register => register.id === state.currentTerminalId)) {
        this.currentTerminalId = state.currentTerminalId;
      } else if (!this.registers.some(register => register.id === this.currentTerminalId)) {
        this.currentTerminalId = (this.registers.find(register => register.isDefault) || this.registers[0]).id;
      }
      this.saveToStorage(false);
    } catch (error) {
      console.warn('[CashControl] No se pudo refrescar el estado cloud:', error);
    } finally {
      this.cloudHydrating = false;
    }
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
      tenantName: tenant?.name || 'Mi Restaurante',
      cedulaJuridica: tenant?.cedulaJuridica || '',
      location: tenant?.location || '',
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
      tenantName: tenant?.name || 'Mi Restaurante',
      cedulaJuridica: tenant?.cedulaJuridica || '',
      location: tenant?.location || '',
      branchCode: '001',
      generatedAt: new Date().toISOString(),
      generatedBy: 'Administración SaborAI',
      registersSummary,
      totals
    };
  }
}

export const cashShiftService = new CashShiftService();
