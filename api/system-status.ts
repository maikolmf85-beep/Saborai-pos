import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, handleOptions, setCorsHeaders } from './_utils/security.js';
import { supabaseAdmin } from './_utils/supabase.js';

async function tableAvailable(table: string, tenantId: string | undefined, columns = 'id'): Promise<boolean> {
  if (!tenantId) return false;
  const { error } = await supabaseAdmin
    .from(table)
    .select(columns, { head: true, count: 'exact' })
    .eq('tenant_id', tenantId);
  return !error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const [orders, payments, invoices, inventory] = await Promise.all([
    tableAvailable('pos_orders', auth.tenantId),
    tableAvailable('pos_payments', auth.tenantId),
    tableAvailable('pos_invoices', auth.tenantId, 'id, invoice_data'),
    tableAvailable('pos_inventory_movements', auth.tenantId)
  ]);

  const checks = {
    databaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    tenantResolved: Boolean(auth.tenantId),
    posOrdersTable: orders,
    paymentsTable: payments,
    invoicesHistoryTable: invoices,
    offlineInventoryTable: inventory,
    passwordResetEmail: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    supabaseAuthClient: Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  };

  const healthy = Object.values(checks).every(Boolean);
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'healthy' : 'degraded',
    checks
  });
}
