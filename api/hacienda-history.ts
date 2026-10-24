import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, requireAuth, setCorsHeaders } from './_utils/security.js';
import { supabaseAdmin } from './_utils/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const limitValue = Number(req.query.limit || 100);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 250) : 100;
  const { data, error } = await supabaseAdmin
    .from('pos_invoices')
    .select('id, clave, consecutivo, document_type, hacienda_status, total, invoice_data, xml_content, signed_xml_content, error_message, submitted_at, accepted_at, created_at')
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Hacienda History] Error consultando historial:', error);
    return res.status(500).json({ error: 'No se pudo consultar el historial fiscal.' });
  }

  return res.status(200).json({
    success: true,
    invoices: (data || []).map((row: any) => ({
      id: row.id,
      clave: row.clave,
      consecutivo: row.consecutivo,
      documentType: row.document_type,
      status: row.hacienda_status,
      total: Number(row.total || 0),
      invoiceData: row.invoice_data || {},
      xmlContent: row.xml_content || undefined,
      signedXmlContent: row.signed_xml_content || undefined,
      errorMessage: row.error_message || undefined,
      submittedAt: row.submitted_at || undefined,
      acceptedAt: row.accepted_at || undefined,
      createdAt: row.created_at
    }))
  });
}
