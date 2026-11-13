import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Vercel debe entregar el stream intacto para que la firma se valide sobre
// exactamente los bytes recibidos, antes de interpretar el JSON.
export const config = { api: { bodyParser: false } };

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0';
const processedMessageIds = new Set<string>();

type WebhookLogEvent =
  | 'verification_accepted'
  | 'verification_rejected'
  | 'method_rejected'
  | 'post_received'
  | 'body_read_failed'
  | 'signature_rejected'
  | 'payload_rejected'
  | 'event_ignored'
  | 'duplicate_ignored'
  | 'message_accepted'
  | 'reply_generated'
  | 'reply_sent'
  | 'reply_generation_failed'
  | 'reply_send_failed';

function logWebhook(event: WebhookLogEvent, level: 'info' | 'error' = 'info', statusCode?: number): void {
  const entry: { component: 'whatsapp-webhook'; event: WebhookLogEvent; statusCode?: number } = {
    component: 'whatsapp-webhook',
    event
  };
  if (statusCode !== undefined) entry.statusCode = statusCode;
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.info(line);
}

function getTextMessage(body: any): { from: string; text: string; messageId: string } | null {
  const change = body?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  if (!message || message.type !== 'text' || !message.from || !message.text?.body) return null;
  return {
    from: String(message.from),
    text: String(message.text.body).trim(),
    messageId: String(message.id || '')
  };
}

async function generateSupportReply(userText: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return 'En este momento el soporte inteligente no está configurado. Por favor, deja tu mensaje y un integrante de Saborai te ayudará pronto.';
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Eres Nyza, asistente oficial de soporte de Saborai POS para restaurantes en Costa Rica.
Responde en español claro, amable y breve. Ayuda con configuración del POS, salones, mesas, turnos, comandas, menú, inventario, facturación electrónica y uso general del sistema.
No inventes accesos, precios, estados de cuenta ni soluciones que requieran entrar al restaurante. Nunca pidas contraseñas, tokens, claves de Hacienda ni datos de tarjetas.
Si el caso requiere revisión humana, dilo claramente y solicita una descripción del problema sin información sensible.
No afirmes que ejecutaste cambios dentro del POS: por WhatsApp solo puedes orientar.

Pregunta del usuario:
${userText}`;

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const text = response.text?.trim();
      if (text) return text.slice(0, 3500);
    } catch {}
  }

  logWebhook('reply_generation_failed', 'error');
  return 'Recibí tu mensaje, pero Nyza está temporalmente ocupada. Intenta nuevamente en unos minutos o deja el detalle del problema para que soporte humano lo revise.';
}

class WhatsAppGraphApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super('WhatsApp Graph API request failed.');
    this.statusCode = statusCode;
    this.name = 'WhatsAppGraphApiError';
  }
}

async function sendWhatsAppText(to: string, text: string): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) {
    throw new Error('Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.');
  }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    })
  });

  if (!response.ok) throw new WhatsAppGraphApiError(response.status);
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function hasValidMetaSignature(req: VercelRequest, rawBody: Buffer): boolean {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) return false;

  const signature = req.headers['x-hub-signature-256'];
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logWebhook('verification_accepted');
      return res.status(200).send(challenge);
    }
    logWebhook('verification_rejected', 'error');
    return res.status(403).send('Verificación de webhook rechazada.');
  }

  if (req.method !== 'POST') {
    logWebhook('method_rejected');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  logWebhook('post_received');
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch {
    logWebhook('body_read_failed', 'error');
    return res.status(400).json({ error: 'No se pudo leer la solicitud.' });
  }

  if (!hasValidMetaSignature(req, rawBody)) {
    logWebhook('signature_rejected', 'error');
    return res.status(401).json({ error: 'Firma de Meta inválida.' });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logWebhook('payload_rejected', 'error');
    return res.status(400).json({ error: 'El JSON de la solicitud no es válido.' });
  }

  // Meta espera una respuesta rápida; el procesamiento continúa antes de cerrar
  // la solicitud para conservar compatibilidad con funciones serverless sencillas.
  const message = getTextMessage(body);
  if (!message) {
    logWebhook('event_ignored');
    return res.status(200).json({ received: true, ignored: true });
  }
  if (message.messageId && processedMessageIds.has(message.messageId)) {
    logWebhook('duplicate_ignored');
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (message.messageId) processedMessageIds.add(message.messageId);

  logWebhook('message_accepted');
  let stage: 'generation' | 'send' = 'generation';
  try {
    const reply = await generateSupportReply(message.text);
    logWebhook('reply_generated');
    stage = 'send';
    await sendWhatsAppText(message.from, reply);
    logWebhook('reply_sent');
    return res.status(200).json({ received: true, replied: true });
  } catch (error: unknown) {
    if (stage === 'generation') {
      logWebhook('reply_generation_failed', 'error');
    } else {
      const statusCode = error instanceof WhatsAppGraphApiError ? error.statusCode : undefined;
      logWebhook('reply_send_failed', 'error', statusCode);
    }
    return res.status(200).json({ received: true, replied: false });
  }
}
