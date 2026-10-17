import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, setCorsHeaders } from '../_utils/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = await requireAuth(req, res, ['ADMIN']);
  if (!auth) return;

  try {
    // We fetch the count of all demo_leads
    const { count, error } = await supabase
      .from('demo_leads')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error fetching leads:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ 
      leadsCount: count || 0
    });

  } catch (error: any) {
    console.error('Error en admin/metrics:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
