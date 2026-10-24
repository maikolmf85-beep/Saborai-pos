import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { handleOptions, setCorsHeaders } from './_utils/security.js';
import { supabaseAdmin } from './_utils/supabase.js';

// Tipos requeridos
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

    const { event, tenant_id, amount, currency, transaction_id, event_id } = req.body || {};
    const eventId = String(event_id || transaction_id || crypto
      .createHash('sha256')
      .update(rawBody)
      .digest('hex'));
    console.log(`[Tilopay Webhook] Received ${event} for tenant ${tenant_id} - Tx: ${transaction_id} (${currency} ${amount})`);

    // Registrar primero el evento: la restricción UNIQUE evita renovar dos veces
    // una suscripción cuando TiloPay reintenta el webhook.
    const { error: eventError } = await supabaseAdmin
      .from('subscription_webhook_events')
      .insert({
        event_id: eventId,
        event_type: String(event || 'unknown'),
        tenant_id: tenant_id || null,
        transaction_id: transaction_id || null,
        amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
        currency: currency || null,
        payload: req.body || {},
        processing_status: 'RECEIVED'
      });

    if (eventError?.code === '23505') {
      return res.status(200).json({ success: true, duplicate: true, event_id: eventId });
    }
    if (eventError) {
      console.error('[Tilopay Webhook] No se pudo registrar el evento:', eventError);
      return res.status(500).json({ error: 'No se pudo registrar el webhook.' });
    }

    let subscriptionMode: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null = null;
    if (event === 'transaction.success') subscriptionMode = 'ACTIVE';
    if (event === 'transaction.failed') subscriptionMode = 'PAST_DUE';
    if (event === 'subscription_cancelled') subscriptionMode = 'CANCELLED';

    if (subscriptionMode && tenant_id) {
      const { error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .update({
          mode: subscriptionMode,
          ...(subscriptionMode === 'ACTIVE'
            ? { activated_at: new Date().toISOString(), trial_ends_at: null }
            : {})
        })
        .eq('tenant_id', tenant_id);

      if (subscriptionError) {
        await supabaseAdmin
          .from('subscription_webhook_events')
          .update({ processing_status: 'FAILED', error_message: subscriptionError.message })
          .eq('event_id', eventId);
        console.error('[Tilopay Webhook] Error actualizando suscripción:', subscriptionError);
        return res.status(500).json({ error: 'No se pudo actualizar la suscripción.' });
      }
    }

    const { error: processedError } = await supabaseAdmin
      .from('subscription_webhook_events')
      .update({ processing_status: 'PROCESSED', processed_at: new Date().toISOString() })
      .eq('event_id', eventId);

    if (processedError) {
      console.error('[Tilopay Webhook] Error marcando evento procesado:', processedError);
      return res.status(500).json({ error: 'El webhook fue aplicado pero no pudo cerrarse.' });
    }

    return res.status(200).json({
      success: true,
      status: subscriptionMode || 'RECEIVED',
      event_id: eventId,
      transaction_id
    });
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
