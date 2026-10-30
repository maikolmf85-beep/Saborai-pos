import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { allowedOriginForRedirect, checkRateLimit, handleOptions, setCorsHeaders } from './_utils/security.js';
import { supabaseAdmin } from './_utils/supabase.js';
import { createTilopayTokenizationLink, processTilopaySubscription } from './_utils/tilopayClient.js';
import {
  createTilopaySignupHandoff,
  tilopayPaymentStore
} from './_utils/tilopaySignupHandoff.js';
import { PurchaseIntentError, tokenizeForPurchaseIntent } from './_utils/tilopayPurchaseFlow.js';

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 80);
}

function payloadRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

// Tipos requeridos
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = payloadRecord(req.body);
  const action = body.action;
  const payload = payloadRecord(body.payload);
  const isWebhook = req.query.action === 'webhook' || action === 'webhook' ||
    !!req.headers['x-tilopay-signature'] || !!body.event;

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

    if (!isSignatureValid) return res.status(401).json({ error: 'Invalid HMAC Signature' });

    const { event, tenant_id, amount, currency, transaction_id, event_id } = body;
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
        payload: body,
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

  const ip = clientIp(req);

  if (action === 'create-signup-handoff') {
    if (!checkRateLimit(`tilopay-handoff:${ip}`, 10, 60000).allowed) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.' });
    }

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const restaurantName = typeof payload.restaurantName === 'string' ? payload.restaurantName.trim() : '';
    const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';

    if (
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 6 || password.length > 256 ||
      !restaurantName || restaurantName.length > 120 ||
      !phone || phone.length > 40
    ) {
      return res.status(400).json({ error: 'Los datos de registro no son válidos.' });
    }

    try {
      const reference = await createTilopaySignupHandoff({
        email,
        password,
        name: restaurantName,
        phone,
        restaurantName,
        // Precio/moneda/plan no se aceptan del navegador; el alta actual es Pro CRC.
        plan: 'pro'
      });
      return res.status(200).json({ reference });
    } catch {
      console.error('[Tilopay] No se pudo crear la intención de compra.');
      return res.status(500).json({ error: 'No se pudo iniciar el registro seguro.' });
    }
  }

  if (action === 'tokenize') {
    if (!checkRateLimit(`tilopay-tokenize:${ip}`, 10, 60000).allowed) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.' });
    }
    const reference = payload.reference;
    const origin = allowedOriginForRedirect(typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
    const redirect = new URL('/', origin);
    redirect.searchParams.set('tilopay_success', 'true');
    if (typeof reference === 'string') redirect.searchParams.set('ref', reference);

    try {
      const url = await tokenizeForPurchaseIntent(
        reference,
        redirect.toString(),
        tilopayPaymentStore,
        { tokenize: createTilopayTokenizationLink }
      );
      return res.status(200).json({ url });
    } catch (error) {
      if (error instanceof PurchaseIntentError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('[Tilopay] No se pudo tokenizar la intención.');
      return res.status(500).json({ error: 'No se pudo generar el link de pago.' });
    }
  }

  if (action === 'subscribe') {
    if (!checkRateLimit(`tilopay-subscribe:${ip}`, 10, 60000).allowed) {
      return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.' });
    }

    // La petición pública solo puede aportar la referencia opaca y el token;
    // campos extra como plan, email, importe o moneda se ignoran deliberadamente.
    try {
      const subscription = await processTilopaySubscription({
        reference: payload.reference,
        token: payload.token
      });

      if (!subscription.success) {
        return res.status(202).json({
          success: false,
          pending: true,
          planId: subscription.planId,
          amount: subscription.amount,
          currency: subscription.currency
        });
      }

      return res.status(200).json({
        success: true,
        transactionId: subscription.transactionId,
        idempotent: subscription.idempotent,
        planId: subscription.planId,
        amount: subscription.amount,
        currency: subscription.currency,
        message: `Suscripción al plan '${subscription.planId}' procesada correctamente vía Tilopay.`
      });
    } catch (error) {
      if (error instanceof PurchaseIntentError) {
        return res.status(error.statusCode).json({ success: false, error: error.message });
      }
      console.error('[Tilopay] No se pudo verificar el resultado del cobro.');
      return res.status(500).json({ success: false, error: 'No se pudo verificar el resultado del pago.' });
    }
  }

  return res.status(400).json({ error: 'Acción no soportada.' });
}
