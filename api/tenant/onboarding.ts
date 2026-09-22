import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { supabase } from '../utils/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = authHeader.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-for-development';

  try {
    const decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string };
    
    // Update tenant onboarding status
    const { error } = await supabase
      .from('tenants')
      .update({ onboarding_completed: true })
      .eq('user_id', decoded.userId);

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
