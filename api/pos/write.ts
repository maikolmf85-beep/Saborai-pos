import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../_utils/supabase.js';
import { employeeSessionActorMatches } from '../_utils/employeeSession.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders, type AuthContext } from '../_utils/security.js';
import { ROLE_PERMISSIONS } from '../_utils/rolePermissions.js';
import { isUuid, normalizeReservation, normalizeTableLayout } from '../_utils/directWrites.js';

const SERVER_ACTIONS = new Set([
  'SAVE_TABLE_LAYOUT',
  'SEED_TABLE_LAYOUT',
  'UPSERT_TABLE_RESERVATION',
  'DELETE_TABLE_RESERVATION',
  'CASH_CONTROL_SYNC',
  'CASH_CONTROL_IMPORT'
]);
const CASH_CAPABLE_ROLES = new Set(['ADMIN', 'CAJERO', 'SALONERO_CAJA']);
const MAX_TEXT = 500;

type BranchRow = { id: string; tenant_id: string; code: string; name: string; is_active: boolean };
type RegisterRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  terminal_code: string;
  allows_billing: boolean;
  allows_ordering: boolean;
  is_active: boolean;
  is_default: boolean;
  linked_zones: unknown;
  assigned_printer_id?: string | null;
  notes?: string | null;
  legacy_id?: string | null;
  source_device_key?: string | null;
};
type ShiftInput = {
  id: string;
  shiftNumber: number;
  registerId: string;
  status: 'OPEN' | 'CLOSED';
  initialFloat: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  notes: string;
  movements: Array<Record<string, unknown>>;
  systemSummary: Record<string, number>;
  cashBreakdown: Record<string, unknown> | null;
  countedCards: number | null;
  dataphonesBreakdown: Array<Record<string, unknown>> | null;
  countedSinpe: number | null;
  differenceReason: string | null;
  zReportGenerated: boolean;
  participants: unknown[];
  openedBy: unknown;
};

function boundedText(value: unknown, label: string, max = MAX_TEXT, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} no es válido.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) throw new Error(`${label} no es válido.`);
  return normalized;
}

function optionalNumber(value: unknown, label: string, allowNegative = false): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) {
    throw new Error(`${label} no es válido.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string, allowNegative = false): number {
  const number = optionalNumber(value, label, allowNegative);
  if (number === null) throw new Error(`${label} no es válido.`);
  return number;
}

function dateValue(value: unknown, label: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} no es válida.`);
  return new Date(value).toISOString();
}

function normalizedBranchCode(value: unknown): string {
  const digits = String(value || '001').replace(/[^0-9]/g, '');
  return (digits || '1').padStart(3, '0').slice(-3);
}

