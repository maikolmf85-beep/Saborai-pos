import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { extractCoexistenceEvents, type CoexistenceEvent } from '../../lib/whatsapp/coexistence.js';
import { normalizeCoexistenceEvents, type NormalizedCoexistenceMessage } from '../../lib/whatsapp/coexistenceInbox.js';
import {
  createGeminiEmptyResponseTelemetry,
  createSafeGeminiFailureTelemetry,
  createMissingGeminiKeyTelemetry,
  extractSafeGraphApiError,
  type GeminiFailureTelemetry,
  type GeminiModelLabel,
  type SafeGraphApiError
} from '../_utils/whatsappErrorTelemetry.js';

// Vercel debe entregar el stream intacto para que la firma se valide sobre
// exactamente los bytes recibidos, antes de interpretar el JSON.
export const config = { api: { bodyParser: false }, maxDuration: 30 };

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0';
const processedMessageIds = new Set<string>();
const MODEL_REQUEST_TIMEOUT_MS = 7000;
const GENERATION_TIMEOUT_MS = 9000;
const WHATSAPP_SEND_TIMEOUT_MS = 8000;

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
  | 'gemini_attempt_failed'
  | 'reply_generation_failed'
  | 'reply_send_failed'
  | 'coexistence_events_processed'
  | 'coexistence_inbox_processed'
  | 'coexistence_persist_failed';

type WebhookMetrics = {
  normalized?: number;
  imported?: number;
  skipped?: number;
  duplicates?: number;
  contactStatePendingSchema?: number;
};

type GeminiGenerateContent = (params: Parameters<GoogleGenAI['models']['generateContent']>[0]) => ReturnType<GoogleGenAI['models']['generateContent']>;

function logWebhook(
  event: WebhookLogEvent,
  level: 'info' | 'error' = 'info',
  statusCode?: number,
  metrics?: WebhookMetrics,
  providerError?: SafeGraphApiError
): void {
  const entry: { component: 'whatsapp-webhook'; event: WebhookLogEvent; statusCode?: number; metrics?: WebhookMetrics; providerError?: SafeGraphApiError } = {
    component: 'whatsapp-webhook',
    event
  };
  if (statusCode !== undefined) entry.statusCode = statusCode;
  if (metrics) entry.metrics = metrics;
  if (providerError) entry.providerError = providerError;
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.info(line);
}

function logGeminiDiagnostic(event: 'gemini_attempt_failed' | 'reply_generation_failed', gemini: GeminiFailureTelemetry): void {
  const line = JSON.stringify({ component: 'whatsapp-webhook', event, gemini });
  console.error(line);
}

function getTextMessage(body: any): { from: string; text: string; messageId: string } | null {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const message = change?.value?.messages?.[0];
      if (!message || message.type !== 'text' || !message.from || !message.text?.body) continue;
      return {
        from: String(message.from),
        text: String(message.text.body).trim(),
        messageId: String(message.id || '')
      };
    }
  }
  return null;
}

async function generateSupportReply(userText: string, generateContentOverride?: GeminiGenerateContent): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    logGeminiDiagnostic('reply_generation_failed', createMissingGeminiKeyTelemetry(GENERATION_TIMEOUT_MS));
    return 'En este momento el soporte inteligente no está configurado. Por favor, deja tu mensaje y un integrante de Saborai te ayudará pronto.';
  }

  const ai = new GoogleGenAI({ apiKey });
  const generationSignal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
  const prompt = `Eres Nyza, asistente oficial de soporte de Saborai POS para restaurantes en Costa Rica.
Responde en español claro, amable y breve. Ayuda con configuración del POS, salones, mesas, turnos, comandas, menú, inventario, facturación electrónica y uso general del sistema.
No inventes accesos, precios, estados de cuenta ni soluciones que requieran entrar al restaurante. Nunca pidas contraseñas, tokens, claves de Hacienda ni datos de tarjetas.
Si el caso requiere revisión humana, dilo claramente y solicita una descripción del problema sin información sensible.
No afirmes que ejecutaste cambios dentro del POS: por WhatsApp solo puedes orientar.

Pregunta del usuario:
${userText}`;

  const models: Exclude<GeminiModelLabel, 'not_attempted'>[] = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  for (const model of models) {
    try {
      const request = {
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          abortSignal: generationSignal,
          httpOptions: {
            timeout: MODEL_REQUEST_TIMEOUT_MS,
            retryOptions: { attempts: 1 }
          },
          maxOutputTokens: 512
        }
      };
      const generateContent = generateContentOverride || ((params) => ai.models.generateContent(params));
      const response = await generateContent(request);
      const text = response.text?.trim();
      if (text) return text.slice(0, 3500);
      logGeminiDiagnostic('gemini_attempt_failed', createGeminiEmptyResponseTelemetry(model, MODEL_REQUEST_TIMEOUT_MS, GENERATION_TIMEOUT_MS, 1));
    } catch (error: unknown) {
      logGeminiDiagnostic('gemini_attempt_failed', createSafeGeminiFailureTelemetry(error, model, MODEL_REQUEST_TIMEOUT_MS, GENERATION_TIMEOUT_MS, 1));
    }
  }

  logWebhook('reply_generation_failed', 'error');
  return 'Recibí tu mensaje, pero Nyza está temporalmente ocupada. Intenta nuevamente en unos minutos o deja el detalle del problema para que soporte humano lo revise.';
}

