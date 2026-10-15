import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import dotenv from 'dotenv';

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

interface SendInvoiceBody {
  to: string;
  customerName?: string;
  restaurantName?: string;
  clave: string;
  consecutivo: string;
  total: number;
  docType?: 'FE' | 'TE' | 'NC';
  xmlContent?: string;
}

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
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  const {
    to,
    customerName = 'Estimado Cliente',
    restaurantName = 'Restaurante',
    clave,
    consecutivo,
    total,
    docType = 'TE',
    xmlContent
  } = (req.body || {}) as SendInvoiceBody;

  if (!to || !clave) {
    return res.status(400).json({ error: 'Campos requeridos: "to" y "clave".' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('[Resend] RESEND_API_KEY no configurada. Simulando envío exitoso.');
    return res.status(200).json({
      success: true,
      simulated: true,
      message: 'Comprobante simulado (falta configurar RESEND_API_KEY en variables de entorno).'
    });
  }

  const docTypeName = docType === 'FE' 
    ? 'Factura Electrónica' 
    : docType === 'NC' 
    ? 'Nota de Crédito Electrónica' 
    : 'Tiquete Electrónico';

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fafaf9; margin: 0; padding: 20px; color: #1c1917; }
        .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #e7e5e4; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .header { background: #1c1917; color: #ffffff; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 800; color: #a9b994; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #d6d3d1; }
        .content { padding: 28px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #ecfdf5; color: #065f46; font-size: 12px; font-weight: 700; border: 1px solid #a7f3d0; margin-bottom: 16px; }
        .field { margin-bottom: 14px; }
        .label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #78716c; letter-spacing: 0.5px; }
        .value { font-size: 14px; font-weight: 600; color: #1c1917; margin-top: 2px; }
        .clave-box { background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 12px; padding: 12px; font-family: monospace; font-size: 11px; word-break: break-all; color: #44403c; margin: 16px 0; }
        .total-box { background: #1c1917; color: #ffffff; border-radius: 16px; padding: 18px; text-align: center; margin-top: 24px; }
        .total-label { font-size: 12px; color: #a8a29e; font-weight: 600; text-transform: uppercase; }
        .total-amount { font-size: 26px; font-weight: 900; color: #a9b994; margin-top: 4px; }
        .footer { text-align: center; font-size: 11px; color: #a8a29e; padding: 20px; border-top: 1px solid #f5f5f4; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${restaurantName}</h1>
          <p>Comprobante Electrónico Oficial • Hacienda Costa Rica v4.4</p>
        </div>
        <div class="content">
          <span class="badge">Aceptado por Hacienda ✓</span>
          <p style="font-size: 15px; margin: 0 0 16px 0;">Hola <strong>${customerName}</strong>,</p>
          <p style="font-size: 13px; color: #57534e; margin: 0 0 20px 0;">Adjuntamos el comprobante electrónico correspondiente a tu consumo en <strong>${restaurantName}</strong>.</p>
          
          <div class="field">
            <div class="label">Tipo de Comprobante</div>
            <div class="value">${docTypeName}</div>
          </div>
          <div class="field">
            <div class="label">Número Consecutivo</div>
            <div class="value">${consecutivo}</div>
          </div>
          <div class="field">
            <div class="label">Clave Numérica Oficial (50 dígitos)</div>
            <div class="clave-box">${clave}</div>
          </div>

          <div class="total-box">
            <div class="total-label">Monto Total Pagado</div>
            <div class="total-amount">CRC ₡${Number(total || 0).toLocaleString()}</div>
          </div>
        </div>
        <div class="footer">
          Generado automáticamente por SaborAI POS • Sistema de Facturación Electrónica para Restaurantes en Costa Rica.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const resend = new Resend(resendApiKey);
    const attachments: any[] = [];

    if (xmlContent) {
      attachments.push({
        filename: `${docType}_${clave}.xml`,
        content: Buffer.from(xmlContent, 'utf-8')
      });
    }

    const fromAddress = process.env.RESEND_FROM_EMAIL || 'facturacion@saborai.site';
    const emailResult = await resend.emails.send({
      from: `${restaurantName} <${fromAddress}>`,
      to: [to],
      subject: `Comprobante Electrónico ${consecutivo} - ${restaurantName}`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined
    });

    return res.status(200).json({
      success: true,
      messageId: emailResult.data?.id,
      recipient: to
    });
  } catch (emailErr: any) {
    console.error('[Resend Error]:', emailErr);
    return res.status(500).json({
      error: emailErr.message || 'Error al enviar correo mediante Resend.'
    });
  }
}