function readRegisters(value: unknown): Array<Record<string, any>> {
  if (!Array.isArray(value) || value.length > 250) throw new Error('La lista de cajas no es válida.');
  return value.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('La configuración contiene una caja inválida.');
    const id = boundedText(raw.id, 'El identificador de caja', 120);
    const terminalCode = boundedText(raw.terminalCode, 'El código de terminal', 5);
    if (!/^\d{5}$/.test(terminalCode)) throw new Error('El código de terminal debe contener cinco dígitos.');
    const linkedZonesSource = Array.isArray(raw.linkedZones)
      ? raw.linkedZones
      : (typeof raw.linkedZone === 'string' && raw.linkedZone.trim() ? [raw.linkedZone] : []);
    if (linkedZonesSource.length > 100 || linkedZonesSource.some((zone: unknown) => typeof zone !== 'string' || zone.trim().length > 120)) {
      throw new Error('La lista de salones de una caja no es válida.');
    }
    return {
      id,
      name: boundedText(raw.name, 'El nombre de caja', 120),
      terminalCode,
      branchCode: normalizedBranchCode(raw.branchCode),
      allowsBilling: raw.allowsBilling !== false,
      allowsOrdering: raw.allowsOrdering !== false,
      isDefault: raw.isDefault === true,
      linkedZones: linkedZonesSource.map((zone: string) => zone.trim()).filter(Boolean),
      assignedPrinterId: raw.assignedPrinterId == null || raw.assignedPrinterId === ''
        ? null
        : (isUuid(raw.assignedPrinterId) ? raw.assignedPrinterId : null),
      notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 500) : null,
      isActive: raw.isActive !== false
    };
  });
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readMovements(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) throw new Error('Los movimientos del turno no son válidos.');
  return value.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Hay un movimiento de caja inválido.');
    if (!['INFLOW', 'OUTFLOW', 'TIP_WITHDRAWAL'].includes(raw.type)) throw new Error('El tipo de movimiento no es válido.');
    return {
      id: boundedText(raw.id, 'El identificador del movimiento', 120),
      shiftId: boundedText(raw.shiftId, 'El turno del movimiento', 120),
      timestamp: dateValue(raw.timestamp, 'La fecha del movimiento'),
      type: raw.type,
      amount: requiredNumber(raw.amount, 'El monto del movimiento'),
      reason: boundedText(raw.reason ?? '', 'El motivo del movimiento', 240, true),
      authorizedBy: boundedText(raw.authorizedBy ?? '', 'El autorizador', 120, true),
      performedBy: boundedText(raw.performedBy ?? '', 'El responsable', 120, true)
    };
  });
}

function readShift(value: unknown): ShiftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hay un turno inválido.');
  const raw = value as Record<string, any>;
  const id = boundedText(raw.id, 'El identificador de turno', 120);
  const status = raw.status === 'CLOSING' ? 'CLOSED' : raw.status;
  if (status !== 'OPEN' && status !== 'CLOSED') throw new Error('El estado de turno no es válido.');
  if (!Number.isInteger(raw.shiftNumber) || raw.shiftNumber < 0) throw new Error('El número de turno no es válido.');
  const system = readObject(raw.systemSummary) || {};
  const summaryKeys = [
    'cashSales', 'cardSales', 'sinpeSales', 'totalSales', 'subtotal', 'totalTax',
    'serviceTax10', 'totalInflows', 'totalOutflows', 'expectedCashInDrawer', 'invoicesCount'
  ];
  const systemSummary: Record<string, number> = {};
  for (const key of summaryKeys) systemSummary[key] = optionalNumber(system[key] ?? 0, `El resumen ${key}`) as number;

  const dataphoneInput = raw.dataphonesBreakdown;
  let dataphonesBreakdown: Array<Record<string, unknown>> | null = null;
  if (dataphoneInput !== undefined && dataphoneInput !== null) {
    if (!Array.isArray(dataphoneInput) || dataphoneInput.length > 4) throw new Error('El desglose de datáfonos no es válido.');
    dataphonesBreakdown = dataphoneInput.map((entry: any) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Hay un datáfono inválido.');
      return {
        id: boundedText(entry.id, 'El identificador del datáfono', 80),
        name: boundedText(entry.name, 'El nombre del datáfono', 120),
        amount: requiredNumber(entry.amount, 'El monto del datáfono')
      };
    });
  }

  return {
    id,
    shiftNumber: raw.shiftNumber,
    registerId: boundedText(raw.cashRegisterId || raw.registerId, 'La caja del turno', 120),
    status,
    initialFloat: requiredNumber(raw.initialCashFloat ?? 0, 'El fondo inicial'),
    expectedCash: requiredNumber(system.expectedCashInDrawer ?? raw.expectedCash ?? raw.initialCashFloat ?? 0, 'El efectivo esperado'),
    countedCash: optionalNumber(raw.countedCash, 'El efectivo contado'),
    difference: optionalNumber(raw.cashDifference, 'La diferencia', true),
    openedAt: dateValue(raw.openedAt, 'La fecha de apertura') as string,
    closedAt: dateValue(raw.closedAt, 'La fecha de cierre', true),
    notes: boundedText(raw.notes ?? '', 'Las notas del turno', 1000, true),
    movements: readMovements(raw.movements),
    systemSummary,
    cashBreakdown: readObject(raw.cashBreakdown),
    countedCards: optionalNumber(raw.countedCards, 'El total de tarjetas'),
    dataphonesBreakdown,
    countedSinpe: optionalNumber(raw.countedSinpe, 'El total SINPE'),
    differenceReason: typeof raw.differenceReason === 'string' ? raw.differenceReason.trim().slice(0, 500) : null,
    zReportGenerated: raw.zReportGenerated === true,
    participants: Array.isArray(raw.participants) ? raw.participants.slice(0, 100) : [],
    openedBy: raw.openedBy
  };
}

