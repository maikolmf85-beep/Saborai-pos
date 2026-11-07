import type { CashRegister, CashShift, DailyCashOpeningResult, DailyCashStatus } from '../types/cashShift';
import { getTenantItem } from './tenantStorage';
import { isSupabaseConfigured, supabaseClient } from '../lib/supabaseClient';
import { archiveCashRegisterInCloud, getVisibleCashRegisters } from './cashRegisterDeletion';
import { attemptCashTerminalAssignment, confirmOpenDailyCashFromRemote, isConfirmedOpenShiftForRegister, isUnrelatedRegisterCodeMatch, updateClosedShiftIfNeeded } from './cashControlSync';
import type { CashShiftCloseTarget, DailyCashCloseTarget } from './cashControlSync';
import { posCloudService } from './posCloudService';

const DEVICE_KEY_STORAGE = 'saborai_cash_control_device_key';
const MIGRATION_MARKER_PREFIX = 'saborai_cash_control_migration:';
const DAILY_CASH_STATUS_CACHE_PREFIX = 'saborai_daily_cash_status:';

type CloudBranch = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
};

type CloudRegister = {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  terminal_code: string;
  allows_billing: boolean;
  allows_ordering: boolean;
  is_active: boolean;
  is_default: boolean;
  linked_zones: string[];
  assigned_printer_id?: string | null;
  notes?: string | null;
  legacy_id?: string | null;
};

type CloudShift = {
  id: string;
  tenant_id: string;
  branch_id: string;
  cash_register_id: string;
  status: 'OPEN' | 'CLOSED' | 'VOIDED';
  shift_number: number | null;
  legacy_id?: string | null;
  opened_by?: string | null;
  closed_by?: string | null;
  opening_float?: number | null;
  expected_cash?: number | null;
  counted_cash?: number | null;
  difference?: number | null;
  opened_at?: string | null;
  closed_at?: string | null;
  notes?: string | null;
  participants?: CashShift['participants'] | null;
  movements?: CashShift['movements'] | null;
  system_summary?: CashShift['systemSummary'] | null;
  cash_breakdown?: CashShift['cashBreakdown'] | null;
  counted_cards?: number | null;
  dataphones_breakdown?: CashShift['dataphonesBreakdown'] | null;
  counted_sinpe?: number | null;
  difference_reason?: string | null;
  z_report_generated?: boolean | null;
};

export interface CashControlCloudSnapshot {
  branches: CloudBranch[];
  registers: CloudRegister[];
  shifts: CloudShift[];
  currentDeviceTerminal: { id: string; cash_register_id: string; device_name?: string | null } | null;
  fetchedAt: string;
}

export interface CashControlMigrationPreview {
  tenantId: string;
  deviceKey: string;
  localRegisters: CashRegister[];
  localActiveShifts: CashShift[];
  localShiftHistory: CashShift[];
  cloudRegisters: CloudRegister[];
  cloudOpenShifts: CloudShift[];
  conflicts: string[];
}

export interface CashTerminalAssignmentConflict {
  terminalId: string;
  registerId: string;
  localRegisterId: string;
  registerName: string;
  deviceName: string | null;
}

export interface CashControlMigrationResult {
  importedRegisters: number;
  importedShifts: number;
  assignedTerminal: boolean;
  skippedExisting: number;
  conflicts: string[];
  migrationMarker: string;
  terminalAssignmentConflict?: CashTerminalAssignmentConflict;
}

export interface LocalCashControlState {
  registers: CashRegister[];
  activeShiftsMap: Record<string, CashShift>;
  shiftsHistory: CashShift[];
  currentTerminalId?: string;
}

