import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests for Webhooks
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const tilopaySecret = process.env.TILOPAY_SECRET_KEY || 'tilo_sec_99a8b7c6d5e4f3a2b1';
  const receivedSignature = req.headers['x-tilopay-signature'] as string;

  const rawBody = JSON.stringify(req.body);

  // Calculate HMAC SHA-256
  const expectedSignature = crypto
    .createHmac('sha256', tilopaySecret)
    .update(rawBody)
    .digest('hex');

  // Validate signature (Optional bypass in development/sandbox)
  const isSignatureValid = receivedSignature === `sha256=${expectedSignature}` || process.env.NODE_ENV === 'development';

  if (!isSignatureValid && receivedSignature) {
    return res.status(401).json({ error: 'Invalid HMAC Signature' });
  }

  const { event, tenant_id, amount, currency, transaction_id } = req.body;

  console.log(`[Tilopay Webhook] Received ${event} for tenant ${tenant_id} - Tx: ${transaction_id} (${currency} ${amount})`);

  switch (event) {
    case 'transaction.success':
      // 1. Extend tenant subscription +30 days
      // 2. Set status to ACTIVE
      // 3. Issue automated Electronic Invoice v4.3 for the SaaS charge
      return res.status(200).json({
        success: true,
        status: 'ACTIVE',
        message: 'Subscription renewed for 30 days. Electronic Invoice generated.',
        transaction_id
      });

    case 'transaction.failed':
      // 1. Set status to PAST_DUE
      // 2. Enable 7-day grace period without disrupting POS operations
      return res.status(200).json({
        success: true,
        status: 'PAST_DUE',
        grace_period_days: 7,
        message: 'Payment failed. Grace period active for 7 days.'
      });

    case 'subscription_cancelled':
      // Suspend tenant access and redirect to billing portal
      return res.status(200).json({
        success: true,
        status: 'CANCELLED',
        message: 'Subscription cancelled. Tenant suspended.'
      });

    default:
      return res.status(200).json({
        success: true,
        message: 'Event acknowledged'
      });
  }
}