function actorParticipant(auth: AuthContext): Record<string, unknown> {
  return {
    userId: auth.employeeExternalId || auth.userId,
    userName: auth.employeeName || auth.email,
    userRole: auth.role || 'ADMIN',
    joinedAt: new Date().toISOString()
  };
}

async function loadTrustedParticipants(tenantId: string, auth: AuthContext) {
  const [ownerResult, employeesResult] = await Promise.all([
    supabaseAdmin.from('users').select('id, name, role').eq('id', auth.userId).maybeSingle(),
    supabaseAdmin.from('pos_employees').select('external_id, name, role, is_active').eq('tenant_id', tenantId).limit(300)
  ]);
  if (ownerResult.error || (employeesResult.error && auth.employeeId)) {
    throw new Error('No se pudo validar el padrón de participantes.');
  }
  const byExternalId = new Map<string, Record<string, unknown>>();
  for (const employee of employeesResult.error ? [] : employeesResult.data || []) {
    if (employee.is_active === false) continue;
    byExternalId.set(employee.external_id, {
      userId: employee.external_id,
      userName: employee.name,
      userRole: employee.role
    });
  }
  const owner = ownerResult.data;
  if (owner) byExternalId.set(owner.id, { userId: owner.id, userName: owner.name, userRole: owner.role });
  const current = actorParticipant(auth);
  byExternalId.set(String(current.userId), current);
  return byExternalId;
}

function trustedParticipants(
  rawParticipants: unknown[],
  actorMap: Map<string, Record<string, unknown>>,
  auth: AuthContext,
  includeCurrentEmployee = false
) {
  const participants = new Map<string, Record<string, unknown>>();
  for (const candidate of rawParticipants) {
    const raw = readObject(candidate);
    if (!raw || typeof raw.userId !== 'string') continue;
    const trusted = actorMap.get(raw.userId);
    if (!trusted) continue;
    const joinedAt = typeof raw.joinedAt === 'string' && Number.isFinite(Date.parse(raw.joinedAt))
      ? new Date(raw.joinedAt).toISOString()
      : new Date().toISOString();
    participants.set(String(trusted.userId), { ...trusted, joinedAt });
  }
  if (includeCurrentEmployee && auth.employeeId) {
    const current = actorParticipant(auth);
    const currentId = String(current.userId);
    if (!participants.has(currentId)) participants.set(currentId, current);
  }
  return [...participants.values()];
}

async function addAudit(
  tenantId: string,
  operationId: string,
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: auth.userId,
    actor_employee_id: auth.employeeId || null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    request_id: operationId,
    metadata
  });
}

async function saveTableLayout(tenantId: string, layoutValue: unknown, onlyIfMissing: boolean) {
  const layout = normalizeTableLayout(layoutValue);
  const result = await supabaseAdmin.from('pos_table_layouts').upsert({
    tenant_id: tenantId,
    layout,
    updated_at: new Date().toISOString()
  }, { onConflict: 'tenant_id', ignoreDuplicates: onlyIfMissing });
  if (result.error) throw new Error('No se pudo guardar el diseño de mesas.');
  const read = await supabaseAdmin.from('pos_table_layouts').select('layout, updated_at').eq('tenant_id', tenantId).maybeSingle();
  if (read.error || !read.data) throw new Error('No se pudo confirmar el diseño de mesas.');
  return {
    available: true,
    exists: true,
    record: { layout: normalizeTableLayout(read.data.layout), updatedAt: read.data.updated_at }
  };
}

