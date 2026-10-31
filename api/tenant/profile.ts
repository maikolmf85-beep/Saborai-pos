import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from '../_utils/security.js';
import { cleanTenantZones, updateTenantZonesInSupabase } from '../_utils/tenantZones.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (!['GET', 'PATCH', 'POST'].includes(req.method || '')) {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (req.method !== 'GET' && !requireRole(auth, res, ['ADMIN'])) return;
  if (!auth.tenantId) return res.status(404).json({ error: 'Restaurante no encontrado.' });

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, zones')
    .eq('id', auth.tenantId)
    .eq('user_id', auth.userId)
    .single();

  if (tenantError || !tenant) {
    return res.status(404).json({ error: 'Restaurante no encontrado.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, zones: cleanTenantZones(tenant.zones) || [] });
  }

  const requestedZones = (req.body as { zones?: unknown } | undefined)?.zones;
  const zones = cleanTenantZones(requestedZones);
  if (!zones) return res.status(400).json({ error: 'La lista de salones es inválida.' });
  const { data: updatedTenant, error: updateError } = await updateTenantZonesInSupabase(
    supabase,
    tenant.id,
    auth.userId,
    zones
  );

  if (updateError || !updatedTenant) {
    console.error('[Tenant Profile] Error guardando salones:', updateError);
    return res.status(500).json({ error: 'No se pudieron guardar los salones.' });
  }

  return res.status(200).json({ success: true, zones: cleanTenantZones(updatedTenant.zones) || [] });
}
