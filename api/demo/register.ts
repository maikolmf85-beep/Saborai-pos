import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY;

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  try {
    // 1. Guardar el correo en Supabase en la tabla demo_leads (o users si se prefiere)
    // Asumimos que el cliente creará la tabla demo_leads con una columna email.
    const { error: dbError } = await supabase
      .from('demo_leads')
      .insert([{ email: email.toLowerCase() }]);

    if (dbError) {
      console.warn('No se pudo guardar el lead en Supabase (asegúrate de crear la tabla demo_leads):', dbError.message);
    }

    // 2. Enviar el correo de bienvenida usando Resend
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

  } catch (error: any) {
    console.error('Error en demo/register:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
