import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../_utils/supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from '../_utils/security.js';
import { ROLE_PERMISSIONS } from '../_utils/rolePermissions.js';
import { employeeSessionActorMatches } from '../_utils/employeeSession.js';
import { recordEmployeeCreditTransaction } from '../_utils/employeeCredit.js';
import { handleEmployeeCreditRequest } from '../_utils/employeeCreditEndpoint.js';
import { parseFiscalInvoiceIssuedAt } from '../_utils/fiscalInvoiceIssuedAt.js';
import { sanitizeFiscalInvoiceData } from '../../src/utils/fiscalInvoiceItems.js';
import { cloudMenuItemId } from '../_utils/inventoryIds.js';
import { adjustInventoryStock, loadInventoryConfig, saveInventoryConfig } from '../_utils/inventorySync.js';
import { assertCashRegisterOpenForPayment, assignCashTerminal, closeCashShift, closeDailyCash, closeDailyCashV2Aware, DailyCashClosedError, DailyCashNotOpenError, getDailyCashStatus, importCashShift, openDailyCash, reassignCashTerminal } from '../_utils/cashControlSync.js';
import { CASH_SHIFT_V2_ENABLED } from '../../src/services/cashShiftV2Contract.ts';
import { CashShiftV2ServiceError, dispatchCashShiftV2AwareWrite, executeCashShiftV2Operation, isCashShiftV2RoutingEnabled, type CashShiftV2WriteMode } from '../_utils/cashShiftV2Service.js';
import { isCashShiftV2DailyCloseEnabled } from '../_utils/cashShiftV2DailyClose.js';
import { createCashShiftV2Repository } from '../_utils/cashShiftV2Repository.js';
const SUPPORTED_ACTIONS = new Set(['UPDATE_TABLE', 'TRANSFER_TABLE_ACCOUNT', 'PAYMENT', 'DEDUCT_INVENTORY', 'DISPATCH_INVENTORY', 'SAVE_INVENTORY_CONFIG', 'LOAD_INVENTORY_CONFIG', 'ADJUST_INVENTORY', 'EMIT_INVOICE', 'CLOSE_CASH_SHIFT', 'CLOSE_DAILY_CASH', 'GET_DAILY_CASH_STATUS', 'GET_CASH_SHIFT_V2_MODE', 'OPEN_DAILY_CASH', 'IMPORT_CASH_SHIFT', 'ASSIGN_CASH_TERMINAL', 'REASSIGN_CASH_TERMINAL']);

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type OperationalScope = {
  branchId: string | null;
  cashRegisterId: string | null;
  cashShiftId: string | null;
  terminalId: string | null;
};

function readOperationalScope(payload: any): OperationalScope {
  const source = payload && typeof payload === 'object' ? payload : {};
  const read = (value: unknown, label: string) => {
    if (value === undefined || value === null || value === '') return null;
    if (!isUuid(value)) throw new Error(`${label} no tiene un UUID válido.`);
    return value;
  };
  return {
    branchId: read(source.branchId, 'branchId'),
    cashRegisterId: read(source.cashRegisterId, 'cashRegisterId'),
    cashShiftId: read(source.cashShiftId, 'cashShiftId'),
    terminalId: read(source.terminalId, 'terminalId')
  };
}

function safeStatus(value: unknown): 'AVAILABLE' | 'OCCUPIED' | 'PRE_CHECK' | 'RESERVED' {
  return value === 'OCCUPIED' || value === 'PRE_CHECK' || value === 'RESERVED' ? value : 'AVAILABLE';
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function findBranch(tenantId: string, branchId?: string | null) {
  let query = supabaseAdmin
    .from('pos_branches')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);
  if (branchId) query = query.eq('id', branchId);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error('No se pudo localizar una sucursal operativa.');
  return data;
}

const BRANCH_ROUTED_WRITES = new Set([
  'UPDATE_TABLE', 'TRANSFER_TABLE_ACCOUNT', 'PAYMENT', 'EMIT_INVOICE', 'CLOSE_CASH_SHIFT', 'IMPORT_CASH_SHIFT'
]);
const BRANCH_MODES = new Set(['OFF', 'PREPARED', 'ACTIVE', 'QUIESCING', 'FROZEN']);

async function verifiedBranchId(tenantId: string, branchId: unknown): Promise<string> {
  if (!isUuid(branchId)) throw new CashShiftV2ServiceError(409, 'BRANCH_SCOPE_REQUIRED', 'No se pudo derivar una sucursal válida para la operación.');
  const { data, error } = await supabaseAdmin.from('pos_branches')
    .select('id').eq('tenant_id', tenantId).eq('id', branchId).eq('is_active', true).maybeSingle();
  if (error) throw new CashShiftV2ServiceError(503, 'BRANCH_SCOPE_UNAVAILABLE', 'No se pudo verificar la sucursal; la operación fue bloqueada.');
  if (!data) throw new CashShiftV2ServiceError(404, 'BRANCH_NOT_AVAILABLE', 'La sucursal de la operación no está disponible.');
  return data.id;
}

