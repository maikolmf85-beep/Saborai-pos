import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { supabaseAdmin as supabase, supabaseAuth } from './_utils/supabase.js';
import { allowedOriginForRedirect, checkRateLimit, getJwtSecret, handleOptions, requireAuth, requireRole, setCorsHeaders } from './_utils/security.js';
import { buildEmployeeTokenClaims, isEmployeeRole, normalizeEmployeeRoster } from './_utils/employeeSession.js';
import { processTilopaySubscription } from './_utils/tilopayClient.js';
import { consumeTilopaySignupHandoff, getTilopaySignupHandoff } from './_utils/tilopaySignupHandoff.js';
import { consumePasswordResetToken, createPasswordResetToken } from './_utils/passwordReset.js';

const resendApiKey = process.env.RESEND_API_KEY;

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function ensureSupabaseAuthIdentity(email: string, password: string): Promise<string | null> {
  try {
    const created = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true
    });
    if (created.data.user?.id) return created.data.user.id;

    const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = listed.data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
    return existing?.id || null;
  } catch {
    try {
      const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed.data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
      if (existing?.id) return existing.id;
    } catch {
      console.warn('[Auth Bridge] No se pudo consultar la identidad Supabase.');
    }
    console.warn('[Auth Bridge] No se pudo vincular la identidad Supabase.');
    return null;
  }
}

async function getSupabaseSession(email: string, password: string) {
  if (!supabaseAuth) return null;
  try {
    const result = await supabaseAuth.auth.signInWithPassword({ email: email.toLowerCase(), password });
    return result.data.session || null;
  } catch {
    console.warn('[Auth Bridge] No se pudo obtener sesión Supabase.');
    return null;
  }
}

async function linkLegacyUserToAuth(userId: string, email: string, password: string): Promise<void> {
  const authUserId = await ensureSupabaseAuthIdentity(email, password);
  if (!authUserId) return;
  const { error } = await supabase
    .from('users')
    .update({ auth_user_id: authUserId })
    .eq('id', userId)
    .is('auth_user_id', null);
  if (error) console.warn('[Auth Bridge] La columna auth_user_id aún no está disponible.');
}