async function saveReservation(tenantId: string, reservationValue: unknown) {
  const reservation = normalizeReservation(reservationValue);
  const existing = await supabaseAdmin.from('pos_table_reservations')
    .select('id, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', reservation.id)
    .maybeSingle();
  if (existing.error) throw new Error('No se pudo verificar la reserva.');

  const row = {
    tenant_id: tenantId,
    table_id: reservation.tableId,
    table_name: reservation.tableName,
    zone: reservation.zone,
    customer_name: reservation.customerName,
    customer_phone: reservation.customerPhone,
    customer_email: reservation.customerEmail,
    reserved_at: reservation.reservedAt,
    duration_minutes: reservation.durationMinutes,
    party_size: reservation.partySize,
    status: reservation.status,
    notes: reservation.notes,
    arrived_at: reservation.arrivedAt,
    seated_at: reservation.seatedAt,
    updated_at: new Date().toISOString()
  };
  const write = existing.data
    ? await supabaseAdmin.from('pos_table_reservations').update(row).eq('tenant_id', tenantId).eq('id', reservation.id).select('id').single()
    : await supabaseAdmin.from('pos_table_reservations').insert({
        id: reservation.id,
        ...row,
        created_at: new Date().toISOString()
      }).select('id').single();
  if (write.error || !write.data) throw new Error('No se pudo guardar la reserva.');
  return { reservationId: write.data.id };
}

async function deleteReservation(tenantId: string, idValue: unknown) {
  if (!isUuid(idValue)) throw new Error('El identificador de la reserva no es válido.');
  const { error } = await supabaseAdmin.from('pos_table_reservations').delete().eq('tenant_id', tenantId).eq('id', idValue);
  if (error) throw new Error('No se pudo eliminar la reserva.');
  return { reservationId: idValue, deleted: true };
}

async function findOrCreateBranch(
  tenantId: string,
  branchCode: string,
  branches: BranchRow[]
): Promise<BranchRow> {
  const code = normalizedBranchCode(branchCode);
  const exact = branches.find(branch => branch.code === code);
  if (exact) {
    if (!exact.is_active) throw new Error(`La sucursal ${code} está inactiva.`);
    return exact;
  }
  const activeBranches = branches.filter(branch => branch.is_active);
  if (activeBranches.length === 1) return activeBranches[0];
  if (activeBranches.length > 1 || branches.length > 0 && activeBranches.length === 0) {
    throw new Error(`No se encontró una sucursal activa para el código ${code}.`);
  }

  const created = await supabaseAdmin.from('pos_branches').insert({
    tenant_id: tenantId,
    name: 'Sucursal Principal',
    code,
    timezone: 'America/Costa_Rica',
    currency: 'CRC',
    is_active: true
  }).select('id, tenant_id, code, name, is_active').single();
  if (created.error || !created.data) throw new Error(`No se pudo crear la sucursal principal (${code}).`);
  branches.push(created.data as BranchRow);
  return created.data as BranchRow;
}

async function loadCashCloud(tenantId: string) {
  const [branchesResult, registersResult, shiftsResult] = await Promise.all([
    supabaseAdmin.from('pos_branches').select('id, tenant_id, code, name, is_active').eq('tenant_id', tenantId).limit(500),
    supabaseAdmin.from('pos_cash_registers')
      .select('id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id, source_device_key')
      .eq('tenant_id', tenantId).limit(1000),
    supabaseAdmin.from('pos_cash_shifts')
      .select('id, tenant_id, branch_id, cash_register_id, status, shift_number, legacy_id, opened_by, closed_by, opening_float, expected_cash, counted_cash, difference, opened_at, closed_at, notes, participants, movements, system_summary, cash_breakdown, counted_cards, dataphones_breakdown, counted_sinpe, difference_reason, z_report_generated')
      .eq('tenant_id', tenantId).limit(2000)
  ]);
  const error = branchesResult.error || registersResult.error || shiftsResult.error;
  if (error) throw new Error('No se pudo cargar la configuración central de caja.');
  return {
    branches: (branchesResult.data || []) as BranchRow[],
    registers: (registersResult.data || []) as RegisterRow[],
    shifts: shiftsResult.data || []
  };
}