function getOrCreateDeviceKey(): string {
  if (typeof window === 'undefined') return 'server-device';
  const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (existing && existing.length >= 16) return existing;

  const generated = `dev_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 18)}`}`;
  localStorage.setItem(DEVICE_KEY_STORAGE, generated);
  return generated;
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueShifts(activeMap: Record<string, CashShift> | null, history: CashShift[]): CashShift[] {
  const byId = new Map<string, CashShift>();
  Object.values(activeMap || {}).forEach(shift => {
    if (shift?.id) byId.set(shift.id, shift);
  });
  history.forEach(shift => {
    if (shift?.id) byId.set(shift.id, shift);
  });
  return [...byId.values()];
}

class CashControlCloudService {
  getDeviceKey(): string {
    return getOrCreateDeviceKey();
  }

  isAvailable(): boolean {
    return Boolean(isSupabaseConfigured && supabaseClient);
  }

  async closeShiftInCloud(tenantId: string, shiftId: string, closure: Record<string, unknown>): Promise<Record<string, any>> {
    if (!this.isAvailable()) throw new Error('El cierre de turno requiere conexión con la nube.');
    return posCloudService.syncOperation<Record<string, any>>(
      'CLOSE_CASH_SHIFT',
      { shiftId, closure },
      tenantId,
      `cash-close:${tenantId}:${shiftId}`
    );
  }

  async confirmsOpenShiftForRegister(tenantId: string, target: CashShiftCloseTarget, remoteRegisterId: string): Promise<boolean> {
    const snapshot = await this.getCloudSnapshot(tenantId);
    return isConfirmedOpenShiftForRegister(snapshot, tenantId, target, remoteRegisterId);
  }

  async confirmsOpenDailyCashForRegister(tenantId: string, target: DailyCashCloseTarget): Promise<boolean> {
    return confirmOpenDailyCashFromRemote(
      tenantId,
      target,
      (requestTenantId, registerId) => this.getDailyCashStatus(requestTenantId, registerId)
    );
  }

  async getDailyCashStatus(tenantId: string, registerId: string): Promise<DailyCashStatus> {
    const status = await posCloudService.syncOperation<DailyCashStatus>(
      'GET_DAILY_CASH_STATUS',
      { registerId },
      tenantId
    );
    this.cacheDailyCashStatus(tenantId, registerId, status);
    return status;
  }

  cacheDailyCashStatus(tenantId: string, registerId: string, status: DailyCashStatus): void {
    if (typeof window === 'undefined' || !tenantId || !registerId) return;
    try {
      localStorage.setItem(`${DAILY_CASH_STATUS_CACHE_PREFIX}${tenantId}:${registerId}`, JSON.stringify(status));
    } catch {}
  }

  getCachedDailyCashStatus(tenantId: string, registerId: string): DailyCashStatus | null {
    if (typeof window === 'undefined' || !tenantId || !registerId) return null;
    try {
      const raw = localStorage.getItem(`${DAILY_CASH_STATUS_CACHE_PREFIX}${tenantId}:${registerId}`);
      if (!raw) return null;
      const status = JSON.parse(raw) as DailyCashStatus;
      return typeof status.businessDate === 'string'
        && typeof status.timezone === 'string'
        && typeof status.isOpen === 'boolean'
        && typeof status.isClosed === 'boolean'
        ? status
        : null;
    } catch {
      return null;
    }
  }

  isDailyCashStatusForCurrentDate(status: DailyCashStatus): boolean {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: status.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}` === status.businessDate;
    } catch {
      return false;
    }
  }

  async openDailyCashInCloud(tenantId: string, registerId: string): Promise<DailyCashOpeningResult> {
    return posCloudService.syncOperation<DailyCashOpeningResult>(
      'OPEN_DAILY_CASH',
      { registerId },
      tenantId
    );
  }

  getMigrationMarker(tenantId: string): string | null {
    if (typeof window === 'undefined' || !tenantId) return null;
    return localStorage.getItem(`${MIGRATION_MARKER_PREFIX}${tenantId}`);
  }

  private setMigrationMarker(tenantId: string, marker: string): void {
    if (typeof window !== 'undefined' && tenantId) {
      localStorage.setItem(`${MIGRATION_MARKER_PREFIX}${tenantId}`, marker);
    }
  }

  async deactivateCashRegister(tenantId: string, localRegisterId: string): Promise<void> {
    if (!supabaseClient) throw new Error('Supabase no está configurado en este dispositivo.');
    const client = supabaseClient;
    await archiveCashRegisterInCloud(tenantId, localRegisterId, {
      findByLegacyId: async (targetTenantId, legacyId) => {
        const { data, error } = await client
          .from('pos_cash_registers')
          .select('id')
          .eq('tenant_id', targetTenantId)
          .eq('legacy_id', legacyId)
          .maybeSingle();
        if (error) throw new Error(`No se pudo localizar la caja en Supabase: ${error.message}`);
        return data ? { id: data.id } : null;
      },
      findById: async (targetTenantId, id) => {
        const { data, error } = await client
          .from('pos_cash_registers')
          .select('id')
          .eq('tenant_id', targetTenantId)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`No se pudo localizar la caja en Supabase: ${error.message}`);
        return data ? { id: data.id } : null;
      },
      deactivate: async (targetTenantId, cloudId) => {
        const { data, error } = await client
          .from('pos_cash_registers')
          .update({ is_active: false })
          .eq('tenant_id', targetTenantId)
          .eq('id', cloudId)
          .select('id')
          .maybeSingle();
        if (error) throw new Error(`No se pudo archivar la caja en Supabase: ${error.message}`);
        if (!data) throw new Error('No se pudo confirmar el archivo de la caja en Supabase.');
      }
    });
  }

  async getCloudSnapshot(tenantId: string): Promise<CashControlCloudSnapshot> {
    if (!tenantId) throw new Error('Tenant ID es requerido para cargar cajas y turnos.');
    if (!supabaseClient) throw new Error('Supabase no está configurado en este dispositivo.');

    const [branchesResult, registersResult, shiftsResult, terminalResult] = await Promise.all([
      supabaseClient.from('pos_branches').select('id, tenant_id, code, name').eq('tenant_id', tenantId),
      supabaseClient
        .from('pos_cash_registers')
        .select('id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id')
        .eq('tenant_id', tenantId)
        .order('terminal_code'),
      supabaseClient
        .from('pos_cash_shifts')
        .select('id, tenant_id, branch_id, cash_register_id, status, shift_number, legacy_id, opened_by, closed_by, opening_float, expected_cash, counted_cash, difference, opened_at, closed_at, notes, participants, movements, system_summary, cash_breakdown, counted_cards, dataphones_breakdown, counted_sinpe, difference_reason, z_report_generated')
        .eq('tenant_id', tenantId)
        .order('opened_at', { ascending: false }),
      supabaseClient
        .from('pos_terminals')
        .select('id, cash_register_id, device_name')
        .eq('tenant_id', tenantId)
        .eq('device_key', getOrCreateDeviceKey())
        .eq('is_active', true)
        .maybeSingle()
    ]);

    const firstError = [branchesResult.error, registersResult.error, shiftsResult.error, terminalResult.error].find(Boolean);
    if (firstError) throw new Error(`No se pudo cargar la configuración central: ${firstError.message}`);

    return {
      branches: asArray(branchesResult.data as CloudBranch[]),
      registers: asArray(registersResult.data as CloudRegister[]),
      shifts: asArray(shiftsResult.data as CloudShift[]),
      currentDeviceTerminal: (terminalResult.data as CashControlCloudSnapshot['currentDeviceTerminal']) || null,
      fetchedAt: new Date().toISOString()
    };
  }

  toLocalState(snapshot: CashControlCloudSnapshot): LocalCashControlState {
    const branchCodes = new Map(snapshot.branches.map(branch => [branch.id, branch.code]));
    const registers = getVisibleCashRegisters(snapshot.registers).map(register => ({
      id: register.legacy_id || register.id,
      name: register.name,
      terminalCode: register.terminal_code,
      branchCode: branchCodes.get(register.branch_id) || '001',
      isDefault: register.is_default,
      allowsBilling: register.allows_billing,
      allowsOrdering: register.allows_ordering,
      assignedPrinterId: register.assigned_printer_id || undefined,
      isActive: register.is_active,
      notes: register.notes || '',
      linkedZones: Array.isArray(register.linked_zones) ? register.linked_zones : [],
      linkedZone: Array.isArray(register.linked_zones) && register.linked_zones.length === 1
        ? register.linked_zones[0]
        : undefined
    }));
    const registerByCloudId = new Map(snapshot.registers.map(register => [register.id, register]));
    const activeShiftsMap: Record<string, CashShift> = {};
    const shiftsHistory: CashShift[] = [];

    snapshot.shifts.forEach(remote => {
      const remoteRegister = registerByCloudId.get(remote.cash_register_id);
      const localRegisterId = remoteRegister?.legacy_id || remote.cash_register_id;
      const participants = Array.isArray(remote.participants) ? remote.participants : [];
      const firstParticipant = participants[0];
      const localShift: CashShift = {
        id: remote.legacy_id || remote.id,
        shiftNumber: remote.shift_number || 0,
        tenantId: remote.tenant_id,
        terminalId: remoteRegister?.terminal_code || '00001',
        cashRegisterId: localRegisterId,
        cashRegisterName: remoteRegister?.name || 'Caja',
        terminalCode: remoteRegister?.terminal_code || '00001',
        openedBy: {
          userId: remote.opened_by || firstParticipant?.userId || 'cloud-user',
          userName: firstParticipant?.userName || 'Usuario POS',
          userRole: firstParticipant?.userRole || 'CAJERO'
        },
        participants,
        openedAt: remote.opened_at || new Date().toISOString(),
        initialCashFloat: Number(remote.opening_float || 0),
        status: remote.status === 'OPEN' ? 'OPEN' : 'CLOSED',
        notes: remote.notes || '',
        movements: Array.isArray(remote.movements) ? remote.movements : [],
        systemSummary: remote.system_summary || {
          cashSales: 0, cardSales: 0, sinpeSales: 0, totalSales: 0, subtotal: 0,
          totalTax: 0, serviceTax10: 0, totalInflows: 0, totalOutflows: 0,
          expectedCashInDrawer: Number(remote.expected_cash || 0), invoicesCount: 0
        },
        closedBy: remote.closed_by ? { userId: remote.closed_by, userName: 'Usuario POS' } : undefined,
        closedAt: remote.closed_at || undefined,
        countedCash: remote.counted_cash ?? undefined,
        cashBreakdown: remote.cash_breakdown || undefined,
        countedCards: remote.counted_cards ?? undefined,
        dataphonesBreakdown: remote.dataphones_breakdown || undefined,
        countedSinpe: remote.counted_sinpe ?? undefined,
        cashDifference: remote.difference ?? undefined,
        differenceReason: remote.difference_reason || undefined,
        zReportGenerated: Boolean(remote.z_report_generated)
      };
      if (remote.status === 'OPEN') activeShiftsMap[localRegisterId] = localShift;
      else shiftsHistory.push(localShift);
    });

    const currentTerminalRegister = snapshot.currentDeviceTerminal
      ? registerByCloudId.get(snapshot.currentDeviceTerminal.cash_register_id)
      : undefined;
    const currentTerminalId = currentTerminalRegister?.is_active
      ? currentTerminalRegister.legacy_id || currentTerminalRegister.id
      : undefined;
    return { registers, activeShiftsMap, shiftsHistory, currentTerminalId };
  }

  async previewLocalMigration(tenantId: string): Promise<CashControlMigrationPreview> {
    const localRegisters = getTenantItem<CashRegister[]>('cash_registers', tenantId) || [];
    const activeMap = getTenantItem<Record<string, CashShift>>('shifts_map', tenantId) || {};
    const localActiveShifts = Object.values(activeMap).filter(Boolean);
    const localShiftHistory = getTenantItem<CashShift[]>('shifts_history', tenantId) || [];
    const cloud = await this.getCloudSnapshot(tenantId);
    const conflicts: string[] = [];

    localRegisters.forEach(local => {
      const sameLegacy = cloud.registers.find(remote => remote.legacy_id === local.id);
      const sameCode = cloud.registers.find(remote => remote.terminal_code === local.terminalCode);
      if (sameLegacy) conflicts.push(`La caja local "${local.name}" ya fue importada.`);
      else if (sameCode) conflicts.push(`El código DGT ${local.terminalCode} ya pertenece a "${sameCode.name}".`);
    });

    const openCloudRegisterIds = new Set(
      cloud.shifts.filter(shift => shift.status === 'OPEN').map(shift => shift.cash_register_id)
    );
    [...localActiveShifts, ...localShiftHistory].filter(shift => shift.status === 'OPEN').forEach(shift => {
      const remote = cloud.registers.find(register => register.legacy_id === shift.cashRegisterId);
      if (remote && openCloudRegisterIds.has(remote.id)) {
        conflicts.push(`El turno local de "${remote.name}" ya tiene un turno abierto en la nube.`);
      }
    });

    return {
      tenantId,
      deviceKey: getOrCreateDeviceKey(),
      localRegisters,
      localActiveShifts,
      localShiftHistory,
      cloudRegisters: cloud.registers,
      cloudOpenShifts: cloud.shifts.filter(shift => shift.status === 'OPEN'),
      conflicts
    };
  }

  async importLocalConfiguration(tenantId: string, options: { deviceName?: string; overwriteExisting?: boolean } = {}): Promise<CashControlMigrationResult> {
    const client = supabaseClient;
    if (!client) throw new Error('Supabase no está configurado en este dispositivo.');
    const preview = await this.previewLocalMigration(tenantId);
    const deviceKey = preview.deviceKey;
    const cloud = await this.getCloudSnapshot(tenantId);
    const importedRegisterIds = new Map<string, CloudRegister>();
    const conflicts: string[] = [];
    let terminalAssignmentConflict: CashTerminalAssignmentConflict | undefined;
    let importedRegisters = 0;
    let skippedExisting = 0;

    for (const local of preview.localRegisters) {
      const requestedBranchCode = String(local.branchCode || '001').replace(/[^0-9]/g, '').padStart(3, '0').slice(-3);
      const exactBranch = cloud.branches.find(candidate => candidate.code === requestedBranchCode);
      if (!exactBranch && cloud.branches.length > 1) {
        conflicts.push(`No se importó la caja "${local.name}": no se encontró la sucursal ${requestedBranchCode}.`);
        continue;
      }
      const branch = exactBranch || (cloud.branches.length === 1 ? cloud.branches[0] : undefined);
      const branchCode = branch?.code || requestedBranchCode;
      const legacyMatch = cloud.registers.find(remote => remote.legacy_id === local.id);
      const codeMatch = branch
        ? cloud.registers.find(remote => remote.branch_id === branch.id && remote.terminal_code === local.terminalCode)
        : undefined;
      if (isUnrelatedRegisterCodeMatch(local.id, legacyMatch?.id, codeMatch?.id)) {
        conflicts.push(`No se importó la caja "${local.name}": el código DGT ${local.terminalCode} ya pertenece a "${codeMatch?.name || 'otra caja'}" en la sucursal ${branchCode}.`);
        continue;
      }
      const existing = legacyMatch || codeMatch;
      if (existing && !options.overwriteExisting && !local.assignedPrinterId && !existing.assigned_printer_id) {
        importedRegisterIds.set(local.id, existing);
        skippedExisting += 1;
        continue;
      }

      try {
        const result = await this.ensureCloudBranchAndRegister(tenantId, local, branchCode, deviceKey, Boolean(options.overwriteExisting));
        importedRegisterIds.set(local.id, result.register);
        if (result.created) importedRegisters += 1;
        else if (!result.updated) skippedExisting += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        conflicts.push(`No se pudo importar la caja "${local.name}": ${message}`);
      }
    }

    let importedShifts = 0;
    const allLocalShifts = uniqueShifts(
      getTenantItem<Record<string, CashShift>>('shifts_map', tenantId),
      getTenantItem<CashShift[]>('shifts_history', tenantId) || []
    );
    for (const shift of allLocalShifts) {
      const register = importedRegisterIds.get(shift.cashRegisterId || '');
      if (!register) {
        conflicts.push(`Se omitió el turno ${shift.shiftNumber}: no se encontró su caja central.`);
        continue;
      }
      const status = shift.status === 'OPEN' ? 'OPEN' : shift.status === 'CLOSING' ? 'CLOSED' : shift.status;
      const existing = cloud.shifts.find(remote => remote.legacy_id === shift.id || remote.id === shift.id);
      if (existing) {
        if (status === 'CLOSED' && existing.status === 'OPEN') {
          try {
            const updated = await updateClosedShiftIfNeeded(existing.status, existing.id, shift, async (id, payload) => {
              await posCloudService.syncOperation('CLOSE_CASH_SHIFT', { shiftId: id, closure: payload }, tenantId, `cash-close:${tenantId}:${id}`);
              return { data: { id }, error: null };
            });
            if (updated) importedShifts += 1;
            else skippedExisting += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            conflicts.push(`No se pudo guardar el cierre del turno ${shift.shiftNumber}: ${message}`);
          }
        } else {
          skippedExisting += 1;
        }
        continue;
      }
      if (status === 'OPEN' && cloud.shifts.some(remote => remote.cash_register_id === register.id && remote.status === 'OPEN')) {
        conflicts.push(`Se omitió el turno abierto ${shift.shiftNumber}: la caja "${register.name}" ya tiene un turno abierto en Supabase.`);
        continue;
      }

      try {
        const result = await posCloudService.syncOperation<{ alreadyExists: boolean }>(
          'IMPORT_CASH_SHIFT',
          { shift, cashRegisterId: register.id, deviceKey },
          tenantId
        );
        if (result.alreadyExists) skippedExisting += 1;
        else importedShifts += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        conflicts.push(`No se pudo importar el turno ${shift.shiftNumber}: ${message}`);
      }
    }

    const currentLocalId = getTenantItem<string>('current_terminal_id', tenantId);
    const currentRegister = importedRegisterIds.get(currentLocalId || '') || importedRegisterIds.values().next().value;
    let assignedTerminal = false;
    if (currentRegister) {
      const deviceName = options.deviceName || (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'Dispositivo POS');
      const assignment = await attemptCashTerminalAssignment(
        () => posCloudService.syncOperation('ASSIGN_CASH_TERMINAL', {
          registerId: currentRegister.id,
          deviceKey,
          deviceName
        }, tenantId),
        async error => {
          if ((error as any)?.code !== 'CASH_TERMINAL_ALREADY_ASSIGNED') return undefined;
          const existingTerminal = await client.from('pos_terminals')
            .select('id, device_name')
            .eq('tenant_id', tenantId)
            .eq('cash_register_id', currentRegister.id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (!existingTerminal.error && existingTerminal.data?.id) {
            return {
              terminalId: existingTerminal.data.id,
              registerId: currentRegister.id,
              localRegisterId: currentRegister.legacy_id || currentRegister.id,
              registerName: currentRegister.name,
              deviceName: existingTerminal.data.device_name || null
            };
          }
          return undefined;
        }
      );
      assignedTerminal = assignment.assignedTerminal;
      conflicts.push(...assignment.conflicts);
      if (assignment.terminalAssignmentConflict) {
        terminalAssignmentConflict = assignment.terminalAssignmentConflict;
      }
    }

    const marker = new Date().toISOString();
    this.setMigrationMarker(tenantId, marker);
    return {
      importedRegisters,
      importedShifts,
      assignedTerminal,
      skippedExisting,
      conflicts,
      migrationMarker: marker,
      ...(terminalAssignmentConflict ? { terminalAssignmentConflict } : {})
    };
  }

  async reassignTerminal(tenantId: string, conflict: CashTerminalAssignmentConflict): Promise<{ terminalId: string; deactivatedTerminalId: string; registerId: string; assigned: true; alreadyAssigned: boolean }> {
    const deviceName = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'Dispositivo POS';
    return posCloudService.syncOperation('REASSIGN_CASH_TERMINAL', {
      previousTerminalId: conflict.terminalId,
      registerId: conflict.registerId,
      deviceKey: getOrCreateDeviceKey(),
      deviceName,
      confirmed: true
    }, tenantId);
  }

  private async ensureCloudBranchAndRegister(
    tenantId: string,
    local: CashRegister,
    branchCode: string,
    deviceKey: string,
    overwriteExisting: boolean
  ): Promise<{ branch: CloudBranch; register: CloudRegister; created: boolean; updated: boolean }> {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      throw new Error('La creación de la sucursal y la caja requiere una sesión activa en línea.');
    }
    const token = localStorage.getItem('saborai_token');
    if (!token) throw new Error('No se encontró una sesión válida; vuelve a iniciar sesión como administrador.');
    const localPrinters = getTenantItem<Array<{
      id: string;
      name: string;
      role: 'caja' | 'cocina' | 'bar';
      enabled: boolean;
    }>>('printers_config_v2', tenantId) || [];

    const response = await fetch('/api/tenant/onboarding', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'ensure-cash-control-setup',
        tenantId,
        branch: { code: branchCode, name: 'Sucursal Principal' },
        register: {
          name: local.name,
          terminalCode: local.terminalCode,
          legacyId: local.id,
          allowsBilling: local.allowsBilling,
          allowsOrdering: local.allowsOrdering,
          isActive: local.isActive !== false,
          isDefault: Boolean(local.isDefault),
          linkedZones: local.linkedZones || (local.linkedZone ? [local.linkedZone] : []),
          assignedPrinterId: local.assignedPrinterId || null,
          notes: local.notes || null,
          sourceDeviceKey: deviceKey
        },
        printers: localPrinters.map(printer => ({
          id: printer.id,
          name: printer.name,
          role: printer.role,
          enabled: printer.enabled
        })),
        overwriteExisting
      })
    });
    const result = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw new Error(result.error || `El servidor rechazó la creación (HTTP ${response.status}).`);
    if (!result.branch || !result.register) throw new Error('El servidor no confirmó la sucursal y la caja.');

    return {
      branch: result.branch as CloudBranch,
      register: result.register as CloudRegister,
      created: result.created === true,
      updated: result.updated === true
    };
  }

  subscribe(tenantId: string, onChange: () => void): () => void {
    if (!supabaseClient || !tenantId) return () => undefined;
    const channel = supabaseClient
      .channel(`tenant-${tenantId}-cash-control`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_cash_registers', filter: `tenant_id=eq.${tenantId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_cash_shifts', filter: `tenant_id=eq.${tenantId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_terminals', filter: `tenant_id=eq.${tenantId}` }, onChange)
      .subscribe();

    return () => {
      void supabaseClient?.removeChannel(channel);
    };
  }
}

export const cashControlCloudService = new CashControlCloudService();