async function operationalChecks(tenantId: string | undefined) {
  const tableAvailable = async (table: string, columns = 'id'): Promise<boolean> => {
    if (!tenantId) return false;
    const { error } = await supabase
      .from(table)
      .select(columns, { head: true, count: 'exact' })
      .eq('tenant_id', tenantId);
    return !error;
  };

  const [orders, payments, invoices, inventory] = await Promise.all([
    tableAvailable('pos_orders'),
    tableAvailable('pos_payments'),
    tableAvailable('pos_invoices', 'id, invoice_data'),
    tableAvailable('pos_inventory_movements')
  ]);
  return {
    databaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    tenantResolved: Boolean(tenantId),
    posOrdersTable: orders,
    paymentsTable: payments,
    invoicesHistoryTable: invoices,
    offlineInventoryTable: inventory,
    passwordResetEmail: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    supabaseAuthClient: Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  let jwtSecret: string;
  try {
    jwtSecret = getJwtSecret();
  } catch (error: any) {
    console.error('[Auth] Configuración insegura:', error.message);
    return res.status(500).json({ error: 'El servidor no está configurado correctamente.' });
  }

  // Resolve action from query params (via vercel rewrites) or URL path
  const rawAction = (
    (req.query.action as string) ||
    (req.body && req.body.action) ||
    req.url?.split('?')[0].split('/').filter(Boolean).pop() ||
    ''
  ).toLowerCase();

  try {
    if (rawAction === 'system-status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const checks = await operationalChecks(auth.tenantId);
      const healthy = Object.values(checks).every(Boolean);
      return res.status(healthy ? 200 : 503).json({
        success: healthy,
        status: healthy ? 'healthy' : 'degraded',
        checks
      });
    }

    if (rawAction === 'employee-roster') {
      if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method Not Allowed' });
      const auth = await requireAuth(req, res);
      if (!auth) return;
      if (!auth.tenantId) return res.status(403).json({ error: 'La sesión no tiene un tenant asociado.' });

      if (req.method === 'GET') {
        const [employeesResult, ownerResult] = await Promise.all([
          supabase
            .from('pos_employees')
            .select('external_id, name, email, phone, role, is_active')
            .eq('tenant_id', auth.tenantId)
            .order('name', { ascending: true }),
          supabase
            .from('users')
            .select('id, name, email, phone, restaurant_name, role, active')
            .eq('id', auth.userId)
            .maybeSingle()
        ]);
        if (employeesResult.error || ownerResult.error || !ownerResult.data) {
          console.error('[Auth] No se pudo leer el padrón de empleados.');
          return res.status(503).json({ error: 'No se pudo cargar el padrón de empleados.' });
        }
        const owner = ownerResult.data;
        const ownerProfile = {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          phone: owner.phone,
          restaurantName: owner.restaurant_name,
          role: owner.role,
          active: owner.active
        };
        const employees = (employeesResult.data || []).map((employee: any) => ({
          id: employee.external_id,
          name: employee.name,
          email: employee.email || '',
          phone: employee.phone || '',
          restaurantName: owner.restaurant_name,
          role: employee.role,
          active: employee.is_active
        }));
        return res.status(200).json({ success: true, tenantId: auth.tenantId, accountUserId: auth.userId, owner: ownerProfile, employees });
      }

      if (!requireRole(auth, res, ['ADMIN'])) return;

      const rateLimit = checkRateLimit(`employee-roster:${auth.userId}`, 20, 60000);
      if (!rateLimit.allowed) return res.status(429).json({ error: 'Demasiadas sincronizaciones del padrón. Intenta de nuevo en un minuto.' });

      let roster;
      try {
        roster = normalizeEmployeeRoster((req.body as any)?.employees);
      } catch (error: any) {
        return res.status(400).json({ error: error?.message || 'El padrón de empleados no es válido.' });
      }

      // El registro de la cuenta propietaria no es una credencial de empleado.
      const employees = roster.filter(employee => employee.externalId !== auth.userId);
      const existingResult = employees.length > 0
        ? await supabase
          .from('pos_employees')
          .select('external_id, pin_hash')
          .eq('tenant_id', auth.tenantId)
          .in('external_id', employees.map(employee => employee.externalId))
        : { data: [], error: null };
      if (existingResult.error) {
        console.error('[Auth] No se pudo preparar el padrón de empleados.');
        return res.status(503).json({ error: 'No se pudo sincronizar el padrón de empleados.' });
      }
      const currentHashes = new Map((existingResult.data || []).map((row: any) => [row.external_id, row.pin_hash]));
      if (employees.some(employee => !employee.pin && !currentHashes.has(employee.externalId))) {
        return res.status(400).json({ error: 'Cada nuevo colaborador debe tener un PIN de cuatro dígitos.' });
      }

      const rows: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < employees.length; offset += 4) {
        const batch = await Promise.all(employees.slice(offset, offset + 4).map(async employee => {
          const currentHash = currentHashes.get(employee.externalId) as string | undefined;
          let pinHash = currentHash;
          if (employee.pin && (!currentHash || !(await bcrypt.compare(employee.pin, currentHash)))) {
            pinHash = await bcrypt.hash(employee.pin, 12);
          }
          return {
            tenant_id: auth.tenantId,
            external_id: employee.externalId,
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            role: employee.role,
            is_active: employee.active,
            pin_hash: pinHash,
            updated_at: new Date().toISOString()
          };
        }));
        rows.push(...batch);
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('pos_employees')
          .upsert(rows, { onConflict: 'tenant_id,external_id' });
        if (error) {
          console.error('[Auth] No se pudo guardar el padrón de empleados.');
          return res.status(503).json({ error: 'No se pudo sincronizar el padrón de empleados.' });
        }
      }
      return res.status(200).json({ success: true, synced: rows.length });
    }

    if (rawAction === 'employee-session') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
      const body = (req.body || {}) as { employeeId?: unknown; tenantId?: unknown; pin?: unknown };
      const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
      if (!employeeId || employeeId.length > 120) return res.status(400).json({ error: 'Colaborador o PIN incorrecto.' });

      const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
      const pinLogin = pin.length > 0;
      let tenantId = '';
      if (pinLogin) {
        const requestedTenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedTenantId) || !/^\d{4}$/.test(pin)) {
          return res.status(401).json({ error: 'Colaborador o PIN incorrecto.' });
        }
        tenantId = requestedTenantId;
        const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const rateLimit = checkRateLimit(`employee-pin:${clientIp}:${tenantId}:${employeeId}`, 5, 60000);
        if (!rateLimit.allowed) return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.' });
      } else {
        const auth = await requireAuth(req, res);
        if (!auth) return;
        if (!requireRole(auth, res, ['ADMIN'])) return;
        if (!auth.tenantId) return res.status(403).json({ error: 'La sesión no tiene un tenant asociado.' });
        if (typeof body.tenantId === 'string' && body.tenantId !== auth.tenantId) {
          return res.status(403).json({ error: 'El tenant del colaborador no coincide con la sesión.' });
        }
        tenantId = auth.tenantId;
      }

      const { data: employee, error: employeeError } = await supabase
        .from('pos_employees')
        .select('id, tenant_id, external_id, name, email, phone, role, pin_hash, is_active')
        .eq('tenant_id', tenantId)
        .eq('external_id', employeeId)
        .maybeSingle();
      if (employeeError) {
        console.error('[Auth] No se pudo verificar el colaborador.');
        return res.status(503).json({ error: 'No se pudo validar el acceso del colaborador.' });
      }
      if (!employee || employee.is_active === false || !isEmployeeRole(employee.role)) {
        return res.status(pinLogin ? 401 : 404).json({ error: 'Colaborador o PIN incorrecto.' });
      }
      if (pinLogin && !(await bcrypt.compare(pin, employee.pin_hash))) {
        return res.status(401).json({ error: 'Colaborador o PIN incorrecto.' });
      }

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', employee.tenant_id)
        .maybeSingle();
      if (tenantError || !tenant) return res.status(401).json({ error: 'Colaborador o PIN incorrecto.' });
      const { data: owner, error: ownerError } = await supabase
        .from('users')
        .select('id, email, active')
        .eq('id', tenant.user_id)
        .maybeSingle();
      if (ownerError || !owner || owner.active === false) return res.status(401).json({ error: 'Colaborador o PIN incorrecto.' });

      const token = jwt.sign({
        ...buildEmployeeTokenClaims(employee, tenant, owner),
        sessionId: randomUUID()
      }, jwtSecret, { expiresIn: '12h', jwtid: randomUUID() });
      const user = {
        id: employee.external_id,
        name: employee.name,
        email: employee.email || '',
        phone: employee.phone || '',
        restaurant_name: tenant.name,
        role: employee.role,
        active: employee.is_active
      };
      const mappedTenant = { ...tenant, onboardingCompleted: tenant.onboarding_completed };
      return res.status(200).json({
        success: true,
        token,
        user,
        tenant: mappedTenant,
        accountUserId: owner.id,
        employeeId: employee.id,
        employeeSession: true
      });
    }

    // -------------------------------------------------------------
    // ACTION: LOGIN (POST /api/auth/login)
    // -------------------------------------------------------------
    if (rawAction === 'login') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const { email: rawEmail, password } = req.body || {};
      const email = String(rawEmail || '').trim().toLowerCase();
      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
      }

      const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const rateLimitCheck = checkRateLimit(`login:${clientIp}:${email}`, 5, 60000);
      if (!rateLimitCheck.allowed) {
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Por favor espera un minuto antes de reintentar.' });
      }

      // 1. Fetch user
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (userError || !user) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }

      // 2. Check password
      let isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        const supabaseSession = await getSupabaseSession(email, password);
        if (supabaseSession) {
          const salt = await bcrypt.genSalt(10);
          const synchronizedHash = await bcrypt.hash(password, salt);
          const { error: syncError } = await supabase
            .from('users')
            .update({ password_hash: synchronizedHash })
            .eq('id', user.id);
          if (!syncError) {
            user.password_hash = synchronizedHash;
            isPasswordValid = true;
          } else {
            console.warn('[Auth] No se pudo sincronizar el hash legacy:', syncError.message);
          }
        }
      }
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }

      if (!user.auth_user_id) {
        await linkLegacyUserToAuth(user.id, email, password);
      }

      const supabaseSession = await getSupabaseSession(email, password);

      // 3. Fetch related tenant and subscription
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // 4. Generate JWT
      const token = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
      delete user.password_hash;

      return res.status(200).json({
        success: true,
        token,
        supabaseSession,
        user,
        tenant,
        subscription
      });
    }

    // -------------------------------------------------------------
    // ACTION: REGISTER (POST /api/auth/register)
    // -------------------------------------------------------------
    if (rawAction === 'register' || rawAction === 'complete-tilopay-signup') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const isHandoffRegistration = rawAction === 'complete-tilopay-signup';
      let registrationPayload = req.body || {};
      let handoffReference: unknown;
      let paymentToken = '';

      if (isHandoffRegistration) {
        handoffReference = registrationPayload.reference;
        paymentToken = typeof registrationPayload.token === 'string'
          ? registrationPayload.token
          : '';
        const handoff = await getTilopaySignupHandoff(handoffReference);
        if (!handoff) {
          return res.status(400).json({ error: 'El enlace de registro no es válido o ya expiró.' });
        }
        registrationPayload = handoff;
      }

      const { email, password, name, phone, restaurantName, plan } = registrationPayload;
      if (!email || !password || !name || !restaurantName) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
      }

      // 1. Check if user exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

      if (existingUser) {
        return res.status(400).json({ error: 'El correo ya está registrado' });
      }

      // 2. Hash password
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // 3. Create user
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          email: email.toLowerCase(),
          name,
          phone,
          restaurant_name: restaurantName,
          password_hash: passwordHash,
        })
        .select()
        .single();

      if (userError || !newUser) {
        console.error('Error creating user.');
        return res.status(500).json({ error: 'Error al crear usuario' });
      }

      await linkLegacyUserToAuth(newUser.id, newUser.email, password);

      const supabaseSession = await getSupabaseSession(newUser.email, password);

      // 4. Create tenant
      const { data: newTenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          user_id: newUser.id,
          name: restaurantName,
          email: email.toLowerCase(),
          phone,
          plan: plan || 'pro',
        })
        .select()
        .single();

      if (tenantError || !newTenant) {
        console.error('Error creating tenant.');
        return res.status(500).json({ error: 'Error al crear tenant' });
      }

      // 5. Create subscription (14-day trial)
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);

      const { data: newSubscription, error: subError } = await supabase
        .from('subscriptions')
        .insert({
          user_id: newUser.id,
          tenant_id: newTenant.id,
          mode: 'TRIAL',
          plan: plan || 'pro',
          trial_ends_at: trialEnd.toISOString(),
        })
        .select()
        .single();

      if (subError || !newSubscription) {
        console.error('Error creating subscription.');
        return res.status(500).json({ error: 'Error al crear suscripción' });
      }

      // Nunca cobrar hasta que el usuario, tenant y suscripción existan.
      // Así un correo duplicado o un fallo de persistencia no crea un cargo huérfano.
      if (isHandoffRegistration) {
        if (paymentToken) {
          try {
            await processTilopaySubscription({
              reference: handoffReference,
              token: paymentToken
            });
          } catch {
            // Se conserva el comportamiento anterior de alta TRIAL incluso si el pago falla.
            console.warn('[Tilopay] No se pudo procesar la suscripción durante el retorno.');
          }
        }

        const consumedHandoff = await consumeTilopaySignupHandoff(handoffReference);
        if (!consumedHandoff) {
          return res.status(400).json({ error: 'El enlace de registro no es válido o ya expiró.' });
        }
      }

      // 6. Generate JWT
      const token = jwt.sign({ userId: newUser.id, email: newUser.email }, jwtSecret, { expiresIn: '7d' });
      delete newUser.password_hash;

      return res.status(200).json({
        success: true,
        token,
        supabaseSession,
        user: newUser,
        tenant: newTenant,
        subscription: newSubscription
      });
    }

    // -------------------------------------------------------------
    // ACTION: ME (GET /api/auth/me)
    // -------------------------------------------------------------
    if (rawAction === 'me') {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const auth = await requireAuth(req, res);
      if (!auth) return;
      if (!auth.tenantId) return res.status(401).json({ error: 'Restaurante no encontrado.' });

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', auth.tenantId)
        .eq('user_id', auth.userId)
        .maybeSingle();
      if (tenantError || !tenant) return res.status(401).json({ error: 'Restaurante no encontrado.' });

      let user: Record<string, any> | null = null;
      if (auth.employeeId) {
        const { data: employee, error: employeeError } = await supabase
          .from('pos_employees')
          .select('external_id, name, email, phone, role, is_active')
          .eq('id', auth.employeeId)
          .eq('tenant_id', tenant.id)
          .maybeSingle();
        if (employeeError || !employee || employee.is_active === false) {
          return res.status(401).json({ error: 'La sesión del colaborador ya no es válida.' });
        }
        user = {
          id: employee.external_id,
          name: employee.name,
          email: employee.email || '',
          phone: employee.phone || '',
          restaurant_name: tenant.name,
          role: employee.role,
          active: employee.is_active
        };
      } else {
        const { data: accountUser, error: userError } = await supabase
          .from('users')
          .select('id, name, email, phone, restaurant_name, role, active')
          .eq('id', auth.userId)
          .maybeSingle();
        if (userError || !accountUser || accountUser.active === false) {
          return res.status(401).json({ error: 'Usuario no encontrado.' });
        }
        user = accountUser;
      }

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', auth.userId)
        .maybeSingle();
      const mappedTenant = { ...tenant, onboardingCompleted: tenant.onboarding_completed };

      return res.status(200).json({
        success: true,
        user,
        tenant: mappedTenant,
        subscription,
        accountUserId: auth.userId,
        employeeId: auth.employeeId || null,
        employeeSession: Boolean(auth.employeeId)
      });
    }

    // -------------------------------------------------------------
    // ACTION: PASSWORD / RESET-PASSWORD / UPDATE-PASSWORD
    // -------------------------------------------------------------
    if (rawAction === 'password' || rawAction === 'reset-password' || rawAction === 'update-password') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const { email, token, newPassword } = (req.body as any) || {};

      // Case 1: Update password with a purpose-specific, single-use token
      if (token && newPassword) {
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
          return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        let userId: string | null;
        try {
          userId = await consumePasswordResetToken(token, supabase);
        } catch {
          console.error('[Auth] No se pudo validar el enlace de recuperación.');
          return res.status(500).json({ error: 'No se pudo validar el enlace de recuperación.' });
        }
        if (!userId) {
          return res.status(401).json({ error: 'El enlace es inválido, ya fue usado o ha expirado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const { data: resetUser, error: resetUserError } = await supabase
          .from('users')
          .select('id, auth_user_id')
          .eq('id', userId)
          .maybeSingle();
        if (resetUserError || !resetUser) {
          console.error('[Auth] Usuario no encontrado al restablecer contraseña:', resetUserError);
          return res.status(404).json({ error: 'La cuenta asociada al enlace ya no existe.' });
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({ password_hash: hashedPassword })
          .eq('id', userId);

        if (updateError) {
          console.error('Error actualizando contraseña:', updateError);
          return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
        }

        const authUserId = resetUser.auth_user_id;
        if (authUserId) {
          const { error: authPasswordError } = await supabase.auth.admin.updateUserById(authUserId, {
            password: newPassword
          });
          if (authPasswordError) {
            console.warn('[Auth] No se pudo sincronizar la contraseña de Supabase Auth:', authPasswordError.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.'
        });
      }

      // Case 2: Request password reset email
      if (email) {
        const normalizedEmail = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
          return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
        }

        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('email', normalizedEmail)
          .single();

        if (userError || !user) {
          return res.status(200).json({
            success: true,
            message: 'Si el correo existe, recibirás las instrucciones en breve.'
          });
        }

        if (!resendApiKey) {
          console.error('[Password Reset] RESEND_API_KEY no configurada; no se envió correo.');
          return res.status(503).json({
            error: 'El servicio de correo no está configurado. El administrador debe configurar RESEND_API_KEY y RESEND_FROM_EMAIL.'
          });
        }

        const { token: resetToken, tokenHash } = createPasswordResetToken();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const { error: tokenInsertError } = await supabase
          .from('password_reset_tokens')
          .insert({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt });
        if (tokenInsertError) {
          console.error('[Password Reset] No se pudo guardar el token de recuperación:', tokenInsertError.message);
          return res.status(500).json({ error: 'No se pudo crear el enlace de recuperación.' });
        }

        const origin = allowedOriginForRedirect(req.headers.origin);
        const resetLink = `${origin}/?resetToken=${resetToken}`;

        const resend = new Resend(resendApiKey);
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'soporte@saborai.site';

        const emailResponse = await resend.emails.send({
          from: fromEmail,
          to: email,
          subject: 'Recuperación de contraseña - Saborai POS',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3b3733;">
              <h2 style="color: #a9b994;">Saborai POS</h2>
              <p>Hola ${escapeHtml(user.name)},</p>
              <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
              <p>Haz clic en el siguiente enlace para crear una nueva contraseña. Este enlace expira en 1 hora:</p>
              <div style="margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #3b3733; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Restablecer Contraseña
                </a>
              </div>
              <p style="font-size: 12px; color: #6b686d;">Si no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
            </div>
          `
        });

        if (emailResponse.error) {
          console.error('Error de Resend:', emailResponse.error);
          return res.status(500).json({
            error: 'Error al enviar el correo electrónico.',
            details: emailResponse.error.message
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Te hemos enviado las instrucciones a tu correo electrónico.'
        });
      }

      return res.status(400).json({ error: 'Parámetros inválidos. Se requiere email o token con newPassword.' });
    }

    // -------------------------------------------------------------
    // ACTION: DEMO (POST /api/demo/register)
    // -------------------------------------------------------------
    if (rawAction === 'demo' || rawAction === 'demo-register') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const { email } = req.body || {};
      if (!email) {
        return res.status(400).json({ error: 'El correo es requerido' });
      }

      // 1. Guardar lead en Supabase
      const { error: dbError } = await supabase
        .from('demo_leads')
        .insert([{ email: email.toLowerCase() }]);

      if (dbError) {
        console.warn('No se pudo guardar el lead en Supabase:', dbError.message);
      }

      // 2. Enviar correo de bienvenida con Resend
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'soporte@saborai.site';

        const emailResponse = await resend.emails.send({
          from: fromEmail,
          to: email,
          subject: '¡Bienvenido al Demo de Saborai POS!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3b3733;">
              <h2 style="color: #a9b994;">¡Bienvenido a la Experiencia Saborai POS!</h2>
              <p>Hola,</p>
              <p>Gracias por ingresar a nuestro Demo interactivo. Saborai POS es la primera plataforma de gestión gastronómica en Costa Rica impulsada por Inteligencia Artificial.</p>
              <h3>¿Qué puedes hacer en este Demo?</h3>
              <ul>
                <li><strong>Tomar Pedidos:</strong> Selecciona mesas, agrega productos y prueba nuestra sugerencia inteligente de platillos.</li>
                <li><strong>Facturación y Caja:</strong> Simula cobros y observa cómo se integraría la Facturación Electrónica de Hacienda v4.3.</li>
                <li><strong>Cocina y Bar (KDS):</strong> Mira cómo los pedidos viajan al instante a las pantallas de producción.</li>
              </ul>
              <p>Recuerda que este es un entorno de demostración y los datos no son permanentes. Cuando estés listo para la experiencia completa, puedes registrarte desde el sistema o contactarnos para adquirir uno de nuestros planes.</p>
              <p>¡Disfruta explorando!</p>
              <p>Atentamente,<br/>El equipo de Saborai POS</p>
            </div>
          `
        });

        if (emailResponse.error) {
          console.error('Error de Resend al enviar bienvenida de demo:', emailResponse.error);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Registrado con éxito.'
      });
    }

    return res.status(400).json({ error: `Acción de autenticación no válida: '${rawAction}'` });
  } catch (err: any) {
    if (rawAction === 'complete-tilopay-signup') {
      console.error('[Auth] No se pudo completar el registro desde Tilopay.');
      return res.status(500).json({ error: 'No se pudo completar el registro.' });
    }
    console.error(`Auth router error for action '${rawAction}':`, err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