async function resolveBranchForRoutedWrite(tenantId: string, action: string, payload: any): Promise<string> {
  if (action === 'UPDATE_TABLE') {
    const scope = readOperationalScope(payload);
    const table = payload && typeof payload === 'object' ? payload : {};
    let storedBranchId: string | null = null;
    if (isUuid(table.id)) {
      const lookup = await supabaseAdmin.from('pos_tables').select('branch_id')
        .eq('tenant_id', tenantId).eq('id', table.id).maybeSingle();
      if (lookup.error) throw new CashShiftV2ServiceError(503, 'TABLE_SCOPE_UNAVAILABLE', 'No se pudo derivar la sucursal de la mesa; la operación fue bloqueada.');
      storedBranchId = lookup.data?.branch_id || null;
    }
    if (!storedBranchId && Number.isInteger(table.number)) {
      const lookup = await supabaseAdmin.from('pos_tables').select('branch_id')
        .eq('tenant_id', tenantId).eq('table_number', table.number).limit(2);
      if (lookup.error) throw new CashShiftV2ServiceError(503, 'TABLE_SCOPE_UNAVAILABLE', 'No se pudo derivar la sucursal de la mesa; la operación fue bloqueada.');
      const branches = [...new Set((lookup.data || []).map((row: any) => row.branch_id).filter(isUuid))];
      if (branches.length > 1) throw new CashShiftV2ServiceError(409, 'BRANCH_SCOPE_AMBIGUOUS', 'El número de mesa existe en varias sucursales; la operación fue bloqueada.');
      storedBranchId = branches[0] || null;
    }
    if (scope.branchId && storedBranchId && scope.branchId !== storedBranchId) {
      throw new CashShiftV2ServiceError(409, 'TABLE_BRANCH_MISMATCH', 'La mesa no pertenece a la sucursal indicada.');
    }
    const resolved = storedBranchId || scope.branchId;
    if (resolved) return verifiedBranchId(tenantId, resolved);
    const candidates = await supabaseAdmin.from('pos_branches').select('id')
      .eq('tenant_id', tenantId).eq('is_active', true).limit(2);
    if (candidates.error) throw new CashShiftV2ServiceError(503, 'BRANCH_SCOPE_UNAVAILABLE', 'No se pudo derivar la sucursal; la operación fue bloqueada.');
    if (candidates.data?.length === 1) return candidates.data[0].id;
    throw new CashShiftV2ServiceError(409, 'BRANCH_SCOPE_REQUIRED', 'La operación no identifica una sucursal única; no se permite continuar ni usar fallback legacy.');
  }

  if (action === 'PAYMENT' || action === 'TRANSFER_TABLE_ACCOUNT' || action === 'EMIT_INVOICE') {
    const order = await findOrder(tenantId, payload?.orderNumber);
    return verifiedBranchId(tenantId, order.branchId);
  }

  if (action === 'CLOSE_CASH_SHIFT') {
    if (!isUuid(payload?.shiftId)) throw new CashShiftV2ServiceError(400, 'SHIFT_SCOPE_REQUIRED', 'El cierre requiere un turno remoto verificable.');
    const lookup = await supabaseAdmin.from('pos_cash_shifts').select('branch_id')
      .eq('tenant_id', tenantId).eq('id', payload.shiftId).maybeSingle();
    if (lookup.error) throw new CashShiftV2ServiceError(503, 'SHIFT_SCOPE_UNAVAILABLE', 'No se pudo verificar la sucursal del turno; el cierre fue bloqueado.');
    if (!lookup.data?.branch_id) throw new CashShiftV2ServiceError(404, 'SHIFT_NOT_FOUND', 'No se encontró el turno remoto para cerrar.');
    return verifiedBranchId(tenantId, lookup.data.branch_id);
  }

  if (action === 'IMPORT_CASH_SHIFT') {
    if (!isUuid(payload?.cashRegisterId)) throw new CashShiftV2ServiceError(400, 'REGISTER_SCOPE_REQUIRED', 'La importación requiere una caja remota verificable.');
    const lookup = await supabaseAdmin.from('pos_cash_registers').select('branch_id')
      .eq('tenant_id', tenantId).eq('id', payload.cashRegisterId).maybeSingle();
    if (lookup.error) throw new CashShiftV2ServiceError(503, 'REGISTER_SCOPE_UNAVAILABLE', 'No se pudo verificar la sucursal de la caja; la importación fue bloqueada.');
    if (!lookup.data?.branch_id) throw new CashShiftV2ServiceError(404, 'REGISTER_NOT_FOUND', 'No se encontró la caja de la importación.');
    return verifiedBranchId(tenantId, lookup.data.branch_id);
  }

  throw new CashShiftV2ServiceError(400, 'UNSUPPORTED_OPERATION', 'La operación no usa un escritor V2 por sucursal.');
}

async function readCashShiftV2Mode(tenantId: string, branchId: string): Promise<CashShiftV2WriteMode> {
  if (!isCashShiftV2RoutingEnabled(CASH_SHIFT_V2_ENABLED, process.env.POS_CASH_SHIFT_V2_ENABLED)) {
    throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_DISABLED', 'La lectura del modo V2 está deshabilitada.');
  }
  const { data, error } = await supabaseAdmin.from('pos_cash_v2_branch_controls')
    .select('state').eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
  if (error) throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_MODE_UNAVAILABLE', 'No se pudo comprobar el modo de la sucursal; la operación fue bloqueada.');
  if (!data) return null;
  if (!BRANCH_MODES.has(data.state)) throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_MODE_UNKNOWN', 'El modo V2 de la sucursal no es válido; la operación fue bloqueada.');
  return data.state as CashShiftV2WriteMode;
}

async function readCashShiftV2ModeForRegister(tenantId: string, payload: any) {
  if (!isUuid(payload?.branchId) || !isUuid(payload?.cashRegisterId)) {
    throw new CashShiftV2ServiceError(400, 'BRANCH_REGISTER_SCOPE_REQUIRED', 'La consulta de modo requiere UUID de sucursal y caja remota.');
  }
  const branchId = await verifiedBranchId(tenantId, payload.branchId);
  const { data, error } = await supabaseAdmin.from('pos_cash_registers').select('id')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', payload.cashRegisterId).eq('is_active', true).maybeSingle();
  if (error) throw new CashShiftV2ServiceError(503, 'REGISTER_SCOPE_UNAVAILABLE', 'No se pudo verificar la caja de la sucursal; la apertura fue bloqueada.');
  if (!data) throw new CashShiftV2ServiceError(404, 'REGISTER_NOT_AVAILABLE', 'La caja remota no pertenece a la sucursal activa indicada.');
  const state = isCashShiftV2RoutingEnabled(CASH_SHIFT_V2_ENABLED, process.env.POS_CASH_SHIFT_V2_ENABLED)
    ? await readCashShiftV2Mode(tenantId, branchId)
    : 'OFF';
  if (!state) throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_MODE_UNAVAILABLE', 'La sucursal no tiene un modo V2 verificable; la apertura fue bloqueada.');
  return { tenantId, branchId, cashRegisterId: data.id, state };
}

