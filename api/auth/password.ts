import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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

  const { email, token, newPassword } = (req.body as any) || {};

  // Caso 1: Actualizar contraseña con token JWT
  if (token && newPassword) {
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
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

      const { error: updateError } = await supabase
        .from('users')
        .update({ password_hash: hashedPassword })
        .eq('id', userId);

      if (updateError) {
        console.error('Error actualizando contraseña:', updateError);
        return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' 
      });
    } catch (error: any) {
      console.error('Error en update-password:', error);
      return res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }

  // Caso 2: Solicitar restablecimiento de contraseña por correo
  if (email) {
    try {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('email', email)
        .single();

      if (userError || !user) {
        return res.status(200).json({ 
          success: true, 
          message: 'Si el correo existe, recibirás las instrucciones en breve.' 
        });
      }

      const resetToken = jwt.sign(
        { userId: user.id, email: user.email },
        jwtSecret,
        { expiresIn: '1h' }
      );

      const origin = req.headers.origin || 'https://pos.saborai.site';
      const resetLink = `${origin}/?resetToken=${resetToken}`;

      if (!resendApiKey) {
        console.warn('[Simulación de Envío] RESEND_API_KEY no configurado.');
        return res.status(200).json({ 
          success: true, 
          message: 'API Key no configurada. Revisa la consola para ver el enlace simulado.' 
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
        return res.status(500).json({ 
          error: 'Error al enviar el correo electrónico.',
          details: emailResponse.error.message
        });
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

  return res.status(400).json({ error: 'Parámetros inválidos. Se requiere email o token con newPassword.' });
}