async function importRegisters(
  tenantId: string,
  registersInput: unknown,
  branches: BranchRow[],
  cloudRegisters: RegisterRow[],
  deviceKey: string,
  overwriteExisting: boolean
): Promise<{ byLocalId: Map<string, RegisterRow>; importedRegisters: number; skippedExisting: number; conflicts: string[] }> {
  const registers = readRegisters(registersInput);
  const byLocalId = new Map<string, RegisterRow>();
  const conflicts: string[] = [];
  let importedRegisters = 0;
  let skippedExisting = 0;

  for (const local of registers) {
    try {
      const branch = await findOrCreateBranch(tenantId, local.branchCode, branches);
      let existing = cloudRegisters.find(row => row.legacy_id === local.id)
        || cloudRegisters.find(row => row.branch_id === branch.id && row.terminal_code === local.terminalCode);
      if (existing && !overwriteExisting) {
        byLocalId.set(local.id, existing);
        skippedExisting += 1;
        if (!existing.legacy_id) {
          const updated = await supabaseAdmin.from('pos_cash_registers')
            .update({ legacy_id: local.id, source_device_key: deviceKey })
            .eq('tenant_id', tenantId).eq('id', existing.id)
            .select('id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id, source_device_key').single();
          if (updated.error || !updated.data) throw new Error('No se pudo vincular el identificador local de la caja.');
          existing = updated.data as RegisterRow;
          const index = cloudRegisters.findIndex(row => row.id === existing?.id);
          if (index >= 0) cloudRegisters[index] = existing;
        }
        continue;
      }

      const row = {
        tenant_id: tenantId,
        branch_id: branch.id,
        name: local.name,
        terminal_code: local.terminalCode,
        allows_billing: local.allowsBilling,
        allows_ordering: local.allowsOrdering,
        is_default: local.isDefault,
        linked_zones: local.linkedZones,
        assigned_printer_id: local.assignedPrinterId,
        notes: local.notes,
        legacy_id: local.id,
        source_device_key: deviceKey,
        is_active: local.isActive
      };
      const result = existing
        ? await supabaseAdmin.from('pos_cash_registers').update(row).eq('tenant_id', tenantId).eq('id', existing.id)
          .select('id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id, source_device_key').single()
        : await supabaseAdmin.from('pos_cash_registers').insert(row)
          .select('id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id, source_device_key').single();
      if (result.error || !result.data) throw new Error(result.error?.message || 'respuesta vacía');
      const saved = result.data as RegisterRow;
      byLocalId.set(local.id, saved);
      const index = cloudRegisters.findIndex(item => item.id === saved.id);
      if (index >= 0) cloudRegisters[index] = saved;
      else cloudRegisters.push(saved);
      if (!existing) importedRegisters += 1;
    } catch (error: any) {
      conflicts.push(`No se pudo importar la caja "${local.name}": ${error?.message || 'error inesperado'}`);
    }
  }
  return { byLocalId, importedRegisters, skippedExisting, conflicts };
}