async function executeOfflineV2Write(
  action: string,
  tenantId: string,
  branchId: string,
  userId: string,
  employeeId: string | undefined,
  role: string | undefined,
  operationId: string,
  payload: any
): Promise<unknown> {
  if (action === 'TRANSFER_TABLE_ACCOUNT') {
    throw new CashShiftV2ServiceError(503, 'V2_TRANSFER_NOT_READY', 'El traslado no tiene una RPC V2 atómica; no se aplicó la ruta legacy.');
  }
  if (action === 'PAYMENT') {
    throw new CashShiftV2ServiceError(503, 'V2_PAYMENT_MIRROR_NOT_READY', 'El RPC de pago no sincroniza de forma atómica el estado legacy de orden/mesa; el cobro V2 permanece desconectado.');
  }
  if (action === 'EMIT_INVOICE') {
    throw new CashShiftV2ServiceError(503, 'V2_HACIENDA_NOT_READY', 'La emisión Hacienda no reutiliza aún los totales V2 exactos; no se recalculó ni se usó el writer legacy.');
  }
  if (action === 'IMPORT_CASH_SHIFT') {
    throw new CashShiftV2ServiceError(503, 'V2_OFFLINE_SHIFT_IMPORT_NOT_READY', 'Un turno abierto offline no puede convertirse sin pérdida de fecha, atribución e idempotencia a una sesión V2.');
  }
  if (action === 'UPDATE_TABLE' && !payload?.activeOrder) {
    throw new CashShiftV2ServiceError(503, 'V2_TABLE_WRITE_NOT_READY', 'El cambio de diseño/estado de mesa sin orden requiere un contrato V2 propio.');
  }

  const operation = action === 'UPDATE_TABLE' ? 'SYNC_ORDER' : action === 'CLOSE_CASH_SHIFT' ? 'CLOSE_SHIFT' : null;
  const contract = payload?.cashShiftV2;
  if (!operation || !contract || typeof contract !== 'object' || Array.isArray(contract)
    || Object.keys(contract).some(key => key !== 'cashRegisterId' && key !== 'payload')
    || !isUuid(contract.cashRegisterId) || !contract.payload || typeof contract.payload !== 'object' || Array.isArray(contract.payload)) {
    throw new CashShiftV2ServiceError(503, 'V2_COMMAND_REQUIRED', 'La operación no contiene el comando canónico V2; no se aplicó fallback legacy.');
  }

  try {
    return await executeCashShiftV2Operation(
      { userId, tenantId, ...(employeeId ? { employeeId } : {}), ...(employeeId && role ? { role } : {}) },
      { action: operation, branchId, cashRegisterId: contract.cashRegisterId, idempotencyKey: operationId, payload: contract.payload },
      createCashShiftV2Repository(supabaseAdmin)
    );
  } catch (error) {
    if (error instanceof CashShiftV2ServiceError) throw error;
    throw new CashShiftV2ServiceError(503, 'CASH_SHIFT_V2_UNAVAILABLE', 'La operación V2 no está disponible; no se aplicó fallback legacy.');
  }
}

async function syncTable(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const table = payload && typeof payload === 'object' ? payload : null;
  if (!table || !table.name) throw new Error('El payload de la mesa es inválido.');

  const branch = await findBranch(tenantId, scope.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para este restaurante.');

  let existingTable: { id: string } | null = null;
  if (isUuid(table.id)) {
    const result = await supabaseAdmin
      .from('pos_tables')
      .select('id')
      .eq('id', table.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    existingTable = result.data;
  }
  if (!existingTable && Number.isInteger(table.number)) {
    const result = await supabaseAdmin
      .from('pos_tables')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branch.id)
      .eq('table_number', table.number)
      .maybeSingle();
    existingTable = result.data;
  }

  const tableRow: Record<string, unknown> = {
    tenant_id: tenantId,
    branch_id: branch.id,
    name: String(table.name).slice(0, 120),
    table_number: Number.isInteger(table.number) ? table.number : null,
    zone: typeof table.zone === 'string' && table.zone.trim() ? table.zone.trim().slice(0, 120) : 'Principal',
    seats: Math.max(1, Math.floor(safeNumber(table.seats, 2))),
    status: safeStatus(table.status),
    position: {
      x: safeNumber(table.x, 0),
      y: safeNumber(table.y, 0),
      rotation: safeNumber(table.rotation, 0),
      shape: table.shape === 'round' || table.shape === 'bar' ? table.shape : 'square'
    },
    updated_at: new Date().toISOString()
  };

  if (existingTable) tableRow.id = existingTable.id;
  const tableResult = await supabaseAdmin.from('pos_tables').upsert(tableRow, { onConflict: 'id' }).select('id').single();
  if (tableResult.error || !tableResult.data) throw new Error('No se pudo guardar la mesa en la nube.');

  const activeOrder = table.activeOrder;
  let orderId: string | null = null;
  if (activeOrder && typeof activeOrder.orderNumber === 'string' && activeOrder.orderNumber.trim()) {
    const orderKey = `order:${tenantId}:${activeOrder.orderNumber.trim()}`;
    const existingOrder = await supabaseAdmin
      .from('pos_orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', orderKey)
      .maybeSingle();

    if (existingOrder.data) {
      orderId = existingOrder.data.id;
      const updateResult = await supabaseAdmin
        .from('pos_orders')
        .update({
          branch_id: branch.id,
          ...(scope.cashShiftId ? { cash_shift_id: scope.cashShiftId } : {}),
          table_id: tableResult.data.id,
          server_name: typeof activeOrder.server === 'string' ? activeOrder.server.slice(0, 120) : null,
          status: 'OPEN'
        })
        .eq('id', orderId)
        .eq('tenant_id', tenantId);
      if (updateResult.error) throw new Error('No se pudo actualizar la orden en la nube.');
      const deleteItemsResult = await supabaseAdmin
        .from('pos_order_items')
        .delete()
        .eq('order_id', orderId)
        .eq('tenant_id', tenantId);
      if (deleteItemsResult.error) throw new Error('No se pudieron actualizar los artículos de la orden.');
    } else {
      const orderResult = await supabaseAdmin
        .from('pos_orders')
        .insert({
          tenant_id: tenantId,
          branch_id: branch.id,
          cash_shift_id: scope.cashShiftId,
          table_id: tableResult.data.id,
          order_number: activeOrder.orderNumber.trim().slice(0, 80),
          status: 'OPEN',
          service_type: String(table.id || '').startsWith('takeaway_') ? 'TAKEAWAY' : 'DINE_IN',
          opened_by: userId,
          server_name: typeof activeOrder.server === 'string' ? activeOrder.server.slice(0, 120) : null,
          opened_at: activeOrder.openedAt || new Date().toISOString(),
          idempotency_key: orderKey
        })
        .select('id')
        .single();
      if (orderResult.error || !orderResult.data) throw new Error('No se pudo guardar la orden en la nube.');
      orderId = orderResult.data.id;

    }
    const items = Array.isArray(activeOrder.items) ? activeOrder.items : [];
    if (items.length > 0) {
      const candidateMenuIds = [...new Set(
        items
          .filter((item: any) => typeof item.menuItemId === 'string' && item.menuItemId.trim())
          .map((item: any) => cloudMenuItemId(tenantId, branch.id, item.menuItemId.trim().slice(0, 200)))
      )];
      const existingMenuIds = new Set<string>();
      if (candidateMenuIds.length > 0) {
        const menuResult = await supabaseAdmin.from('pos_menu_items').select('id')
          .eq('tenant_id', tenantId).eq('branch_id', branch.id).in('id', candidateMenuIds);
        if (menuResult.error) throw new Error('No se pudo verificar el catálogo de productos de la orden.');
        for (const row of menuResult.data || []) existingMenuIds.add(row.id);
      }
      const itemRows = items.map((item: any) => ({
        tenant_id: tenantId,
        order_id: orderId,
        menu_item_id: typeof item.menuItemId === 'string' && item.menuItemId.trim()
          ? (existingMenuIds.has(cloudMenuItemId(tenantId, branch.id, item.menuItemId.trim().slice(0, 200)))
            ? cloudMenuItemId(tenantId, branch.id, item.menuItemId.trim().slice(0, 200))
            : null)
          : (isUuid(item.id) ? item.id : null),
        name_snapshot: String(item.name || 'Producto').slice(0, 200),
        quantity: Math.max(0.001, safeNumber(item.quantity, 1)),
        unit_price: Math.max(0, safeNumber(item.price, 0)),
        tax_rate: Math.max(0, safeNumber(item.taxRate, 0.13)),
        modifiers: Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [],
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : null,
        station: item.category === 'Bar' ? 'Bar' : item.category === 'Postres' ? 'Postres' : 'Cocina',
        kds_status: item.kdsStatus || 'PENDING'
      }));
      const itemResult = await supabaseAdmin.from('pos_order_items').insert(itemRows);
      if (itemResult.error) throw new Error('No se pudieron guardar los artículos de la orden.');
    }
  }

  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'OFFLINE_SYNC',
    actor_employee_id: employeeId || null,
    entity_type: 'TABLE',
    entity_id: tableResult.data.id,
    request_id: operationId,
    metadata: { orderId, tableNumber: table.number, source: 'pwa' }
  });

  return { tableId: tableResult.data.id, orderId };
}

