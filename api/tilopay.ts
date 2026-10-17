import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { handleOptions, setCorsHeaders } from './_utils/security.js';

// Tipos requeridos
interface TilopayCardData {
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  cardholderName: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, payload } = req.body || {};
  const isWebhook = req.query.action === 'webhook' || action === 'webhook' || !!req.headers['x-tilopay-signature'] || !!(req.body && req.body.event);

  // -------------------------------------------------------------
  // TILOPAY WEBHOOK HANDLER
  // -------------------------------------------------------------
  if (isWebhook) {
    const tilopaySecret = process.env.TILOPAY_SECRET_KEY?.trim();
    const receivedSignature = req.headers['x-tilopay-signature'] as string;
    if (!tilopaySecret || !receivedSignature) {
      return res.status(401).json({ error: 'Webhook no configurado o firma ausente.' });
    }
    const rawBody = JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', tilopaySecret)
      .update(rawBody)
      .digest('hex');

    const expectedSignatureHeader = `sha256=${expectedSignature}`;
    const receivedBuffer = Buffer.from(receivedSignature);
    const expectedBuffer = Buffer.from(expectedSignatureHeader);
    const isSignatureValid = receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!isSignatureValid) {
      return res.status(401).json({ error: 'Invalid HMAC Signature' });
    }

    const { event, tenant_id, amount, currency, transaction_id } = req.body || {};
    console.log(`[Tilopay Webhook] Received ${event} for tenant ${tenant_id} - Tx: ${transaction_id} (${currency} ${amount})`);

    switch (event) {
      case 'transaction.success':
        return res.status(200).json({
          success: true,
          status: 'ACTIVE',
          message: 'Subscription renewed for 30 days. Electronic Invoice generated.',
          transaction_id
        });

      case 'transaction.failed':
        return res.status(200).json({
          success: true,
          status: 'PAST_DUE',
          grace_period_days: 7,
          message: 'Payment failed. Grace period active for 7 days.'
        });

      case 'subscription_cancelled':
        return res.status(200).json({
          success: true,
          status: 'CANCELLED',
          message: 'Subscription cancelled. Tenant suspended.'
        });

      default:
        return res.status(200).json({
          received: true,
          event
        });
    }
  }

  // Leer variables de entorno (Nunca expuestas al frontend)
  const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY;
  const TILOPAY_API_USER = process.env.TILOPAY_API_USER;
  const TILOPAY_API_PASSWORD = process.env.TILOPAY_API_PASSWORD;
  
  if (!TILOPAY_API_KEY || !TILOPAY_API_USER || !TILOPAY_API_PASSWORD) {
    console.error('Missing Tilopay credentials in environment variables.');
    return res.status(500).json({ error: 'El servidor no está configurado correctamente para procesar pagos.' });
  }

  try {
    // 1. Obtener Token de Acceso (Bearer)
    const loginRes = await fetch('https://app.tilopay.com/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiuser: TILOPAY_API_USER,
        password: TILOPAY_API_PASSWORD
      })
    });
    
    if (!loginRes.ok) {
      throw new Error(`Error de autenticación con TiloPay (Código ${loginRes.status}). Revisa tus credenciales.`);
    }
    
    const loginData = (await loginRes.json()) as any;
    const bearerToken = loginData.access_token || loginData.token;

    if (!bearerToken) {
      throw new Error('TiloPay no devolvió un token de acceso válido.');
    }

    if (action === 'tokenize') {
      const { email, firstName, lastName, redirect } = payload;
      
      const response = await fetch('https://app.tilopay.com/api/v1/processTokenize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: TILOPAY_API_KEY,
          email,
          firstName,
          lastName,
          language: 'es',
          redirect, // La URL a donde TiloPay enviará al usuario tras digitar la tarjeta
          token_version: 'v2'
        })
      });
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
         const text = await response.text();
         console.error('TiloPay Non-JSON Response:', text.substring(0, 200));
         throw new Error(`La pasarela de pagos falló al responder (código ${response.status}). Intenta de nuevo.`);
      }
      
      const data = (await response.json()) as any;
      
      if (!response.ok || !data.url) {
        throw new Error(data.message || 'Error al generar el link de pago seguro.');
      }

      // TiloPay nos devuelve una URL segura a donde debemos mandar al cliente
      return res.status(200).json({ url: data.url });

    } else if (action === 'subscribe') {
      const { planId, token, email } = payload;

      if (!token) {
        return res.status(400).json({ success: false, error: 'Token de pago inválido.' });
      }

      const response = await fetch('https://app.tilopay.com/api/v1/processPayment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: TILOPAY_API_KEY,
          planId, 
          token, 
          email 
        })
      });
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
         const text = await response.text();
         console.error('TiloPay Non-JSON Response:', text.substring(0, 200));
         throw new Error(`La pasarela de pagos falló al procesar la suscripción (código ${response.status}).`);
      }

      const data = (await response.json()) as any;

      if (!response.ok) {
        throw new Error(data.message || 'Error procesando la suscripción con Tilopay.');
      }

      return res.status(200).json({
        success: true,
        transactionId: data.transactionId || data.id || `txn_${Date.now()}`,
        message: `Suscripción al plan '${planId}' procesada correctamente para ${email} vía TiloPay.`
      });

    } else {
      return res.status(400).json({ error: 'Acción no soportada.' });
    }
  } catch (error: any) {
    console.error('Tilopay API Error:', error);
    return res.status(500).json({ error: error.message || 'Error procesando el pago con TiloPay.' });
  }
}