function shiftRow(
  tenantId: string,
  branchId: string,
  registerId: string,
  input: ShiftInput,
  auth: AuthContext,
  actorMap: Map<string, Record<string, unknown>>,
  existing: any | null
) {
  return {
    tenant_id: tenantId,
    branch_id: branchId,
    cash_register_id: registerId,
    opened_by: existing?.opened_by || auth.userId,
    closed_by: input.status === 'CLOSED' ? auth.userId : (existing?.closed_by || null),
    status: input.status,
    opening_float: input.initialFloat,
    expected_cash: input.expectedCash,
    counted_cash: input.countedCash,
    difference: input.difference,
    opened_at: input.openedAt,
    closed_at: input.status === 'CLOSED' ? (input.closedAt || existing?.closed_at || new Date().toISOString()) : null,
    notes: input.notes,
    shift_number: input.shiftNumber,
    participants: trustedParticipants(input.participants, actorMap, auth, true),
    movements: input.movements,
    system_summary: input.systemSummary,
    cash_breakdown: input.cashBreakdown,
    counted_cards: input.countedCards,
    dataphones_breakdown: input.dataphonesBreakdown,
    counted_sinpe: input.countedSinpe,
    difference_reason: input.differenceReason,
    z_report_generated: input.zReportGenerated,
    legacy_id: input.id,
    source_device_key: null
  };
}

async function syncShifts(
  tenantId: string,
  shiftsValue: unknown,
  cloudRegisters: RegisterRow[],
  cloudShifts: any[],
  deviceKey: string,
  auth: AuthContext,
  mode: 'sync' | 'import'
): Promise<{ importedShifts: number; skippedExisting: number; conflicts: string[]; syncedParticipants: number }> {
  if (!Array.isArray(shiftsValue) || shiftsValue.length > 1000) throw new Error('La lista de turnos no es válida.');
  const candidates = shiftsValue.map(readShift);
  const actorMap = await loadTrustedParticipants(tenantId, auth);
  const conflicts: string[] = [];
  let importedShifts = 0;
  let skippedExisting = 0;
  let syncedParticipants = 0;
  const canWriteFinancialShift = !auth.employeeId || CASH_CAPABLE_ROLES.has(String(auth.role || ''));

  for (const shift of candidates) {
    try {
      const register = cloudRegisters.find(item => item.legacy_id === shift.registerId || item.id === shift.registerId);
      if (!register) {
        conflicts.push(`Se omitió el turno ${shift.shiftNumber}: no se encontró su caja central.`);
        continue;
      }
      if (shift.status === 'OPEN' && !register.is_active) {
        conflicts.push(`Se omitió el turno ${shift.shiftNumber}: la caja "${register.name}" está inactiva.`);
        continue;
      }
      const existing = cloudShifts.find(row => row.legacy_id === shift.id);
      if (mode === 'import' && existing) {
        skippedExisting += 1;
        continue;
      }

      if (!canWriteFinancialShift) {
        if (!existing || existing.status !== 'OPEN' || shift.status !== 'OPEN' || !auth.employeeExternalId) {
          skippedExisting += 1;
          continue;
        }
        const participant = actorParticipant(auth);
        const oldParticipants = trustedParticipants(Array.isArray(existing.participants) ? existing.participants : [], actorMap, auth);
        const merged = oldParticipants.some(item => item.userId === participant.userId)
          ? oldParticipants
          : [...oldParticipants, participant];
        const saved = await supabaseAdmin.from('pos_cash_shifts').update({ participants: merged })
          .eq('tenant_id', tenantId).eq('id', existing.id).eq('status', 'OPEN').select('id').single();
        if (saved.error || !saved.data) throw new Error('No se pudo registrar al colaborador en el turno abierto.');
        syncedParticipants += 1;
        continue;
      }

      if (auth.employeeId && !existing) {
        const openedBy = readObject(shift.openedBy);
        const openedById = openedBy?.userId;
        if (shift.status !== 'OPEN' || openedById !== auth.employeeExternalId) {
          conflicts.push(`Se omitió el turno ${shift.shiftNumber}: la sesión actual no puede importar un turno histórico ajeno.`);
          continue;
        }
      }
      if (auth.employeeId && auth.role !== 'ADMIN' && existing?.status === 'CLOSED') {
        conflicts.push(`Se omitió el turno ${shift.shiftNumber}: un empleado no puede modificar un turno ya cerrado.`);
        continue;
      }
      if (existing?.status === 'CLOSED' && shift.status === 'OPEN' && auth.role !== 'ADMIN') {
        conflicts.push(`Se omitió el turno ${shift.shiftNumber}: no se puede reabrir un turno cerrado.`);
        continue;
      }
      if (shift.status === 'OPEN') {
        const anotherOpen = cloudShifts.find(row => row.cash_register_id === register.id && row.status === 'OPEN' && row.id !== existing?.id);
        if (anotherOpen) {
          conflicts.push(`Se omitió el turno ${shift.shiftNumber}: la caja "${register.name}" ya tiene un turno abierto.`);
          continue;
        }
      }

      const rawRow = shiftRow(tenantId, register.branch_id, register.id, shift, auth, actorMap, existing);
      const row: Record<string, unknown> = rawRow;
      row.source_device_key = deviceKey;
      const result = existing
        ? await supabaseAdmin.from('pos_cash_shifts').update(row).eq('tenant_id', tenantId).eq('id', existing.id).select('id').single()
        : await supabaseAdmin.from('pos_cash_shifts').insert(row).select('id').single();
      if (result.error || !result.data) throw new Error(result.error?.message || 'No se pudo guardar el turno.');
      if (existing) {
        const index = cloudShifts.findIndex(item => item.id === existing.id);
        if (index >= 0) cloudShifts[index] = { ...existing, ...row };
        else cloudShifts.push({ ...row, id: result.data.id });
      } else {
        cloudShifts.push({ ...row, id: result.data.id });
        importedShifts += 1;
      }
    } catch (error: any) {
      conflicts.push(`No se pudo sincronizar el turno ${shift.shiftNumber}: ${error?.message || 'error inesperado'}`);
    }
  }
  return { importedShifts, skippedExisting, conflicts, syncedParticipants };
}