function rejectedTableAccountTransfer(message: string) {
  return Object.assign(new Error(message), { code: 'TABLE_ACCOUNT_TRANSFER_REJECTED' });
}

function readTransferTableSnapshot(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw rejectedTableAccountTransfer(`${label} es inválida.`);
  const table = value as Record<string, unknown>;
  const id = typeof table.id === 'string' ? table.id.trim() : '';
  const name = typeof table.name === 'string' ? table.name.trim() : '';
  const zone = typeof table.zone === 'string' ? table.zone.trim() : '';
  if (!id || id.length > 160 || !name || name.length > 120 || !zone || zone.length > 120
    || !Number.isInteger(table.number) || Number(table.number) < 1
    || !Number.isInteger(table.seats) || Number(table.seats) < 1) {
    throw rejectedTableAccountTransfer(`${label} no tiene datos válidos.`);
  }
  const shape = table.shape === 'round' || table.shape === 'bar' ? table.shape : 'square';
  return {
    id,
    number: Number(table.number),
    name,
    zone,
    seats: Math.min(50, Number(table.seats)),
    shape,
    x: Math.max(0, Math.min(100, safeNumber(table.x, 0))),
    y: Math.max(0, Math.min(100, safeNumber(table.y, 0))),
    rotation: safeNumber(table.rotation, 0)
  };
}

