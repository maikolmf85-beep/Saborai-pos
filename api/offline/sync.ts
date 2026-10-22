import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../_utils/supabase.js';
import { handleOptions, requireAuth, setCorsHeaders } from '../_utils/security.js';

const SUPPORTED_ACTIONS = new Set(['UPDATE_TABLE']);

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeStatus(value: unknown): 'AVAILABLE' | 'OCCUPIED' | 'PRE_CHECK' | 'RESERVED' {
  return value === 'OCCUPIED' || value === 'PRE_CHECK' || value === 'RESERVED' ? value : 'AVAILABLE';
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function findBranch(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('pos_branches')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('No se pudo localizar una sucursal operativa.');
  return data;
}

async function syncTable(tenantId: string, userId: string, operationId: string, payload: any) {
  const table = payload && typeof payload === 'object' ? payload : null;
  if (!table || !table.name) throw new Error('El payload de la mesa es inválido.');

  const branch = await findBranch(tenantId);
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
    } else {
      const orderResult = await supabaseAdmin
        .from('pos_orders')
        .insert({
          tenant_id: tenantId,
          branch_id: branch.id,
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
  }

  await supabaseAdmin.from('pos_audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    action: 'OFFLINE_SYNC',
    entity_type: 'TABLE',
    entity_id: tableResult.data.id,
    request_id: operationId,
    metadata: { orderId, tableNumber: table.number, source: 'pwa' }
  });

  return { tableId: tableResult.data.id, orderId };
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
    payload?: unknown;
  };
  const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';

  if (!operationId || operationId.length > 160) return res.status(400).json({ error: 'operationId es requerido.' });
  if (!tenantId || tenantId !== auth.tenantId) return res.status(403).json({ error: 'El tenant de la operación no coincide con la sesión.' });
  if (!SUPPORTED_ACTIONS.has(action)) {
    return res.status(422).json({ error: `La operación ${action || 'desconocida'} aún no está habilitada para sincronización.` });
  }

  const existingAudit = await supabaseAdmin
    .from('pos_audit_events')
    .select('id, metadata')
    .eq('tenant_id', tenantId)
    .eq('request_id', operationId)
    .limit(1)
    .maybeSingle();
  if (existingAudit.data) return res.status(200).json({ success: true, alreadyApplied: true, result: existingAudit.data.metadata });

  try {
    const result = await syncTable(tenantId, auth.userId, operationId, body.payload);
    return res.status(200).json({ success: true, alreadyApplied: false, result });
  } catch (error: any) {
    console.error('[Offline Sync] Error:', error);
    return res.status(409).json({ error: error?.message || 'No se pudo aplicar la operación offline.' });
  }
}