async function syncCashControl(
  tenantId: string,
  auth: AuthContext,
  action: string,
  payloadValue: unknown
) {
  const payload = readObject(payloadValue);
  if (!payload) throw new Error('El payload de caja no es válido.');
  const mode: 'sync' | 'import' = action === 'CASH_CONTROL_IMPORT' ? 'import' : 'sync';
  const deviceKey = boundedText(payload.deviceKey, 'La clave del dispositivo', 200);
  if (deviceKey.length < 16) throw new Error('La clave del dispositivo no es válida.');
  const deviceName = typeof payload.deviceName === 'string' ? payload.deviceName.trim().slice(0, 120) : 'Dispositivo POS';
  const cloud = await loadCashCloud(tenantId);
  let cloudRegisters = cloud.registers;
  let importedRegisters = 0;
  let importedShifts = 0;
  let skippedExisting = 0;
  let assignedTerminal = false;
  let syncedParticipants = 0;
  const conflicts: string[] = [];
  const mayManageConfiguration = auth.role === 'ADMIN';

  if (mayManageConfiguration) {
    const registersResult = await importRegisters(
      tenantId,
      payload.registers,
      cloud.branches,
      cloudRegisters,
      deviceKey,
      payload.overwriteExisting === true
    );
    importedRegisters += registersResult.importedRegisters;
    skippedExisting += registersResult.skippedExisting;
    conflicts.push(...registersResult.conflicts);
  }

  const shiftsResult = await syncShifts(
    tenantId,
    payload.shifts,
    cloudRegisters,
    cloud.shifts,
    deviceKey,
    auth,
    mode
  );
  importedShifts += shiftsResult.importedShifts;
  skippedExisting += shiftsResult.skippedExisting;
  syncedParticipants += shiftsResult.syncedParticipants;
  conflicts.push(...shiftsResult.conflicts);

  if (mayManageConfiguration) {
    const localTerminalId = typeof payload.currentTerminalId === 'string' ? payload.currentTerminalId : '';
    const terminalRegister = cloudRegisters.find(register => register.is_active
      && (register.legacy_id === localTerminalId || register.id === localTerminalId))
      || cloudRegisters.find(register => register.is_active && register.is_default)
      || cloudRegisters.find(register => register.is_active);
    if (terminalRegister) {
      const terminal = await supabaseAdmin.from('pos_terminals').upsert({
        tenant_id: tenantId,
        branch_id: terminalRegister.branch_id,
        cash_register_id: terminalRegister.id,
        device_key: deviceKey,
        device_name: deviceName,
        last_seen_at: new Date().toISOString(),
        is_active: true
      }, { onConflict: 'tenant_id,device_key' }).select('id').single();
      if (terminal.error) conflicts.push(`No se pudo asignar este dispositivo a la caja: ${terminal.error.message}`);
      else assignedTerminal = true;
    }
  }

  return {
    importedRegisters,
    importedShifts,
    assignedTerminal,
    skippedExisting,
    syncedParticipants,
    conflicts,
    migrationMarker: new Date().toISOString()
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const body = (req.body || {}) as {
    operationId?: unknown;
    tenantId?: unknown;
    action?: unknown;
    actorUserId?: unknown;
    actorEmployeeId?: unknown;
    payload?: unknown;
  };
  const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';

  if (!operationId || operationId.length > 160) return res.status(400).json({ error: 'operationId es requerido.' });
  if (!tenantId || tenantId !== auth.tenantId) return res.status(403).json({ error: 'El tenant de la operación no coincide con la sesión.' });
  if (!employeeSessionActorMatches(body.actorUserId, body.actorEmployeeId, auth)) {
    return res.status(403).json({ error: 'La identidad que creó la operación no coincide con la sesión activa.' });
  }
  if (!SERVER_ACTIONS.has(action)) return res.status(422).json({ error: `La operación ${action || 'desconocida'} no está habilitada.` });

  const allowed = ROLE_PERMISSIONS.directWrites[action as keyof typeof ROLE_PERMISSIONS.directWrites] as readonly string[];
  if (!requireRole(auth, res, allowed)) return;
  if (action === 'CASH_CONTROL_IMPORT' && auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo un administrador puede importar la configuración de caja.' });
  }

  const priorAudit = await supabaseAdmin.from('pos_audit_events').select('metadata')
    .eq('tenant_id', tenantId).eq('request_id', operationId).limit(1).maybeSingle();
  if (priorAudit.data) return res.status(200).json({ success: true, alreadyApplied: true, result: priorAudit.data.metadata });

  try {
    let result: any;
    let entityType = action;
    let entityId: string | null = null;
    if (action === 'SAVE_TABLE_LAYOUT' || action === 'SEED_TABLE_LAYOUT') {
      result = await saveTableLayout(tenantId, (body.payload as any)?.layout, action === 'SEED_TABLE_LAYOUT');
      entityType = 'TABLE_LAYOUT';
      entityId = tenantId;
    } else if (action === 'UPSERT_TABLE_RESERVATION') {
      result = await saveReservation(tenantId, (body.payload as any)?.reservation);
      entityType = 'TABLE_RESERVATION';
      entityId = result.reservationId;
    } else if (action === 'DELETE_TABLE_RESERVATION') {
      result = await deleteReservation(tenantId, (body.payload as any)?.reservationId);
      entityType = 'TABLE_RESERVATION';
      entityId = result.reservationId;
    } else {
      result = await syncCashControl(tenantId, auth, action, body.payload);
      entityType = 'CASH_CONTROL';
      entityId = null;
    }

    await addAudit(tenantId, operationId, auth, 'SERVER_VALIDATED_WRITE', entityType, entityId, result || {});
    return res.status(200).json({ success: true, alreadyApplied: false, result });
  } catch (error: any) {
    console.error('[POS Write] Error:', error);
    return res.status(409).json({ error: error?.message || 'No se pudo guardar la operación.' });
  }
}
