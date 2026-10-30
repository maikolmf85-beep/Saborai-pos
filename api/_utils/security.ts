import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from './supabase.js';
import { hasRolePermission } from './rolePermissions.js';
import { buildEmployeeAuthContext } from './employeeSession.js';
import { isUserActive } from './userStatus.js';

export interface AuthContext {
  userId: string;
  email: string;
  role?: string;
  tenantId?: string;
  employeeId?: string;
  employeeExternalId?: string;
  employeeName?: string;
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

  let decoded: { userId?: string; email?: string; employeeId?: string; tenantId?: string };
  try {
    decoded = jwt.verify(token, getJwtSecret()) as { userId?: string; email?: string };
  } catch {
    return null;
  }

  if (decoded.employeeId) {
    if (!decoded.userId || !decoded.email || !decoded.tenantId) return null;

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from('pos_employees')
      .select('id, tenant_id, external_id, name, email, role, is_active')
      .eq('id', decoded.employeeId)
      .eq('tenant_id', decoded.tenantId)
      .maybeSingle();
    if (employeeError || !employee || !isUserActive(employee.is_active)) return null;

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, user_id')
      .eq('id', employee.tenant_id)
      .maybeSingle();
    if (tenantError || !tenant || tenant.user_id !== decoded.userId) return null;

    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('users')
      .select('id, email, active')
      .eq('id', tenant.user_id)
      .maybeSingle();
    if (ownerError || !owner || !isUserActive(owner.active)) return null;
    if (String(owner.email).toLowerCase() !== String(decoded.email).toLowerCase()) return null;

    return buildEmployeeAuthContext(employee, tenant, owner);
  }

  if (!decoded.userId || !decoded.email) return null;

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id,email,role,active')
    .eq('id', decoded.userId)
    .maybeSingle();

  if (error || !user || !isUserActive(user.active)) return null;
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

  if (allowedRoles && !requireRole(context, res, allowedRoles)) return null;

  return context;
}

export function requireRole(
  context: AuthContext,
  res: VercelResponse,
  allowedRoles: readonly string[]
): boolean {
  if (hasRolePermission(context.role, allowedRoles)) return true;
  res.status(403).json({ error: 'No tienes permisos para realizar esta operación.' });
  return false;
}

export function allowedOriginForRedirect(origin?: string): string {
  const origins = configuredOrigins();
  return origin && origins.includes(origin) ? origin : origins[0];
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(key: string, maxAttempts = 5, windowMs = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (record.count >= maxAttempts) {
    return { allowed: false, remaining: 0 };
  }
  record.count += 1;
  return { allowed: true, remaining: maxAttempts - record.count };
}
