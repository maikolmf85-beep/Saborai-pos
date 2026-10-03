import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../utils/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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
