import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from '../_utils/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

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
