import type { CashRegister, CashShift } from '../types/cashShift';
import { getTenantItem } from './tenantStorage';
import { isSupabaseConfigured, supabaseClient } from '../lib/supabaseClient';
import { writePosOperation } from './serverWriteService';

const DEVICE_KEY_STORAGE = 'saborai_cash_control_device_key';
const MIGRATION_MARKER_PREFIX = 'saborai_cash_control_migration:';

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

export interface CashControlMigrationResult {
  importedRegisters: number;
  importedShifts: number;
  assignedTerminal: boolean;
  skippedExisting: number;
  conflicts: string[];
  migrationMarker: string;
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

  getMigrationMarker(tenantId: string): string | null {
    if (typeof window === 'undefined' || !tenantId) return null;
    return localStorage.getItem(`${MIGRATION_MARKER_PREFIX}${tenantId}`);
  }

  private setMigrationMarker(tenantId: string, marker: string): void {
    if (typeof window !== 'undefined' && tenantId) {
      localStorage.setItem(`${MIGRATION_MARKER_PREFIX}${tenantId}`, marker);
    }
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
    const registers = snapshot.registers.map(register => ({
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

    const currentTerminalId = snapshot.currentDeviceTerminal
      ? (registerByCloudId.get(snapshot.currentDeviceTerminal.cash_register_id)?.legacy_id || snapshot.currentDeviceTerminal.cash_register_id)
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

  async importLocalConfiguration(
    tenantId: string,
    options: { deviceName?: string; overwriteExisting?: boolean; mode?: 'sync' | 'import' } = {}
  ): Promise<CashControlMigrationResult> {
    const mode = options.mode || 'import';
    const action = mode === 'sync' ? 'CASH_CONTROL_SYNC' : 'CASH_CONTROL_IMPORT';
    const deviceKey = getOrCreateDeviceKey();
    const registers = getTenantItem<CashRegister[]>('cash_registers', tenantId) || [];
    const shifts = uniqueShifts(
      getTenantItem<Record<string, CashShift>>('shifts_map', tenantId),
      getTenantItem<CashShift[]>('shifts_history', tenantId) || []
    );
    const result = await writePosOperation<CashControlMigrationResult>(action, tenantId, {
      mode,
      registers,
      shifts,
      deviceKey,
      deviceName: options.deviceName || (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'Dispositivo POS'),
      currentTerminalId: getTenantItem<string>('current_terminal_id', tenantId) || '',
      overwriteExisting: options.overwriteExisting === true
    });
    if (result.migrationMarker) this.setMigrationMarker(tenantId, result.migrationMarker);
    return result;
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
