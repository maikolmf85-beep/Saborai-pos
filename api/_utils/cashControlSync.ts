type CashControlAdminClient = {
  from(table: string): any;
  rpc(functionName: string, args: RecordValue): any;
};

type RecordValue = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{16,160}$/;
const JSON_LIMIT = 96_000;

export class DailyCashClosedError extends Error {
  readonly code = 'DAILY_CASH_CLOSED';

  constructor(registerName: string, businessDate: string, message?: string) {
    super(message || `No se puede registrar el cobro: la caja "${registerName || 'Caja'}" ya tiene cierre diario para el ${businessDate}. El cobro no se registró. Contacte al administrador si necesita corregir el cierre.`);
    this.name = 'DailyCashClosedError';
  }
}

export function getBusinessDateForInstant(instant: string, timezone: string): string {
  const timestamp = new Date(instant);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('La fecha del cobro no es válida.');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(timestamp);
  } catch {
    throw new Error('No se pudo determinar la fecha local de la sucursal; el cobro no se registró. Contacte al administrador.');
  }
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) throw new Error('No se pudo determinar la fecha local de la sucursal; el cobro no se registró. Contacte al administrador.');
  return `${values.year}-${values.month}-${values.day}`;
}

export async function assertCashRegisterOpenForPayment(
  admin: CashControlAdminClient,
  tenantId: string,
  branchId: string,
  registerId: string,
  registerName: string,
  paidAt: string
): Promise<string> {
  const branch = await admin.from('pos_branches')
    .select('timezone')
    .eq('tenant_id', tenantId)
    .eq('id', branchId)
    .limit(1)
    .maybeSingle();
  if (branch.error || !branch.data?.timezone) {
    throw new Error('No se pudo verificar la fecha local de la sucursal; el cobro no se registró. Contacte al administrador.');
  }

  const businessDate = getBusinessDateForInstant(paidAt, branch.data.timezone);
  const closure = await admin.from('pos_daily_cash_closures')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('cash_register_id', registerId)
    .eq('business_date', businessDate)
    .limit(1)
    .maybeSingle();
  if (closure.error) {
    throw new Error('No se pudo verificar si la caja tiene cierre diario; el cobro no se registró. Intente de nuevo o contacte al administrador.');
  }
  if (closure.data) throw new DailyCashClosedError(registerName, businessDate);
  return businessDate;
}

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} es inválido.`);
  return value as RecordValue;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} es inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} es inválido.`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, maxLength);
}

function requiredUuid(value: unknown, label: string): string {
  const normalized = requiredText(value, label, 36);
  if (!UUID_RE.test(normalized)) throw new Error(`${label} no tiene un UUID válido.`);
  return normalized;
}

function finiteNumber(value: unknown, label: string, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} debe ser un número válido.`);
  return value;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return finiteNumber(value, label);
}

function isoDate(value: unknown, label: string, fallbackToNow = false): string {
  if (value === undefined || value === null || value === '') {
    if (fallbackToNow) return new Date().toISOString();
    throw new Error(`${label} es inválida.`);
  }
  if (typeof value !== 'string') throw new Error(`${label} es inválida.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} es inválida.`);
  return new Date(timestamp).toISOString();
}

function cloneJsonContainer<T extends RecordValue | unknown[] | null>(value: unknown, label: string, kind: 'object' | 'array', fallback: T, maxItems = 2000): T {
  if (value === undefined || value === null) return fallback;
  if (kind === 'array' && (!Array.isArray(value) || value.length > maxItems)) {
    throw new Error(`${label} supera el formato o tamaño permitido.`);
  }
  if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`${label} tiene un formato inválido.`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} tiene un formato inválido.`);
  }
  if (serialized.length > JSON_LIMIT) throw new Error(`${label} supera el tamaño permitido.`);
  return JSON.parse(serialized) as T;
}

function requireDeviceKey(value: unknown): string {
  const key = requiredText(value, 'El identificador del dispositivo', 160);
  if (!DEVICE_KEY_RE.test(key)) throw new Error('El identificador del dispositivo tiene un formato inválido.');
  return key;
}

function normalizeShiftStatus(value: unknown): 'OPEN' | 'CLOSED' {
  if (value === 'OPEN') return 'OPEN';
  if (value === 'CLOSED' || value === 'CLOSING') return 'CLOSED';
  throw new Error('El estado del turno no es válido.');
}

