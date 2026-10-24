import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { supabaseAdmin as supabase, supabaseAuth } from './_utils/supabase.js';
import { allowedOriginForRedirect, getJwtSecret, handleOptions, requireAuth, setCorsHeaders } from './_utils/security.js';

const resendApiKey = process.env.RESEND_API_KEY;

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
  } catch (error) {
    try {
      const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed.data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
      if (existing?.id) return existing.id;
    } catch (lookupError) {
      console.warn('[Auth Bridge] No se pudo consultar la identidad Supabase:', lookupError);
    }
    console.warn('[Auth Bridge] No se pudo vincular la identidad Supabase:', error);
    return null;
  }
}

async function getSupabaseSession(email: string, password: string) {
  if (!supabaseAuth) return null;
  try {
    const result = await supabaseAuth.auth.signInWithPassword({ email: email.toLowerCase(), password });
    return result.data.session || null;
  } catch (error) {
    console.warn('[Auth Bridge] No se pudo obtener sesión Supabase:', error);
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
  if (error) console.warn('[Auth Bridge] La columna auth_user_id aún no está disponible:', error.message);
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
    if (rawAction === 'register') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const { email, password, name, phone, restaurantName, plan } = req.body || {};
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
        console.error('Error creating user:', userError);
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
        console.error('Error creating tenant:', tenantError);
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
        console.error('Error creating subscription:', subError);
        return res.status(500).json({ error: 'Error al crear suscripción' });
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

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string };

      // Fetch user
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId)
        .single();

      if (userError || !user) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
      }

      // Fetch related tenant and subscription
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

      const mappedTenant = tenant ? {
        ...tenant,
        onboardingCompleted: tenant.onboarding_completed
      } : null;

      delete user.password_hash;

      return res.status(200).json({
        success: true,
        user,
        tenant: mappedTenant,
        subscription
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

      // Case 1: Update password with JWT token
      if (token && newPassword) {
        if (newPassword.length < 6) {
          return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        let decoded: any;
        try {
          decoded = jwt.verify(token, jwtSecret);
        } catch {
          return res.status(401).json({ error: 'El enlace es inválido o ha expirado.' });
        }

        const userId = decoded?.userId;
        if (!userId) {
          return res.status(401).json({ error: 'Token inválido.' });
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

        const authUserId = decoded.authUserId || resetUser.auth_user_id;
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
          .select('id, name, email, auth_user_id')
          .eq('email', normalizedEmail)
          .single();

        if (userError || !user) {
          return res.status(200).json({
            success: true,
            message: 'Si el correo existe, recibirás las instrucciones en breve.'
          });
        }

        const resetToken = jwt.sign(
          { userId: user.id, email: user.email, authUserId: user.auth_user_id || undefined },
          jwtSecret,
          { expiresIn: '1h' }
        );

        const origin = allowedOriginForRedirect(req.headers.origin);
        const resetLink = `${origin}/?resetToken=${resetToken}`;

        if (!resendApiKey) {
          console.error('[Password Reset] RESEND_API_KEY no configurada; no se envió correo.');
          return res.status(503).json({
            error: 'El servicio de correo no está configurado. El administrador debe configurar RESEND_API_KEY y RESEND_FROM_EMAIL.'
          });
        }

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
    console.error(`Auth router error for action '${rawAction}':`, err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
}
