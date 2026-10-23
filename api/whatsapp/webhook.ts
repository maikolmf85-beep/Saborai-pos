import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createHmac, timingSafeEqual } from 'node:crypto';

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0';
const processedMessageIds = new Set<string>();

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
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const text = response.text?.trim();
      if (text) return text.slice(0, 3500);
    } catch (error) {
      lastError = error;
    }
  }

  console.error('[WhatsApp] Gemini no pudo responder:', lastError);
  return 'Recibí tu mensaje, pero Nyza está temporalmente ocupada. Intenta nuevamente en unos minutos o deja el detalle del problema para que soporte humano lo revise.';
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

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WhatsApp Graph API ${response.status}: ${detail.slice(0, 500)}`);
  }
}

function hasValidMetaSignature(req: VercelRequest): boolean {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) return true;

  const signature = String(req.headers['x-hub-signature-256'] || '');
  const rawBody = (req as VercelRequest & { rawBody?: Buffer }).rawBody;
  if (!signature || !rawBody) return false;

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
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verificación de webhook rechazada.');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  if (!hasValidMetaSignature(req)) {
    return res.status(401).json({ error: 'Firma de Meta inválida.' });
  }

  // Meta espera una respuesta rápida; el procesamiento continúa antes de cerrar
  // la solicitud para conservar compatibilidad con funciones serverless sencillas.
  const message = getTextMessage(req.body);
  if (!message) return res.status(200).json({ received: true, ignored: true });
  if (message.messageId && processedMessageIds.has(message.messageId)) {
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (message.messageId) processedMessageIds.add(message.messageId);

  try {
    const reply = await generateSupportReply(message.text);
    await sendWhatsAppText(message.from, reply);
    return res.status(200).json({ received: true, replied: true });
  } catch (error: any) {
    console.error('[WhatsApp] Error procesando mensaje:', error?.message || error);
    return res.status(200).json({ received: true, replied: false });
  }
}