function buildImportedShiftRow(tenantId: string, register: { id: string; branch_id: string }, shift: RecordValue, deviceKey: string) {
  const status = normalizeShiftStatus(shift.status);
  const systemSummary = cloneJsonContainer<RecordValue>(shift.systemSummary, 'El resumen del turno', 'object', {});
  const shiftNumber = finiteNumber(shift.shiftNumber, 'El número de turno');
  if (!Number.isInteger(shiftNumber) || shiftNumber < 0) throw new Error('El número de turno es inválido.');

  return {
    tenant_id: tenantId,
    branch_id: register.branch_id,
    cash_register_id: register.id,
    opened_by: null,
    closed_by: null,
    status,
    opening_float: finiteNumber(shift.initialCashFloat, 'El fondo inicial'),
    expected_cash: finiteNumber(systemSummary.expectedCashInDrawer, 'El efectivo esperado'),
    counted_cash: nullableNumber(shift.countedCash, 'El efectivo contado'),
    difference: nullableNumber(shift.cashDifference, 'La diferencia'),
    opened_at: isoDate(shift.openedAt, 'La fecha de apertura'),
    closed_at: status === 'CLOSED' ? (shift.closedAt ? isoDate(shift.closedAt, 'La fecha de cierre') : null) : null,
    notes: optionalText(shift.notes, 'Las notas', 4000),
    shift_number: shiftNumber,
    participants: cloneJsonContainer(shift.participants, 'Los participantes', 'array', [], 100),
    movements: cloneJsonContainer(shift.movements, 'Los movimientos', 'array', [], 2000),
    system_summary: systemSummary,
    cash_breakdown: cloneJsonContainer(shift.cashBreakdown, 'El desglose de efectivo', 'object', null),
    counted_cards: nullableNumber(shift.countedCards, 'Las tarjetas contadas'),
    dataphones_breakdown: cloneJsonContainer(shift.dataphonesBreakdown, 'El desglose de datáfonos', 'array', [], 4),
    counted_sinpe: nullableNumber(shift.countedSinpe, 'El SINPE contado'),
    difference_reason: optionalText(shift.differenceReason, 'La razón de diferencia', 1000),
    z_report_generated: shift.zReportGenerated === true,
    legacy_id: requiredText(shift.id, 'El identificador local del turno', 120),
    source_device_key: deviceKey
  };
}

export function buildCashShiftClosePayload(actorUserId: string, value: unknown): RecordValue {
  const actorId = requiredUuid(actorUserId, 'El usuario autenticado');
  const closure = asRecord(value, 'El cierre del turno');
  return {
    status: 'CLOSED',
    closed_by: actorId,
    ...(optionalText(closure.legacy_id, 'El identificador local del turno', 120)
      ? { legacy_id: optionalText(closure.legacy_id, 'El identificador local del turno', 120) }
      : {}),
    expected_cash: finiteNumber(closure.expected_cash, 'El efectivo esperado'),
    counted_cash: nullableNumber(closure.counted_cash, 'El efectivo contado'),
    difference: nullableNumber(closure.difference, 'La diferencia'),
    closed_at: isoDate(closure.closed_at, 'La fecha de cierre', true),
    notes: optionalText(closure.notes, 'Las notas', 4000),
    participants: cloneJsonContainer(closure.participants, 'Los participantes', 'array', [], 100),
    movements: cloneJsonContainer(closure.movements, 'Los movimientos', 'array', [], 2000),
    system_summary: cloneJsonContainer(closure.system_summary, 'El resumen del turno', 'object', {}),
    cash_breakdown: cloneJsonContainer(closure.cash_breakdown, 'El desglose de efectivo', 'object', null),
    counted_cards: nullableNumber(closure.counted_cards, 'Las tarjetas contadas'),
    dataphones_breakdown: cloneJsonContainer(closure.dataphones_breakdown, 'El desglose de datáfonos', 'array', [], 4),
    counted_sinpe: nullableNumber(closure.counted_sinpe, 'El SINPE contado'),
    difference_reason: optionalText(closure.difference_reason, 'La razón de diferencia', 1000),
    z_report_generated: closure.z_report_generated === true
  };
}

export async function closeCashShift(
  admin: CashControlAdminClient,
  tenantId: string,
  actorUserId: string,
  value: unknown
): Promise<RecordValue> {
  const input = asRecord(value, 'La operación de cierre');
  const shiftId = requiredText(input.shiftId, 'El turno', 120);
  if (!UUID_RE.test(shiftId) && !/^[A-Za-z0-9_-]+$/.test(shiftId)) {
    throw new Error('El identificador del turno tiene un formato inválido.');
  }
  const update = buildCashShiftClosePayload(actorUserId, input.closure);
  let lookup = admin.from('pos_cash_shifts')
    .select('id, status')
    .eq('tenant_id', tenantId);
  lookup = UUID_RE.test(shiftId) ? lookup.eq('id', shiftId) : lookup.eq('legacy_id', shiftId);
  const existing = await lookup.limit(1).maybeSingle();
  if (existing.error || !existing.data) {
    throw new Error('El turno no existe o no pertenece a este restaurante.');
  }

  const result = await admin.rpc('pos_close_cash_shift', {
    p_tenant_id: tenantId,
    p_shift_id: existing.data.id,
    p_closed_by: actorUserId,
    p_counted_cash: update.counted_cash,
    p_counted_cards: update.counted_cards,
    p_counted_sinpe: update.counted_sinpe,
    p_cash_breakdown: update.cash_breakdown,
    p_dataphones_breakdown: update.dataphones_breakdown,
    p_difference_reason: update.difference_reason,
    p_notes: update.notes,
    p_system_summary: update.system_summary
  });
  if (result.error || !result.data) {
    throw new Error(result.error?.message || 'No se confirmó el cierre del turno en la nube.');
  }
  return {
    ...result.data,
    shiftId: String(result.data.shiftId || existing.data.id),
    updated: result.data.alreadyClosed !== true,
    alreadyClosed: result.data.alreadyClosed === true
  };
}

