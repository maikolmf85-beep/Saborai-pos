type SetupAuth = {
  role?: string;
  tenantId?: string;
} | null;

type SetupPayload = Record<string, any> | null | undefined;

type PrinterRegistryInput = {
  id: string;
  name: string;
  role: 'caja' | 'cocina' | 'bar';
  isActive: boolean;
};

type SetupResponse = {
  status: number;
  body: Record<string, unknown>;
};

const BRANCH_COLUMNS = 'id, tenant_id, code, name';
const REGISTER_COLUMNS = 'id, tenant_id, branch_id, name, terminal_code, allows_billing, allows_ordering, is_active, is_default, linked_zones, assigned_printer_id, notes, legacy_id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINTER_ROLES = new Set(['caja', 'cocina', 'bar']);

function fail(status: number, error: string): SetupResponse {
  return { status, body: { success: false, error } };
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505';
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function readPrinterRegistry(rawPrinters: unknown):
  | { ok: true; printers: PrinterRegistryInput[] }
  | { ok: false; response: SetupResponse } {
  if (rawPrinters === undefined || rawPrinters === null) return { ok: true, printers: [] };
  if (!Array.isArray(rawPrinters) || rawPrinters.length > 100) {
    return { ok: false, response: fail(400, 'La lista de impresoras es inválida o excede el límite permitido.') };
  }

  const printers: PrinterRegistryInput[] = [];
  const ids = new Set<string>();
  for (const raw of rawPrinters) {
    const value = asRecord(raw);
    const id = typeof value?.id === 'string' ? value.id.trim() : '';
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    const role = value?.role;
    const isActive = value?.isActive ?? value?.enabled;
    if (!id || id.length > 200 || !name || name.length > 120
      || typeof role !== 'string' || !PRINTER_ROLES.has(role)
      || typeof isActive !== 'boolean') {
      return { ok: false, response: fail(400, 'Una impresora contiene un ID, nombre, rol o estado inválido.') };
    }
    if (ids.has(id)) return { ok: false, response: fail(400, 'La lista contiene IDs de impresora duplicados.') };
    ids.add(id);
    printers.push({ id, name, role: role as PrinterRegistryInput['role'], isActive });
  }
  return { ok: true, printers };
}

function readSetupInput(payload: SetupPayload):
  | { ok: true; input: {
      tenantId: string;
      branchCode: string;
      branchName: string;
      printers: PrinterRegistryInput[];
      register: {
        name: string;
        terminalCode: string;
        legacyId: string;
        allowsBilling: boolean;
        allowsOrdering: boolean;
        isActive: boolean;
        isDefault: boolean;
        linkedZones: string[];
        assignedPrinterId: string | null;
        notes: string | null;
        sourceDeviceKey: string | null;
      };
      overwriteExisting: boolean;
    } }
  | { ok: false; response: SetupResponse } {
  const body = asRecord(payload);
  const branch = asRecord(body?.branch);
  const rawRegister = asRecord(body?.register);
  if (!body || !branch || !rawRegister) {
    return { ok: false, response: fail(400, 'La configuración de sucursal y caja es inválida.') };
  }
  if (!validUuid(body.tenantId)) {
    return { ok: false, response: fail(403, 'El tenant de la sesión no coincide con la solicitud.') };
  }

  const printerResult = readPrinterRegistry(body.printers);
  if (!printerResult.ok) return printerResult;

  const branchCode = typeof branch.code === 'string' ? branch.code.trim() : '';
  const branchName = typeof branch.name === 'string' ? branch.name.trim() : 'Sucursal Principal';
  const name = typeof rawRegister.name === 'string' ? rawRegister.name.trim() : '';
  const terminalCode = typeof rawRegister.terminalCode === 'string' ? rawRegister.terminalCode.trim() : '';
  const legacyId = typeof rawRegister.legacyId === 'string' ? rawRegister.legacyId.trim() : '';
  const linkedZones = rawRegister.linkedZones === undefined
    ? []
    : rawRegister.linkedZones;
  const assignedPrinterId = rawRegister.assignedPrinterId === undefined || rawRegister.assignedPrinterId === null
    ? null
    : rawRegister.assignedPrinterId;
  const sourceDeviceKey = rawRegister.sourceDeviceKey === undefined || rawRegister.sourceDeviceKey === null
    ? null
    : rawRegister.sourceDeviceKey;

  if (!/^\d{3}$/.test(branchCode)) {
    return { ok: false, response: fail(400, 'El código de sucursal debe tener tres dígitos.') };
  }
  if (!branchName || branchName.length > 120) {
    return { ok: false, response: fail(400, 'El nombre de sucursal es inválido.') };
  }
  if (!name || name.length > 120 || !/^\d{5}$/.test(terminalCode) || !legacyId || legacyId.length > 200) {
    return { ok: false, response: fail(400, 'El nombre, código DGT o identificador de la caja es inválido.') };
  }
  if (!Array.isArray(linkedZones) || linkedZones.length > 100
    || linkedZones.some(zone => typeof zone !== 'string' || zone.trim().length > 120)) {
    return { ok: false, response: fail(400, 'La lista de salones de la caja es inválida.') };
  }
  if (assignedPrinterId !== null
    && (typeof assignedPrinterId !== 'string' || !assignedPrinterId.trim() || assignedPrinterId.trim().length > 200)) {
    return { ok: false, response: fail(400, 'El ID de impresora asignada es inválido.') };
  }
  if (sourceDeviceKey !== null && (typeof sourceDeviceKey !== 'string' || sourceDeviceKey.length > 200)) {
    return { ok: false, response: fail(400, 'La identificación del dispositivo es inválida.') };
  }
  if (rawRegister.notes !== undefined && rawRegister.notes !== null
    && (typeof rawRegister.notes !== 'string' || rawRegister.notes.length > 2000)) {
    return { ok: false, response: fail(400, 'Las notas de la caja son demasiado largas.') };
  }
  for (const key of ['allowsBilling', 'allowsOrdering', 'isActive', 'isDefault']) {
    if (rawRegister[key] !== undefined && typeof rawRegister[key] !== 'boolean') {
      return { ok: false, response: fail(400, 'La configuración de la caja contiene valores inválidos.') };
    }
  }
  if (body.overwriteExisting !== undefined && typeof body.overwriteExisting !== 'boolean') {
    return { ok: false, response: fail(400, 'La opción de reemplazo es inválida.') };
  }

  return {
    ok: true,
    input: {
      tenantId: body.tenantId,
      branchCode,
      branchName,
      printers: printerResult.printers,
      register: {
        name,
        terminalCode,
        legacyId,
        allowsBilling: rawRegister.allowsBilling ?? true,
        allowsOrdering: rawRegister.allowsOrdering ?? true,
        isActive: rawRegister.isActive ?? true,
        isDefault: rawRegister.isDefault ?? false,
        linkedZones: linkedZones.map((zone: string) => zone.trim()),
        assignedPrinterId: typeof assignedPrinterId === 'string' ? assignedPrinterId.trim() : null,
        notes: rawRegister.notes?.trim() || null,
        sourceDeviceKey
      },
      overwriteExisting: body.overwriteExisting === true
    }
  };
}

async function findBranch(admin: any, tenantId: string, code: string) {
  return admin.from('pos_branches')
    .select(BRANCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('code', code)
    .maybeSingle();
}

async function findRegister(admin: any, tenantId: string, branchId: string, legacyId: string, terminalCode: string) {
  const byLegacy = await admin.from('pos_cash_registers')
    .select(REGISTER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('legacy_id', legacyId)
    .maybeSingle();
  if (byLegacy.error) return { data: null, error: byLegacy.error };
  if (byLegacy.data && byLegacy.data.branch_id !== branchId) {
    return { data: null, error: { code: 'REGISTER_BRANCH_CONFLICT' } };
  }

  const byCode = await admin.from('pos_cash_registers')
    .select(REGISTER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('terminal_code', terminalCode)
    .maybeSingle();
  if (byCode.error) return { data: null, error: byCode.error };
  if (byLegacy.data && byCode.data && byLegacy.data.id !== byCode.data.id) {
    return { data: null, error: { code: 'REGISTER_IDENTITY_CONFLICT' } };
  }
  return { data: byLegacy.data || byCode.data || null, error: null };
}

async function syncPrinterRegistry(admin: any, tenantId: string, printers: PrinterRegistryInput[]) {
  if (printers.length === 0) return { error: null };
  const rows = printers.map(printer => ({
    tenant_id: tenantId,
    id: printer.id,
    name: printer.name,
    role: printer.role,
    is_active: printer.isActive,
    updated_at: new Date().toISOString()
  }));
  return admin.from('pos_printers').upsert(rows, { onConflict: 'tenant_id,id' });
}

export async function ensureTenantCashControlSetup(
  admin: any,
  auth: SetupAuth,
  payload: SetupPayload
): Promise<SetupResponse> {
  if (!auth) return fail(401, 'No autorizado.');
  if (auth.role !== 'ADMIN') return fail(403, 'Solo un administrador puede crear la sucursal y la caja iniciales.');
  const authenticatedTenantId = auth.tenantId;
  if (!validUuid(authenticatedTenantId)) return fail(403, 'La sesión no tiene un restaurante válido asociado.');

  const parsed = readSetupInput(payload);
  if (!parsed.ok) return parsed.response;
  if (parsed.input.tenantId !== authenticatedTenantId) {
    return fail(403, 'El tenant de la sesión no coincide con la solicitud.');
  }

  const tenantId = authenticatedTenantId;
  const { branchCode, branchName, printers, register, overwriteExisting } = parsed.input;
  const printerSync = await syncPrinterRegistry(admin, tenantId, printers);
  if (printerSync.error) return fail(500, 'No se pudo sincronizar el registro de impresoras de este restaurante.');

  if (register.assignedPrinterId) {
    const printer = await admin.from('pos_printers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', register.assignedPrinterId)
      .maybeSingle();
    if (printer.error) return fail(500, 'No se pudo validar la impresora asignada.');
    if (!printer.data) return fail(409, 'La impresora asignada no está registrada para este restaurante. Sincroniza su configuración e inténtalo de nuevo.');
  }

  let branchResult = await findBranch(admin, tenantId, branchCode);
  if (branchResult.error) return fail(500, 'No se pudo consultar la sucursal del restaurante.');
  let branch = branchResult.data;

  if (!branch) {
    const inserted = await admin.from('pos_branches').insert({
      tenant_id: tenantId,
      name: branchName,
      code: branchCode,
      timezone: 'America/Costa_Rica',
      currency: 'CRC',
      is_active: true
    }).select(BRANCH_COLUMNS).single();
    if (inserted.error || !inserted.data) {
      if (!isUniqueViolation(inserted.error)) {
        return fail(500, 'No se pudo crear la sucursal principal.');
      }
      branchResult = await findBranch(admin, tenantId, branchCode);
      if (branchResult.error || !branchResult.data) return fail(500, 'No se pudo confirmar la sucursal principal.');
      branch = branchResult.data;
    } else {
      branch = inserted.data;
    }
  }

  let existingResult = await findRegister(admin, tenantId, branch.id, register.legacyId, register.terminalCode);
  if (existingResult.error?.code === 'REGISTER_BRANCH_CONFLICT') {
    return fail(409, 'La caja ya está asociada a otra sucursal y no se reasignó.');
  }
  if (existingResult.error?.code === 'REGISTER_IDENTITY_CONFLICT') {
    return fail(409, 'El código DGT ya está asociado a otra caja local.');
  }
  if (existingResult.error) return fail(500, 'No se pudo consultar la caja del restaurante.');
  const existing = existingResult.data;
  if (existing?.legacy_id && existing.legacy_id !== register.legacyId) {
    return fail(409, 'El código DGT ya pertenece a otra caja.');
  }
  if (existing?.assigned_printer_id && !overwriteExisting) {
    const existingPrinter = await admin.from('pos_printers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', existing.assigned_printer_id)
      .maybeSingle();
    if (existingPrinter.error) return fail(500, 'No se pudo validar la impresora existente de la caja.');
    if (!existingPrinter.data) return fail(409, 'La impresora ya asignada a esta caja no está registrada para el mismo restaurante.');
  }
  if (existing && !overwriteExisting) {
    return { status: 200, body: { success: true, branch, register: existing, created: false, updated: false, alreadyExists: true } };
  }

  let defaultRegister: { id: string } | null = null;
  if (register.isActive) {
    const defaultResult = await admin.from('pos_cash_registers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .eq('is_default', true)
      .maybeSingle();
    if (defaultResult.error) return fail(500, 'No se pudo validar la caja predeterminada.');
    defaultRegister = defaultResult.data;
  }
  if (register.isActive && register.isDefault && defaultRegister && defaultRegister.id !== existing?.id) {
    return fail(409, 'La sucursal ya tiene otra caja predeterminada activa.');
  }

  const isDefault = !register.isActive
    ? false
    : !defaultRegister || defaultRegister.id === existing?.id || register.isDefault;
  const registerRow = {
    tenant_id: tenantId,
    branch_id: branch.id,
    name: register.name,
    terminal_code: register.terminalCode,
    allows_billing: register.allowsBilling,
    allows_ordering: register.allowsOrdering,
    is_active: register.isActive,
    is_default: isDefault,
    linked_zones: register.linkedZones,
    assigned_printer_id: register.assignedPrinterId,
    notes: register.notes,
    legacy_id: register.legacyId,
    source_device_key: register.sourceDeviceKey
  };

  const saved = existing
    ? await admin.from('pos_cash_registers')
        .update(registerRow)
        .eq('tenant_id', tenantId)
        .eq('id', existing.id)
        .select(REGISTER_COLUMNS)
        .single()
    : await admin.from('pos_cash_registers')
        .insert(registerRow)
        .select(REGISTER_COLUMNS)
        .single();

  if (saved.error || !saved.data) {
    if (isUniqueViolation(saved.error)) {
      existingResult = await findRegister(admin, tenantId, branch.id, register.legacyId, register.terminalCode);
      if (!existingResult.error && existingResult.data?.legacy_id === register.legacyId && !overwriteExisting) {
        return { status: 200, body: { success: true, branch, register: existingResult.data, created: false, updated: false, alreadyExists: true } };
      }
      return fail(409, 'La sucursal o la caja ya fueron creadas en otra solicitud. Actualiza la lista y vuelve a intentar.');
    }
    return fail(500, 'No se pudo guardar la caja del restaurante.');
  }

  return {
    status: 200,
    body: {
      success: true,
      branch,
      register: saved.data,
      created: !existing,
      updated: Boolean(existing),
      alreadyExists: false
    }
  };
}
