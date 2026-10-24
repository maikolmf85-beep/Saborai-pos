import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from './supabase.js';

export interface AuthContext {
  userId: string;
  email: string;
  role?: string;
  tenantId?: string;
}

function configuredOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || 'https://saborai.site,https://www.saborai.site,https://pos.saborai.site,https://admin.saborai.site';
  return raw.split(',').map(origin => origin.trim()).filter(Boolean);
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET debe estar configurado y tener al menos 32 caracteres.');
  }
  return secret;
}

export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers.origin;
  const allowed = origin && configuredOrigins().includes(origin) ? origin : configuredOrigins()[0];
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Tilopay-Signature'
  );
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export async function authenticateRequest(req: VercelRequest): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  let decoded: { userId?: string; email?: string };
  try {
    decoded = jwt.verify(token, getJwtSecret()) as { userId?: string; email?: string };
  } catch {
    return null;
  }

  if (!decoded.userId || !decoded.email) return null;

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id,email,role,active')
    .eq('id', decoded.userId)
    .maybeSingle();

  if (error || !user || user.active === false) return null;
  if (String(user.email).toLowerCase() !== String(decoded.email).toLowerCase()) return null;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: tenant?.id
  };
}

export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
  allowedRoles?: string[]
): Promise<AuthContext | null> {
  const context = await authenticateRequest(req);
  if (!context) {
    res.status(401).json({ error: 'No autorizado.' });
    return null;
  }

  if (allowedRoles && (!context.role || !allowedRoles.includes(context.role))) {
    res.status(403).json({ error: 'No tienes permisos para realizar esta operación.' });
    return null;
  }

  return context;
}

export function allowedOriginForRedirect(origin?: string): string {
  const origins = configuredOrigins();
  return origin && origins.includes(origin) ? origin : origins[0];
}