class WhatsAppGraphApiError extends Error {
  readonly statusCode: number;
  readonly safeDetails: SafeGraphApiError;

  constructor(statusCode: number, safeDetails: SafeGraphApiError) {
    super('WhatsApp Graph API request failed.');
    this.statusCode = statusCode;
    this.safeDetails = safeDetails;
    this.name = 'WhatsAppGraphApiError';
  }
}

async function sendWhatsAppText(to: string, text: string, graphApiFetch: typeof fetch = fetch): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) {
    throw new Error('Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.');
  }

  const response = await graphApiFetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      messaging_account_id: '1845701716552385',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    }),
    signal: AbortSignal.timeout(WHATSAPP_SEND_TIMEOUT_MS)
  });

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    throw new WhatsAppGraphApiError(response.status, extractSafeGraphApiError(payload));
  }
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

async function persistCoexistenceEventsInDatabase(events: CoexistenceEvent[]): Promise<void> {
  const [{ supabaseAdmin }, { persistCoexistenceEvents }] = await Promise.all([
    import('../_utils/supabase.js'),
    import('../../lib/whatsapp/coexistence.js')
  ]);
  await persistCoexistenceEvents(supabaseAdmin, events, {
    configuredPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
    configuredTenantId: process.env.WHATSAPP_TENANT_ID?.trim()
  });
}

async function persistNormalizedCoexistenceMessagesInDatabase(messages: NormalizedCoexistenceMessage[]): Promise<{ imported: number; skipped_unverified_tenant: number }> {
  if (messages.length === 0) return { imported: 0, skipped_unverified_tenant: 0 };
  const [{ supabaseAdmin }, { persistNormalizedCoexistenceMessages }] = await Promise.all([
    import('../_utils/supabase.js'),
    import('../../lib/whatsapp/coexistenceInbox.js')
  ]);
  return persistNormalizedCoexistenceMessages(supabaseAdmin, messages);
}

export interface WebhookDependencies {
  persistCoexistenceEvents?: (events: CoexistenceEvent[]) => Promise<void>;
  persistNormalizedCoexistenceMessages?: (messages: NormalizedCoexistenceMessage[]) => Promise<{ imported: number; skipped_unverified_tenant: number }>;
  generateSupportReply?: (userText: string) => Promise<string>;
  generateGeminiContent?: GeminiGenerateContent;
  sendWhatsAppText?: (to: string, text: string) => Promise<void>;
  graphApiFetch?: typeof fetch;
}

export function createWebhookHandler(dependencies: WebhookDependencies = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
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

    const coexistence = extractCoexistenceEvents(body);
    if (coexistence.invalid) {
      logWebhook('payload_rejected', 'error');
      return res.status(400).json({ error: 'El evento de coexistencia no tiene el formato esperado.' });
    }

    if (coexistence.events.length > 0) {
      try {
        const normalized = normalizeCoexistenceEvents(coexistence.events);
        const persist = dependencies.persistCoexistenceEvents || persistCoexistenceEventsInDatabase;
        await persist(coexistence.events);
        logWebhook('coexistence_events_processed');
        const persistInbox = dependencies.persistNormalizedCoexistenceMessages || persistNormalizedCoexistenceMessagesInDatabase;
        const inboxResult = await persistInbox(normalized.messages);
        const skipped = Object.values(normalized.skipped_by_reason).reduce((total, count) => total + count, 0)
          + inboxResult.skipped_unverified_tenant;
        logWebhook('coexistence_inbox_processed', 'info', undefined, {
          normalized: normalized.messages.length,
          imported: inboxResult.imported,
          skipped,
          duplicates: normalized.duplicate_message_ids,
          contactStatePendingSchema: normalized.contact_state_items
        });
      } catch {
        // No imprimir errores del proveedor: podrían contener detalles del payload.
        logWebhook('coexistence_persist_failed', 'error');
        return res.status(500).json({ error: 'No se pudieron registrar los eventos de coexistencia.' });
      }
    }

    // Meta espera una respuesta rápida; el procesamiento termina antes de cerrar
    // la solicitud para que un fallo de persistencia provoque un reintento.
    const message = getTextMessage(body);
    if (!message) {
      if (coexistence.events.length > 0) {
        return res.status(200).json({ received: true, coexistenceEvents: coexistence.events.length });
      }
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
      const generateReply = dependencies.generateSupportReply || ((userText) => generateSupportReply(userText, dependencies.generateGeminiContent));
      const sendReply = dependencies.sendWhatsAppText || ((to, text) => sendWhatsAppText(to, text, dependencies.graphApiFetch || fetch));
      const reply = await generateReply(message.text);
      logWebhook('reply_generated');
      stage = 'send';
      await sendReply(message.from, reply);
      logWebhook('reply_sent');
      return res.status(200).json({ received: true, replied: true });
    } catch (error: unknown) {
      // Si no se completó el procesamiento, permite que el reintento de Meta
      // vuelva a intentar responder en lugar de ignorarlo como duplicado.
      if (message.messageId) processedMessageIds.delete(message.messageId);
      if (stage === 'generation') {
        logWebhook('reply_generation_failed', 'error');
      } else {
        const graphApiError = error instanceof WhatsAppGraphApiError ? error : undefined;
        logWebhook('reply_send_failed', 'error', graphApiError?.statusCode, undefined, graphApiError?.safeDetails);
      }
      return res.status(500).json({ received: true, replied: false });
    }
  };
}

export default createWebhookHandler();