export async function closeDailyCash(
  admin: CashControlAdminClient,
  tenantId: string,
  actorUserId: string,
  value: unknown
): Promise<RecordValue> {
  const input = asRecord(value, 'El cierre diario');
  const registerId = requiredText(input.registerId, 'La caja', 120);
  if (!UUID_RE.test(registerId) && !/^[A-Za-z0-9_-]+$/.test(registerId)) {
    throw new Error('El identificador de la caja tiene un formato inválido.');
  }
  const businessDate = requiredText(input.businessDate, 'La fecha del cierre', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)
    || new Date(`${businessDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== businessDate) {
    throw new Error('La fecha del cierre debe tener formato YYYY-MM-DD.');
  }

  let lookup = admin.from('pos_cash_registers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);
  lookup = UUID_RE.test(registerId) ? lookup.eq('id', registerId) : lookup.eq('legacy_id', registerId);
  const register = await lookup.limit(1).maybeSingle();
  if (register.error || !register.data) {
    throw new Error('No se encontró una caja activa de este restaurante.');
  }

  const result = await admin.rpc('pos_close_daily_cash', {
    p_tenant_id: tenantId,
    p_cash_register_id: register.data.id,
    p_business_date: businessDate,
    p_closed_by: actorUserId
  });
  if (result.error || !result.data) {
    throw new Error(result.error?.message || 'No se confirmó el cierre diario de caja.');
  }
  return result.data as RecordValue;
}

export async function importCashShift(
  admin: CashControlAdminClient,
  tenantId: string,
  value: unknown
): Promise<{ shiftId: string; alreadyExists: boolean }> {
  const input = asRecord(value, 'La operación de importación');
  const shift = asRecord(input.shift, 'El turno');
  const registerId = requiredUuid(input.cashRegisterId, 'La caja');
  const deviceKey = requireDeviceKey(input.deviceKey);
  const legacyId = requiredText(shift.id, 'El identificador local del turno', 120);

  const registerResult = await admin.from('pos_cash_registers')
    .select('id, branch_id, is_active')
    .eq('tenant_id', tenantId)
    .eq('id', registerId)
    .maybeSingle();
  if (registerResult.error || !registerResult.data?.is_active) {
    throw new Error('No se encontró una caja activa de este restaurante para importar el turno.');
  }

  const existing = await admin.from('pos_cash_shifts')
    .select('id, cash_register_id')
    .eq('tenant_id', tenantId)
    .eq('legacy_id', legacyId)
    .maybeSingle();
  if (existing.error) throw new Error('No se pudo verificar si el turno ya fue importado.');
  if (existing.data) {
    if (existing.data.cash_register_id !== registerId) throw new Error('El turno local ya está asociado a otra caja.');
    return { shiftId: existing.data.id, alreadyExists: true };
  }

  const row = buildImportedShiftRow(tenantId, registerResult.data, shift, deviceKey);
  if (row.status === 'OPEN') {
    const openShift = await admin.from('pos_cash_shifts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cash_register_id', registerId)
      .eq('status', 'OPEN')
      .limit(1)
      .maybeSingle();
    if (openShift.error) throw new Error('No se pudo verificar si la caja ya tiene un turno abierto.');
    if (openShift.data) throw new Error('La caja ya tiene un turno abierto en la nube.');
  }

  const inserted = await admin.from('pos_cash_shifts').insert(row).select('id').single();
  if (inserted.error || !inserted.data) throw new Error('No se pudo importar el turno en la nube.');
  return { shiftId: inserted.data.id, alreadyExists: false };
}

export async function assignCashTerminal(
  admin: CashControlAdminClient,
  tenantId: string,
  value: unknown
): Promise<{ terminalId: string; assigned: true }> {
  const input = asRecord(value, 'La asignación de terminal');
  const registerId = requiredUuid(input.registerId, 'La caja');
  const deviceKey = requireDeviceKey(input.deviceKey);
  const deviceName = optionalText(input.deviceName, 'El nombre del dispositivo', 120) || 'Dispositivo POS';

  const registerResult = await admin.from('pos_cash_registers')
    .select('id, branch_id, is_active')
    .eq('tenant_id', tenantId)
    .eq('id', registerId)
    .maybeSingle();
  if (registerResult.error || !registerResult.data?.is_active) {
    throw new Error('No se encontró una caja activa de este restaurante para asignar el dispositivo.');
  }

  const terminal = await admin.from('pos_terminals').upsert({
    tenant_id: tenantId,
    branch_id: registerResult.data.branch_id,
    cash_register_id: registerResult.data.id,
    device_key: deviceKey,
    device_name: deviceName,
    last_seen_at: new Date().toISOString(),
    is_active: true
  }, { onConflict: 'tenant_id,device_key' }).select('id').single();
  if (terminal.error || !terminal.data) throw new Error('No se pudo asignar este dispositivo a la caja.');
  return { terminalId: terminal.data.id, assigned: true };
}