async function syncTableAccountTransfer(
  tenantId: string,
  userId: string,
  employeeId: string | undefined,
  operationId: string,
  payload: any
) {
  const branchCode = typeof payload?.branchCode === 'string' ? payload.branchCode.trim() : '';
  const orderNumber = typeof payload?.orderNumber === 'string' ? payload.orderNumber.trim() : '';
  if (!/^\d{3}$/.test(branchCode) || !orderNumber || orderNumber.length > 80) {
    throw rejectedTableAccountTransfer('La sucursal o la cuenta de origen no es válida.');
  }
  const sourceTable = readTransferTableSnapshot(payload?.sourceTable, 'La mesa origen');
  const destinationTable = readTransferTableSnapshot(payload?.destinationTable, 'La mesa destino');
  if (sourceTable.id === destinationTable.id) throw rejectedTableAccountTransfer('El destino debe ser una mesa distinta.');

  const { data, error } = await supabaseAdmin.rpc('transfer_pos_table_account', {
    p_tenant_id: tenantId,
    p_operation_id: operationId,
    p_actor_user_id: userId,
    p_actor_employee_id: employeeId || null,
    p_order_number: orderNumber,
    p_branch_code: branchCode,
    p_source_table: sourceTable,
    p_destination_table: destinationTable
  });
  if (error) {
    const code = ['22023', 'P0001', '23505', '40001'].includes(error.code || '')
      ? 'TABLE_ACCOUNT_TRANSFER_REJECTED'
      : error.code === 'PGRST202' ? 'TABLE_ACCOUNT_TRANSFER_NOT_READY' : undefined;
    const transferError = new Error(code === 'TABLE_ACCOUNT_TRANSFER_REJECTED'
      ? (error.message || 'La cuenta o la mesa destino cambiaron; el traslado no se aplicó.')
      : code === 'TABLE_ACCOUNT_TRANSFER_NOT_READY'
        ? 'El traslado de cuenta todavía no está habilitado en la base de datos.'
        : 'No se pudo confirmar el traslado de la cuenta en la nube.');
    if (code) Object.assign(transferError, { code });
    throw transferError;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('La nube no confirmó el traslado de la cuenta.');
  return data;
}

async function syncEmployeeCredit(tenantId: string, userId: string, operationId: string, orderId: string, orderNumber: string, payload: any, amount: number) {
  const employeeCredit = payload?.employeeCredit;
  if (!employeeCredit || typeof employeeCredit !== 'object') return;
  const employeeId = typeof employeeCredit.employeeId === 'string' ? employeeCredit.employeeId : '';
  const idempotencyKey = typeof employeeCredit.idempotencyKey === 'string'
    ? employeeCredit.idempotencyKey
    : `credit:${operationId}`;
  if (!employeeId || amount <= 0) throw new Error('La comanda ejecutiva no tiene un colaborador válido.');

  await recordEmployeeCreditTransaction(supabaseAdmin, {
    tenantId,
    employeeId,
    type: 'CHARGE',
    amount,
    idempotencyKey,
    orderId,
    reference: orderNumber,
    createdBy: userId
  });
}

function readCashControlId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} tiene un formato inválido.`);
  }
  return value;
}

async function resolveCashRegister(tenantId: string, identifier: string) {
  let query = supabaseAdmin.from('pos_cash_registers')
    .select('id, branch_id, name')
    .eq('tenant_id', tenantId);
  query = isUuid(identifier) ? query.eq('id', identifier) : query.eq('legacy_id', identifier);
  const result = await query.limit(1).maybeSingle();
  if (result.error || !result.data) throw new Error('No se encontró la caja asociada al cobro.');
  return result.data as { id: string; branch_id: string; name: string };
}

async function resolvePaymentShift(
  tenantId: string,
  registerId: string,
  identifier: string | null,
  paidAt: string
) {
  let query = supabaseAdmin.from('pos_cash_shifts')
    .select('id, branch_id, cash_register_id, status, opened_at, closed_at')
    .eq('tenant_id', tenantId)
    .eq('cash_register_id', registerId);
  if (identifier) {
    query = isUuid(identifier) ? query.eq('id', identifier) : query.eq('legacy_id', identifier);
  } else {
    query = query.eq('status', 'OPEN').order('opened_at', { ascending: false });
  }
  const result = await query.limit(1).maybeSingle();
  const shift = result.data as {
    id: string; branch_id: string; cash_register_id: string; status: string; opened_at: string; closed_at: string | null;
  } | null;
  if (result.error || !shift) throw new Error('No se encontró un turno para la caja al momento del cobro.');
  const paidTimestamp = Date.parse(paidAt);
  const openedTimestamp = Date.parse(shift.opened_at);
  const closedTimestamp = shift.closed_at ? Date.parse(shift.closed_at) : Number.POSITIVE_INFINITY;
  if (shift.status !== 'OPEN' && shift.status !== 'CLOSED') throw new Error('El turno asociado al cobro no es válido.');
  if (!Number.isFinite(paidTimestamp) || paidTimestamp < openedTimestamp || paidTimestamp >= closedTimestamp) {
    throw new Error('El cobro ocurrió fuera del intervalo del turno seleccionado.');
  }
  return shift;
}

async function syncPayment(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const orderNumber = typeof payload?.orderNumber === 'string' ? payload.orderNumber.trim() : '';
  const payments = Array.isArray(payload?.payments) ? payload.payments : [];
  if (!orderNumber || payments.length === 0) throw new Error('El pago no contiene una orden y un desglose válido.');

  const orderResult = await supabaseAdmin
    .from('pos_orders')
    .select('id, branch_id, status')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', `order:${tenantId}:${orderNumber}`)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) {
    throw new Error('La orden aún no existe en la nube; se reintentará después de sincronizar la comanda.');
  }
  const orderId = orderResult.data.id;

  const allowedMethods = new Set(['CASH', 'CARD', 'SINPE', 'MIXED', 'CREDIT']);
  const preparedPayments = payments.map((payment: any, index: number) => ({
    payment,
    index,
    amount: safeNumber(payment?.amount, 0),
    method: allowedMethods.has(payment?.method) ? payment.method : 'CASH',
    idempotencyKey: `${operationId}:${index}`
  })).filter((item: any) => item.amount > 0);
  if (preparedPayments.length === 0) throw new Error('El pago no contiene montos positivos válidos.');

  const existingPayments = new Map<string, any>();
  for (const item of preparedPayments) {
    const existing = await supabaseAdmin.from('pos_payments')
      .select('id, order_id, cash_shift_id, paid_at, amount, method')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', item.idempotencyKey)
      .maybeSingle();
    if (existing.error) throw new Error('No se pudo verificar si el cobro ya se había registrado.');
    if (existing.data) {
      if (existing.data.order_id !== orderResult.data.id
        || Number(existing.data.amount) !== item.amount
        || existing.data.method !== item.method) {
        throw new Error('La clave de este cobro ya está asociada a una operación distinta; contacte al administrador.');
      }
      existingPayments.set(item.idempotencyKey, existing.data);
    }
  }

  // Si todos los renglones ya existen, es un reintento idempotente: nunca debe
  // fallar por un cierre diario posterior ni volver a insertar/cargar el pago.
  if (existingPayments.size === preparedPayments.length) {
    const firstExisting = existingPayments.get(preparedPayments[0].idempotencyKey);
    for (const item of preparedPayments) {
      const existing = existingPayments.get(item.idempotencyKey);
      if (existing.cash_shift_id !== firstExisting.cash_shift_id
        || existing.paid_at !== firstExisting.paid_at) {
        throw new Error('Los renglones del cobro idempotente tienen alcances distintos; contacte al administrador.');
      }
    }
    let existingCashRegisterId: string | null = null;
    if (firstExisting.cash_shift_id) {
      const shiftLookup = await supabaseAdmin.from('pos_cash_shifts')
        .select('cash_register_id')
        .eq('tenant_id', tenantId)
        .eq('id', firstExisting.cash_shift_id)
        .maybeSingle();
      if (!shiftLookup.error) existingCashRegisterId = shiftLookup.data?.cash_register_id || null;
    }
    const creditAmount = preparedPayments
      .filter((item: any) => item.method === 'CREDIT')
      .reduce((total: number, item: any) => total + item.amount, 0);
    if (creditAmount > 0) await syncEmployeeCredit(tenantId, userId, operationId, orderResult.data.id, orderNumber, payload, creditAmount);
    if (payload?.closeOrder === true && orderResult.data.status !== 'CLOSED') {
      const closeResult = await supabaseAdmin.from('pos_orders')
        .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
        .eq('id', orderResult.data.id)
        .eq('tenant_id', tenantId);
      if (closeResult.error) throw new Error('No se pudo completar el cierre de la orden ya cobrada.');
    }
    const paymentIds = preparedPayments.map((item: any) => existingPayments.get(item.idempotencyKey).id);
    await supabaseAdmin.from('pos_audit_events').insert({
      tenant_id: tenantId,
      actor_user_id: userId,
      action: 'OFFLINE_SYNC',
      actor_employee_id: employeeId || null,
      entity_type: 'PAYMENT',
      entity_id: orderResult.data.id,
      request_id: operationId,
      metadata: { paymentIds, orderNumber, status: 'PENDING', source: 'pwa', alreadyApplied: true }
    });
    return {
      orderId: orderResult.data.id,
      paymentIds,
      cashRegisterId: existingCashRegisterId,
      cashShiftId: firstExisting.cash_shift_id,
      paidAt: firstExisting.paid_at,
      status: 'PENDING',
      alreadyApplied: true
    };
  }

  let priorCashShiftId: string | null = null;
  let priorCashRegisterId: string | null = null;
  let priorPaidAt: string | null = null;
  if (existingPayments.size > 0) {
    const firstExisting = existingPayments.values().next().value;
    for (const existing of existingPayments.values()) {
      if (existing.cash_shift_id !== firstExisting.cash_shift_id || existing.paid_at !== firstExisting.paid_at) {
        throw new Error('Los renglones ya registrados de este cobro tienen alcances distintos; contacte al administrador.');
      }
    }
    if (!firstExisting.cash_shift_id || !firstExisting.paid_at) {
      throw new Error('Hay un renglón de este cobro ya registrado sin turno o fecha verificables; no se reasignó. Contacte al administrador.');
    }
    priorCashShiftId = firstExisting.cash_shift_id;
    priorPaidAt = firstExisting.paid_at;
    const priorShift = await supabaseAdmin.from('pos_cash_shifts')
      .select('cash_register_id')
      .eq('tenant_id', tenantId)
      .eq('id', priorCashShiftId)
      .maybeSingle();
    if (priorShift.error || !priorShift.data?.cash_register_id) {
      throw new Error('No se pudo verificar la caja original del cobro parcialmente aplicado; no se reasignó. Contacte al administrador.');
    }
    priorCashRegisterId = priorShift.data.cash_register_id;
  }

  const registerIdentifier = readCashControlId(priorCashRegisterId || payload?.cashRegisterId, 'La caja');
  if (!registerIdentifier) throw new Error('El cobro requiere una caja registrada. Selecciona una caja y abre su turno.');
  const register = await resolveCashRegister(tenantId, registerIdentifier);
  const requestedShiftId = priorCashShiftId || readCashControlId(payload?.cashShiftId, 'El turno');
  const occurredAtValue = typeof payload?.occurredAt === 'string' ? payload.occurredAt : '';
  const occurredTimestamp = occurredAtValue ? Date.parse(occurredAtValue) : Number.NaN;
  if (!priorPaidAt && occurredAtValue && !Number.isFinite(occurredTimestamp)) throw new Error('La fecha del cobro es inválida.');
  if (!priorPaidAt && Number.isFinite(occurredTimestamp) && occurredTimestamp > Date.now() + 5 * 60 * 1000) {
    throw new Error('La fecha del cobro no puede estar en el futuro.');
  }
  const paidAt = priorPaidAt || (Number.isFinite(occurredTimestamp) ? new Date(occurredTimestamp).toISOString() : new Date().toISOString());

  // Se consulta antes de insertar el cobro. El trigger SQL vuelve a validar
  // dentro de la misma transacción para cerrar carreras con el cierre diario.
  if (existingPayments.size < preparedPayments.length) {
    await assertCashRegisterOpenForPayment(supabaseAdmin, tenantId, register.branch_id, register.id, register.name, paidAt);
  }

  const shift = await resolvePaymentShift(tenantId, register.id, requestedShiftId, paidAt);
  if (shift.branch_id !== register.branch_id) throw new Error('La caja y el turno no pertenecen a la misma sucursal.');

  const missingPaymentRows = preparedPayments
    .filter((item: any) => !existingPayments.has(item.idempotencyKey))
    .map((item: any) => ({
      tenant_id: tenantId,
      order_id: orderId,
      cash_shift_id: shift.id,
      amount: item.amount,
      method: item.method,
      provider: typeof item.payment?.provider === 'string' ? item.payment.provider.slice(0, 80) : 'POS_OFFLINE_SYNC',
      provider_transaction_id: typeof item.payment?.reference === 'string' ? item.payment.reference.slice(0, 160) : null,
      status: 'PENDING',
      paid_at: paidAt,
      idempotency_key: item.idempotencyKey
    }));
  const insertedByKey = new Map<string, string>();
  if (missingPaymentRows.length > 0) {
    // Un único INSERT mantiene atómicos los medios de pago mixtos. El trigger
    // bloquea la misma fila de caja durante toda la sentencia, así que el cierre
    // diario no puede quedar entre dos renglones de una venta.
    const paymentResult = await supabaseAdmin
      .from('pos_payments')
      .insert(missingPaymentRows)
      .select('id, idempotency_key');
    if (paymentResult.error || !paymentResult.data) {
      const dbMessage = typeof paymentResult.error?.message === 'string' ? paymentResult.error.message : '';
      const dailyClosedPrefix = 'DAILY_CASH_CLOSED|';
      if (dbMessage.startsWith(dailyClosedPrefix)) {
        throw new DailyCashClosedError(register.name, '', dbMessage.slice(dailyClosedPrefix.length));
      }
      const dailyNotOpenPrefix = 'DAILY_CASH_NOT_OPEN|';
      if (dbMessage.startsWith(dailyNotOpenPrefix)) {
        throw new DailyCashNotOpenError(register.name, '', dbMessage.slice(dailyNotOpenPrefix.length));
      }
      throw new Error('No se pudo registrar el pago pendiente.');
    }
    for (const row of paymentResult.data) {
      if (typeof row?.id === 'string' && typeof row?.idempotency_key === 'string') {
        insertedByKey.set(row.idempotency_key, row.id);
      }
    }
  }
  const inserted = preparedPayments.map((item: any) =>
    existingPayments.get(item.idempotencyKey)?.id || insertedByKey.get(item.idempotencyKey)
  );
  if (inserted.some((paymentId: unknown) => typeof paymentId !== 'string')) {
    throw new Error('No se pudieron confirmar todos los renglones del cobro; contacte al administrador.');
  }
  const paymentIds = inserted as string[];

  const creditAmount = payments
    .filter((payment: any) => payment?.method === 'CREDIT')
    .reduce((total: number, payment: any) => total + safeNumber(payment?.amount, 0), 0);
  if (creditAmount > 0) await syncEmployeeCredit(tenantId, userId, operationId, orderResult.data.id, orderNumber, payload, creditAmount);

  if (payload?.closeOrder === true) {
    const closeResult = await supabaseAdmin
      .from('pos_orders')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', orderResult.data.id)
      .eq('tenant_id', tenantId);
    if (closeResult.error) throw new Error('No se pudo cerrar la orden en la nube.');
  }

  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'OFFLINE_SYNC',
    actor_employee_id: employeeId || null,
    entity_type: 'PAYMENT',
    entity_id: orderResult.data.id,
    request_id: operationId,
    metadata: { paymentIds, orderNumber, status: 'PENDING', source: 'pwa' }
  });

  return { orderId: orderResult.data.id, paymentIds, cashRegisterId: register.id, cashShiftId: shift.id, paidAt, status: 'PENDING' };
}

async function findOrder(tenantId: string, orderNumber: unknown) {
  const normalizedOrderNumber = typeof orderNumber === 'string' ? orderNumber.trim() : '';
  if (!normalizedOrderNumber) throw new Error('La operación no contiene un número de orden válido.');
  const result = await supabaseAdmin
    .from('pos_orders')
    .select('id, branch_id')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', `order:${tenantId}:${normalizedOrderNumber}`)
    .maybeSingle();
  if (result.error || !result.data) throw new Error('La orden aún no existe en la nube; se reintentará después de sincronizar la comanda.');
  return { id: result.data.id, branchId: result.data.branch_id, orderNumber: normalizedOrderNumber };
}

async function syncInventory(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  readOperationalScope(payload);
  const order = await findOrder(tenantId, payload?.orderNumber);
  const items = Array.isArray(payload?.items)
    ? payload.items
      .filter((item: any) => item && typeof item.name === 'string' && safeNumber(item.quantity, 0) > 0)
      .map((item: any) => ({
        name: item.name.slice(0, 200),
        quantity: safeNumber(item.quantity, 0),
        menuItemId: typeof item.menuItemId === 'string' && item.menuItemId.trim()
          ? cloudMenuItemId(tenantId, order.branchId, item.menuItemId.trim().slice(0, 200))
          : null
      }))
    : [];
  if (items.length === 0) throw new Error('La operación de inventario no contiene artículos válidos.');

  const actorId = isUuid(userId) ? userId : null;
  const rpc = await supabaseAdmin.rpc('apply_offline_inventory', {
    p_tenant_id: tenantId,
    p_operation_id: operationId,
    p_created_by: actorId,
    p_order_id: order.id,
    p_items: items
  });
  if (rpc.error) throw new Error('No se pudo aplicar el descuento de inventario en la nube.');

  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'OFFLINE_SYNC',
    actor_employee_id: employeeId || null,
    entity_type: 'INVENTORY',
    entity_id: order.id,
    request_id: operationId,
    metadata: { ...rpc.data, orderNumber: order.orderNumber, source: 'pwa' }
  });
  return { orderId: order.id, ...rpc.data };
}

async function syncInventoryConfig(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const branch = await findBranch(tenantId, scope.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para este restaurante.');
  const result = await saveInventoryConfig(supabaseAdmin, tenantId, branch.id, payload);
  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'INVENTORY_CONFIG_SYNC',
    actor_employee_id: employeeId || null,
    entity_type: 'INVENTORY',
    entity_id: branch.id,
    request_id: operationId,
    metadata: { ...result, branchId: branch.id }
  });
  return { ...result, branchId: branch.id };
}

async function getInventoryConfig(tenantId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const branch = await findBranch(tenantId, scope.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para este restaurante.');
  return { ...(await loadInventoryConfig(supabaseAdmin, tenantId, branch.id, payload)), branchId: branch.id };
}

async function syncInventoryAdjustment(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const branch = await findBranch(tenantId, scope.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para este restaurante.');
  const result = await adjustInventoryStock(supabaseAdmin, tenantId, branch.id, userId, operationId, payload);
  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'INVENTORY_ADJUSTMENT',
    actor_employee_id: employeeId || null,
    entity_type: 'INVENTORY',
    entity_id: branch.id,
    request_id: operationId,
    metadata: { ...result, branchId: branch.id }
  });
  return { ...result, branchId: branch.id };
}

async function syncInvoice(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const order = await findOrder(tenantId, payload?.orderNumber);
  const clave = typeof payload?.clave === 'string' ? payload.clave.trim() : '';
  const consecutivo = typeof payload?.consecutivo === 'string' ? payload.consecutivo.trim() : '';
  if (!clave || !consecutivo) throw new Error('El comprobante offline no contiene clave y consecutivo.');
  if (!['FE', 'TE', 'NC', 'ND'].includes(payload?.documentType)) throw new Error('El tipo de comprobante offline no es válido.');

  if (scope.branchId && scope.branchId !== order.branchId) {
    throw new Error('La sucursal del comprobante no coincide con la sucursal de la orden.');
  }
  const branch = await findBranch(tenantId, scope.branchId || order.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para registrar el comprobante.');

  let linkedPaymentId: string | null = null;
  if (payload?.paymentId !== undefined && payload?.paymentId !== null && payload?.paymentId !== '') {
    if (!isUuid(payload.paymentId)) throw new Error('El payment_id del comprobante no es un UUID válido.');
    const payment = await supabaseAdmin.from('pos_payments')
      .select('id, order_id, cash_shift_id')
      .eq('tenant_id', tenantId)
      .eq('id', payload.paymentId)
      .maybeSingle();
    if (payment.error || !payment.data || payment.data.order_id !== order.id) {
      throw new Error('El payment_id del comprobante no corresponde a esta orden.');
    }
    if (payment.data.cash_shift_id) {
      const paymentShift = await supabaseAdmin.from('pos_cash_shifts')
        .select('branch_id')
        .eq('tenant_id', tenantId)
        .eq('id', payment.data.cash_shift_id)
        .maybeSingle();
      if (paymentShift.error || !paymentShift.data || paymentShift.data.branch_id !== branch.id) {
        throw new Error('El turno del pago no coincide con la sucursal del comprobante.');
      }
    }
    linkedPaymentId = payment.data.id;
  }

  const existing = await supabaseAdmin
    .from('pos_invoices')
    .select('id, hacienda_status')
    .eq('tenant_id', tenantId)
    .eq('clave', clave)
    .maybeSingle();
  if (existing.error) throw new Error('No se pudo verificar el comprobante offline.');
  if (existing.data) return { invoiceId: existing.data.id, status: existing.data.hacienda_status, alreadyExists: true };

  const invoice = await supabaseAdmin.from('pos_invoices').insert({
    tenant_id: tenantId,
    branch_id: branch.id,
    order_id: order.id,
    payment_id: linkedPaymentId,
    clave: clave.slice(0, 50),
    consecutivo: consecutivo.slice(0, 20),
    document_type: payload.documentType,
    hacienda_status: 'PENDING',
    total: Math.max(0, safeNumber(payload.total, 0)),
    issued_at: parseFiscalInvoiceIssuedAt(payload?.invoiceData?.fechaEmision),
    invoice_data: sanitizeFiscalInvoiceData(payload.invoiceData),
    xml_content: typeof payload.xmlContent === 'string' ? payload.xmlContent : null
  }).select('id, hacienda_status').single();
  if (invoice.error || !invoice.data) {
    const conflict = await supabaseAdmin
      .from('pos_invoices')
      .select('id, hacienda_status')
      .eq('tenant_id', tenantId)
      .eq('clave', clave)
      .maybeSingle();
    if (conflict.data) return { invoiceId: conflict.data.id, status: conflict.data.hacienda_status, alreadyExists: true };
    const consecutiveConflict = await supabaseAdmin
      .from('pos_invoices')
      .select('id, hacienda_status')
      .eq('tenant_id', tenantId)
      .eq('consecutivo', consecutivo)
      .maybeSingle();
    if (consecutiveConflict.data) {
      return {
        invoiceId: consecutiveConflict.data.id,
        status: consecutiveConflict.data.hacienda_status,
        alreadyExists: true
      };
    }
    throw new Error('No se pudo guardar el comprobante offline.');
  }

  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'OFFLINE_SYNC',
    actor_employee_id: employeeId || null,
    entity_type: 'INVOICE',
    entity_id: invoice.data.id,
    request_id: operationId,
    metadata: { orderNumber: order.orderNumber, clave, status: 'PENDING', source: 'pwa' }
  });
  return { invoiceId: invoice.data.id, status: invoice.data.hacienda_status, alreadyExists: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.action === 'employee-credit') return handleEmployeeCreditRequest(req, res);
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
  if (!SUPPORTED_ACTIONS.has(action)) {
    return res.status(422).json({ error: `La operación ${action || 'desconocida'} aún no está habilitada para sincronización.` });
  }
  if (!requireRole(auth, res, ROLE_PERMISSIONS.offlineSync[action as keyof typeof ROLE_PERMISSIONS.offlineSync])) return;

  const existingAudit = await supabaseAdmin
    .from('pos_audit_events')
    .select('id, metadata')
    .eq('tenant_id', tenantId)
    .eq('request_id', operationId)
    .limit(1)
    .maybeSingle();
  if (existingAudit.data) return res.status(200).json({ success: true, alreadyApplied: true, result: existingAudit.data.metadata });

  try {
    let result: unknown;
    let dailyCashAuditHandledAtomically = false;
    const runLegacyWriter = async (): Promise<unknown> => {
      if (action === 'TRANSFER_TABLE_ACCOUNT') return syncTableAccountTransfer(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'PAYMENT') return syncPayment(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'DEDUCT_INVENTORY' || action === 'DISPATCH_INVENTORY') return syncInventory(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'SAVE_INVENTORY_CONFIG') return syncInventoryConfig(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'LOAD_INVENTORY_CONFIG') return getInventoryConfig(tenantId, body.payload);
      if (action === 'ADJUST_INVENTORY') return syncInventoryAdjustment(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'EMIT_INVOICE') return syncInvoice(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
      if (action === 'CLOSE_CASH_SHIFT') return closeCashShift(supabaseAdmin, tenantId, auth.userId, body.payload);
      if (action === 'CLOSE_DAILY_CASH') {
        const dispatched = await closeDailyCashV2Aware(
          supabaseAdmin, tenantId, auth.userId, auth.employeeId, auth.role || '', body.payload,
          isCashShiftV2DailyCloseEnabled({
            globalEnabled: CASH_SHIFT_V2_ENABLED,
            routeEnabled: process.env.POS_CASH_SHIFT_V2_ENABLED,
            dailyAwareEnabled: process.env.POS_CASH_SHIFT_V2_DAILY_AWARE_ENABLED
          })
        );
        dailyCashAuditHandledAtomically = dispatched.auditHandledAtomically;
        return dispatched.result;
      }
      if (action === 'GET_DAILY_CASH_STATUS') return getDailyCashStatus(supabaseAdmin, tenantId, body.payload);
      if (action === 'GET_CASH_SHIFT_V2_MODE') return readCashShiftV2ModeForRegister(tenantId, body.payload);
      // The existing daily-opening RPC remains the approved, unchanged opening path.
      if (action === 'OPEN_DAILY_CASH') return openDailyCash(supabaseAdmin, tenantId, auth.employeeId || auth.userId, body.payload);
      if (action === 'IMPORT_CASH_SHIFT') return importCashShift(supabaseAdmin, tenantId, body.payload);
      if (action === 'ASSIGN_CASH_TERMINAL') return assignCashTerminal(supabaseAdmin, tenantId, body.payload);
      if (action === 'REASSIGN_CASH_TERMINAL') return reassignCashTerminal(supabaseAdmin, tenantId, body.payload);
      return syncTable(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
    };

    if (BRANCH_ROUTED_WRITES.has(action)
      && isCashShiftV2RoutingEnabled(CASH_SHIFT_V2_ENABLED, process.env.POS_CASH_SHIFT_V2_ENABLED)) {
      const branchId = await resolveBranchForRoutedWrite(tenantId, action, body.payload);
      const mode = await readCashShiftV2Mode(tenantId, branchId);
      const dispatched = await dispatchCashShiftV2AwareWrite({
        action,
        mode,
        v2Enabled: isCashShiftV2RoutingEnabled(CASH_SHIFT_V2_ENABLED, process.env.POS_CASH_SHIFT_V2_ENABLED),
        legacy: runLegacyWriter,
        v2: () => executeOfflineV2Write(action, tenantId, branchId, auth.userId, auth.employeeId, auth.role, operationId, body.payload)
      });
      result = dispatched.result;
    } else {
      result = await runLegacyWriter();
    }

    if ((action === 'CLOSE_CASH_SHIFT' || action === 'CLOSE_DAILY_CASH' || action === 'OPEN_DAILY_CASH' || action === 'IMPORT_CASH_SHIFT' || action === 'ASSIGN_CASH_TERMINAL' || action === 'REASSIGN_CASH_TERMINAL')
      && !(action === 'CLOSE_DAILY_CASH' && dailyCashAuditHandledAtomically)) {
      const details = result as Record<string, unknown>;
      const entityId = typeof details.terminalId === 'string'
        ? details.terminalId
        : typeof details.openingId === 'string' ? details.openingId
          : typeof details.closureId === 'string' ? details.closureId : details.shiftId;
      const audit = await supabaseAdmin.from('pos_audit_events').insert({
        tenant_id: tenantId,
        actor_user_id: auth.userId,
        action: 'OFFLINE_SYNC',
        actor_employee_id: auth.employeeId || null,
        entity_type: action === 'ASSIGN_CASH_TERMINAL' || action === 'REASSIGN_CASH_TERMINAL'
          ? 'CASH_TERMINAL'
          : action === 'OPEN_DAILY_CASH' ? 'DAILY_CASH_OPENING'
            : action === 'CLOSE_DAILY_CASH' ? 'DAILY_CASH_CLOSURE' : 'CASH_SHIFT',
        entity_id: entityId || null,
        request_id: operationId,
        metadata: { action, ...details }
      });
      if (audit.error) console.error('[Offline Sync] Cash control audit failed:', audit.error);
    }
    return res.status(200).json({ success: true, alreadyApplied: false, result });
  } catch (error: any) {
    console.error('[Offline Sync] Error:', error);
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 409;
    return res.status(status).json({
      error: error?.message || 'No se pudo aplicar la operación offline.',
      ...(typeof error?.code === 'string' ? { code: error.code } : {})
    });
  }
}
