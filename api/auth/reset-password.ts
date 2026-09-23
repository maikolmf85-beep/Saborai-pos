import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-for-development';
const resendApiKey = process.env.RESEND_API_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase configuration is missing.' });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Buscar al usuario
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('email', email)
      .single();

    if (userError || !user) {
      // Por seguridad, no decimos si existe o no el correo para evitar enumeración.
      // Retornamos éxito de todos modos.
      return res.status(200).json({ 
        success: true, 
        message: 'Si el correo existe, recibirás las instrucciones en breve.' 
      });
    }

    // 2. Crear un token JWT válido por 1 hora
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Generar enlace de recuperación
    // En producción deberías usar el host real, por ahora podemos armarlo relativo
    // o asumiendo el dominio pos.saborai.site
    const origin = req.headers.origin || 'https://pos.saborai.site';
    const resetLink = `${origin}/?resetToken=${token}`;

    // 4. Enviar el correo usando Resend
    if (!resendApiKey) {
      console.warn('[Simulación de Envío] RESEND_API_KEY no configurado.');
      console.log(`Enlace generado para ${email}: ${resetLink}`);
      // Si no hay key, igual retornamos éxito en desarrollo
      return res.status(200).json({ 
        success: true, 
        message: 'API Key no configurada. Revisa la consola para ver el enlace simulado.' 
      });
    }

    const resend = new Resend(resendApiKey);

    const emailResponse = await resend.emails.send({
      from: 'Soporte Saborai <onboarding@resend.dev>', // Por defecto en modo de prueba de Resend
      to: email,
      subject: 'Recuperación de contraseña - Saborai POS',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3b3733;">
          <h2 style="color: #a9b994;">Saborai POS</h2>
          <p>Hola ${user.name},</p>
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
      return res.status(500).json({ error: 'Error al enviar el correo electrónico.' });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Te hemos enviado las instrucciones a tu correo electrónico.' 
    });

  } catch (error: any) {
    console.error('Error en reset-password:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
