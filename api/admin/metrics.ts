import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, setCorsHeaders } from '../_utils/security.js';
import { isGlobalAdminUser, parseGlobalAdminUserIds } from '../_utils/globalAdminAuthorization.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // A restaurant-level ADMIN is not a global operator. Access is granted only
  // to account IDs explicitly configured by the deployment owner.
  const globalAdminUserIds = parseGlobalAdminUserIds(process.env.SABORAI_GLOBAL_ADMIN_USER_IDS);
  if (globalAdminUserIds.size === 0) {
    return res.status(503).json({ error: 'El acceso global no está configurado.' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (auth.employeeId || !isGlobalAdminUser(auth.userId, globalAdminUserIds)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a métricas globales.' });
  }

  try {
    const { count, error } = await supabase
      .from('demo_leads')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error fetching leads:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ leadsCount: count || 0 });
  } catch (error: unknown) {
    console.error('Error en admin/metrics:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
