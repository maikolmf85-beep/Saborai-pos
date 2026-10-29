import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from '../_utils/security.js';
import { resolveTenantApiAction } from '../_utils/tenantRoute.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = resolveTenantApiAction(req.url);
  if (!action) {
    return res.status(404).json({ error: 'Not Found' });
  }

  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (action === 'onboarding') {
    return handleOnboarding(req, res);
  }
  return handleProfile(req, res);
}

async function handleOnboarding(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, ['ADMIN'])) return;
    // Update tenant onboarding status
    const { error } = await supabase
      .from('tenants')
      .update({ onboarding_completed: true })
      .eq('user_id', auth.userId);
    if (error) {
      console.error('Error updating onboarding status:', error);
      return res.status(500).json({ error: 'Failed to update onboarding status' });
    }
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('Onboarding endpoint error:', err);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function cleanZones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter(zone => typeof zone === 'string')
    .map(zone => zone.trim())
    .filter(Boolean)
  )).slice(0, 200);
}

async function handleProfile(req: VercelRequest, res: VercelResponse) {
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
