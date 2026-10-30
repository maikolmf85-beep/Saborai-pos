import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../_utils/supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from '../_utils/security.js';
import { ROLE_PERMISSIONS } from '../_utils/rolePermissions.js';
import { employeeSessionActorMatches } from '../_utils/employeeSession.js';
import { recordEmployeeCreditTransaction } from '../_utils/employeeCredit.js';
import { handleEmployeeCreditRequest } from '../_utils/employeeCreditEndpoint.js';

const SUPPORTED_ACTIONS = new Set(['UPDATE_TABLE', 'PAYMENT', 'DEDUCT_INVENTORY', 'EMIT_INVOICE']);

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
          ...(scope.cashRegisterId ? { cash_register_id: scope.cashRegisterId } : {}),
          ...(scope.cashShiftId ? { cash_shift_id: scope.cashShiftId } : {}),
          ...(scope.terminalId ? { terminal_id: scope.terminalId } : {}),
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
          cash_register_id: scope.cashRegisterId,
          cash_shift_id: scope.cashShiftId,
          terminal_id: scope.terminalId,
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
      const itemRows = items.map((item: any) => ({
        tenant_id: tenantId,
        order_id: orderId,
        menu_item_id: isUuid(item.id) ? item.id : null,
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

async function syncPayment(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const orderNumber = typeof payload?.orderNumber === 'string' ? payload.orderNumber.trim() : '';
  const payments = Array.isArray(payload?.payments) ? payload.payments : [];
  if (!orderNumber || payments.length === 0) throw new Error('El pago no contiene una orden y un desglose válido.');

  const orderResult = await supabaseAdmin
    .from('pos_orders')
    .select('id, branch_id, cash_shift_id, cash_register_id, terminal_id')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', `order:${tenantId}:${orderNumber}`)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) {
    throw new Error('La orden aún no existe en la nube; se reintentará después de sincronizar la comanda.');
  }

  const allowedMethods = new Set(['CASH', 'CARD', 'SINPE', 'MIXED', 'CREDIT']);
  const inserted: string[] = [];
  for (const [index, payment] of payments.entries()) {
    const amount = safeNumber(payment?.amount, 0);
    if (amount <= 0) continue;
    const method = allowedMethods.has(payment?.method) ? payment.method : 'CASH';
    const idempotencyKey = `${operationId}:${index}`;
    const existing = await supabaseAdmin
      .from('pos_payments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing.data) {
      inserted.push(existing.data.id);
      continue;
    }

    const paymentResult = await supabaseAdmin
      .from('pos_payments')
      .insert({
        tenant_id: tenantId,
        order_id: orderResult.data.id,
        branch_id: scope.branchId || orderResult.data.branch_id,
        cash_shift_id: scope.cashShiftId || orderResult.data.cash_shift_id,
        cash_register_id: scope.cashRegisterId || orderResult.data.cash_register_id,
        terminal_id: scope.terminalId || orderResult.data.terminal_id,
        amount,
        method,
        provider: typeof payment?.provider === 'string' ? payment.provider.slice(0, 80) : 'POS_OFFLINE_SYNC',
        provider_transaction_id: typeof payment?.reference === 'string' ? payment.reference.slice(0, 160) : null,
        status: 'PENDING',
        idempotency_key: idempotencyKey
      })
      .select('id')
      .single();
    if (paymentResult.error || !paymentResult.data) throw new Error('No se pudo registrar el pago pendiente.');
    inserted.push(paymentResult.data.id);
  }

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
    metadata: { paymentIds: inserted, orderNumber, status: 'PENDING', source: 'pwa' }
  });

  return { orderId: orderResult.data.id, paymentIds: inserted, status: 'PENDING' };
}

async function findOrder(tenantId: string, orderNumber: unknown) {
  const normalizedOrderNumber = typeof orderNumber === 'string' ? orderNumber.trim() : '';
  if (!normalizedOrderNumber) throw new Error('La operación no contiene un número de orden válido.');
  const result = await supabaseAdmin
    .from('pos_orders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', `order:${tenantId}:${normalizedOrderNumber}`)
    .maybeSingle();
  if (result.error || !result.data) throw new Error('La orden aún no existe en la nube; se reintentará después de sincronizar la comanda.');
  return { id: result.data.id, orderNumber: normalizedOrderNumber };
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
        menuItemId: isUuid(item.menuItemId) ? item.menuItemId : null
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

async function syncInvoice(tenantId: string, userId: string, employeeId: string | undefined, operationId: string, payload: any) {
  const scope = readOperationalScope(payload);
  const order = await findOrder(tenantId, payload?.orderNumber);
  const clave = typeof payload?.clave === 'string' ? payload.clave.trim() : '';
  const consecutivo = typeof payload?.consecutivo === 'string' ? payload.consecutivo.trim() : '';
  if (!clave || !consecutivo) throw new Error('El comprobante offline no contiene clave y consecutivo.');
  if (!['FE', 'TE', 'NC', 'ND'].includes(payload?.documentType)) throw new Error('El tipo de comprobante offline no es válido.');

  const branch = await findBranch(tenantId, scope.branchId);
  if (!branch) throw new Error('No existe una sucursal activa para registrar el comprobante.');

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
    cash_shift_id: scope.cashShiftId,
    cash_register_id: scope.cashRegisterId,
    terminal_id: scope.terminalId,
    clave: clave.slice(0, 50),
    consecutivo: consecutivo.slice(0, 20),
    document_type: payload.documentType,
    hacienda_status: 'PENDING',
    total: Math.max(0, safeNumber(payload.total, 0)),
    invoice_data: payload.invoiceData && typeof payload.invoiceData === 'object' ? payload.invoiceData : {},
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
    const result = action === 'PAYMENT'
      ? await syncPayment(tenantId, auth.userId, auth.employeeId, operationId, body.payload)
      : action === 'DEDUCT_INVENTORY'
        ? await syncInventory(tenantId, auth.userId, auth.employeeId, operationId, body.payload)
        : action === 'EMIT_INVOICE'
          ? await syncInvoice(tenantId, auth.userId, auth.employeeId, operationId, body.payload)
          : await syncTable(tenantId, auth.userId, auth.employeeId, operationId, body.payload);
    return res.status(200).json({ success: true, alreadyApplied: false, result });
  } catch (error: any) {
    console.error('[Offline Sync] Error:', error);
    return res.status(409).json({ error: error?.message || 'No se pudo aplicar la operación offline.' });
  }
}
