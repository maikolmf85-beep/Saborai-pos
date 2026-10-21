import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, setCorsHeaders } from '../_utils/security.js';

function cleanZones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter(zone => typeof zone === 'string')
    .map(zone => zone.trim())
    .filter(Boolean)
  )).slice(0, 200);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (!['GET', 'PATCH', 'POST'].includes(req.method || '')) {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, zones')
    .eq('user_id', auth.userId)
    .single();

  if (tenantError || !tenant) {
    return res.status(404).json({ error: 'Restaurante no encontrado.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, zones: cleanZones(tenant.zones) });
  }

  const zones = cleanZones((req.body as { zones?: unknown } | undefined)?.zones);
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ zones })
    .eq('id', tenant.id)
    .eq('user_id', auth.userId);

  if (updateError) {
    console.error('[Tenant Profile] Error guardando salones:', updateError);
    return res.status(500).json({ error: 'No se pudieron guardar los salones.' });
  }

  return res.status(200).json({ success: true, zones });
}
