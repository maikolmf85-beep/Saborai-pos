import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, handleOptions, setCorsHeaders } from './_utils/security.js';
import { supabaseAdmin } from './_utils/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, active, auth_user_id')
    .eq('id', auth.userId)
    .maybeSingle();
  if (userError || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, status')
    .eq('user_id', auth.userId)
    .maybeSingle();

  return res.status(200).json({
    success: true,
    checks: {
      legacyJwt: true,
      userActive: user.active !== false,
      tenantPresent: Boolean(tenant?.id),
      tenantStatus: tenant?.status || null,
      supabaseAuthLinked: Boolean(user.auth_user_id),
      supabaseAuthConfigured: Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      passwordResetEmailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      tenantLookupHealthy: !tenantError
    }
  });
}
