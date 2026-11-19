import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_SUPPORT_EMAIL = 'soporte@saborai.site';
export const DEFAULT_ESCALATION_EMAIL = 'maikolr85@outlook.es';
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
export const MAX_SUPPORT_BODY_CHARS = 12_000;

export type HeaderMap = Record<string, string | string[] | undefined>;

export interface ReceivedEmailEvent {
  type?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
  };
}

export interface RetrievedEmail {
  from?: string;
  to?: string[];
  received_for?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  message_id?: string;
  headers?: Record<string, unknown> | null;
}

export interface OutgoingSupportEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface SupportProcessingOptions {
  supportEmail: string;
  inboundAliases?: string[];
  fromEmail: string;
  escalationEmail: string;
}

export interface SupportProcessingDependencies {
  retrieveEmail: (emailId: string) => Promise<RetrievedEmail>;
  sendEmail: (email: OutgoingSupportEmail, idempotencyKey: string) => Promise<void>;
  generateReply: (subject: string, body: string) => Promise<string>;
}

export type SupportClassification = 'routine' | 'critical' | 'ignore';

function headerValue(headers: HeaderMap, name: string): string {
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  const value = Array.isArray(entry) ? entry[0] : entry;
  return typeof value === 'string' ? value.trim() : '';
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Verify Resend's Svix signature over the exact raw request body and reject old replays. */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: HeaderMap,
  webhookSecret: string,
  nowMs = Date.now(),
  toleranceSeconds = 300
): boolean {
  const id = headerValue(headers, 'svix-id') || headerValue(headers, 'webhook-id');
  const timestamp = headerValue(headers, 'svix-timestamp') || headerValue(headers, 'webhook-timestamp');
  const signature = headerValue(headers, 'svix-signature') || headerValue(headers, 'webhook-signature');
  const secretValue = webhookSecret.trim();
  if (!id || !timestamp || !signature || !secretValue.startsWith('whsec_')) return false;
  const hasUnsafeControl = [...id].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 0 || codePoint === 10 || codePoint === 13;
  });
  if (id.length > 200 || hasUnsafeControl) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const encodedKey = secretValue.slice('whsec_'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) return false;
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return signature.split(/\s+/).some((versionedSignature) => {
    const comma = versionedSignature.indexOf(',');
    if (comma < 0 || versionedSignature.slice(0, comma) !== 'v1') return false;
    return constantTimeEqual(versionedSignature.slice(comma + 1), expected);
  });
}

export async function readRawRequestBody(
  request: AsyncIterable<unknown> & { rawBody?: unknown },
  maxBytes = MAX_WEBHOOK_BODY_BYTES
): Promise<string> {
  const rawBody = request.rawBody;
  if (typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) {
    const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    if (buffer.length > maxBytes) throw new RangeError('webhook_body_too_large');
    return buffer.toString('utf8');
  }
  if (rawBody !== undefined && rawBody !== null) throw new TypeError('invalid_raw_body');

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    let buffer: Buffer;
    if (typeof chunk === 'string') buffer = Buffer.from(chunk, 'utf8');
    else if (Buffer.isBuffer(chunk)) buffer = chunk;
    else if (chunk instanceof Uint8Array) buffer = Buffer.from(chunk);
    else throw new TypeError('invalid_request_chunk');
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new RangeError('webhook_body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function extractEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const angleMatch = text.match(/<([^<>]+)>/);
  const candidate = (angleMatch?.[1] || text).trim().toLowerCase();
  if (candidate.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(candidate)) return null;
  return candidate;
}

function stringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string');
}

function getMessageHeader(headers: RetrievedEmail['headers'], name: string): string {
  if (!headers || typeof headers !== 'object') return '';
  const target = name.toLowerCase();
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(' ').trim();
  return '';
}

export function emailBodyToText(email: RetrievedEmail): string {
  if (typeof email.text === 'string' && email.text.trim()) return email.text.trim();
  if (typeof email.html !== 'string' || !email.html.trim()) return '';
  return email.html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>|<\/p\s*>|<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function normalizedText(value: string): string {
  return value
    .toLocaleLowerCase('es-CR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200b-\u200f\ufeff]/g, ' ');
}

function isAutomatedOrPromotional(
  from: string,
  subject: string,
  headers: RetrievedEmail['headers']
): boolean {
  const autoSubmitted = getMessageHeader(headers, 'auto-submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  const precedence = getMessageHeader(headers, 'precedence').toLowerCase();
  if (/\b(bulk|list|junk|auto_reply|autoreply)\b/.test(precedence)) return true;
  if (
    getMessageHeader(headers, 'list-id') ||
    getMessageHeader(headers, 'list-unsubscribe') ||
    getMessageHeader(headers, 'x-autoreply') ||
    getMessageHeader(headers, 'x-auto-response-suppress')
  ) return true;
  if (/^(?:no[-_.]?reply|mailer-daemon|newsletter|marketing|notifications?)(?:@|[-_.])/i.test(from)) return true;

  const subjectText = normalizedText(subject);
  return /\b(boletin|newsletter|promocion(?:es)?|oferta(?:s)?|publicidad|marketing|descuento exclusivo|weekly digest|unsubscribe|anuncio comercial)\b/.test(subjectText);
}

function isAbusiveOrUnsafeRequest(text: string): boolean {
  if (text.length > MAX_SUPPORT_BODY_CHARS) return true;
  const normalized = normalizedText(text);
  const asksForSecrets = /\b(?:dame|revela|env[ií]ame|muestra|imprime|extrae|filtra|give me|reveal|show|print|extract|dump)\b.{0,100}\b(?:api[\s_-]?key|secret|secreto|token|contrase[nñ]a|password|credential|credencial|claves? de otros clientes)\b/.test(normalized);
  const overridesSafety = /\b(?:ignora|ignore|omite|override|desobedece)\b.{0,100}\b(?:instrucciones|instructions|reglas|rules|seguridad|security|system prompt|prompt del sistema)\b/.test(normalized);
  const requestsUnauthorizedAccess = /\b(?:entra|accede|hackea|bypass|evade|access|break into)\b.{0,80}\b(?:sin autorizacion|cuenta ajena|cuenta de otro|otro restaurante|unauthorized|another account|security)\b/.test(normalized);
  return asksForSecrets || (overridesSafety && /\b(?:clave|token|secret|secreto|password|contrase[nñ]a|api[\s_-]?key)\b/.test(normalized)) || requestsUnauthorizedAccess;
}

const CRITICAL_SUPPORT_RE = /\b(?:cuenta (?:comprometida|hackeada|robada)|me robaron (?:la )?cuenta|acceso no autorizado|hackeo|filtracion de datos|datos expuestos|brecha de seguridad|incidente de seguridad|perdida de datos|fraude|cobro duplicado|cargo duplicado|pago duplicado|cobro no reconocido|cargo no reconocido|dinero desaparecido|account compromised|unauthorized access|security breach|data breach|data exposed|data loss|fraud|charged twice|duplicate charge|unrecognized charge|money missing)\b/i;
const SUPPORT_INTENT_RE = /\b(?:ayuda|soporte|asistencia|problema|error|falla|no funciona|no me deja|no puedo|no carga|no abre|ca[ií]do|ca[ií]da|bloquead[oa]|consulta|duda|c[oó]mo|como hago|me ayudan|me pueden ayudar|help|support|issue|problem|not working|can't|cannot|down|unavailable|login|log in)\b/i;
const PRODUCT_CONTEXT_RE = /\b(?:sabor.?ai|pos|punto de venta|restaurante|sal[oó]n|mesa|comanda|pedido|caja|turno|men[uú]|inventario|facturaci[oó]n|hacienda|impresora|usuario|cuenta|acceso|iniciar sesi[oó]n|sesi[oó]n|producto|sucursal|ventas|cierre|apertura|terminal)\b/i;

export function classifySupportMessage(input: {
  from: string;
  subject: string;
  body: string;
  headers?: RetrievedEmail['headers'];
}): SupportClassification {
  if (!input.body.trim() || isAbusiveOrUnsafeRequest(`${input.subject}\n${input.body}`)) return 'ignore';
  if (isAutomatedOrPromotional(input.from, input.subject, input.headers)) return 'ignore';
  const combined = normalizedText(`${input.subject}\n${input.body}`);
  if (CRITICAL_SUPPORT_RE.test(combined)) return 'critical';
  if (SUPPORT_INTENT_RE.test(combined) && PRODUCT_CONTEXT_RE.test(combined)) return 'routine';
  return 'ignore';
}

function sanitizeSubject(subject: string): string {
  const withoutControlCharacters = [...subject]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('');
  return withoutControlCharacters.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Soporte SaborAI POS';
}

function isValidMessageId(value: string): boolean {
  return value.length <= 998 && /^<[^<>\s\r\n]+@[^<>\s\r\n]+>$/.test(value);
}

export function buildThreadHeaders(messageId: string, priorReferences = ''): Record<string, string> {
  if (!isValidMessageId(messageId)) return {};
  const references = priorReferences
    .split(/\s+/)
    .filter((reference) => isValidMessageId(reference))
    .slice(-19);
  if (!references.includes(messageId)) references.push(messageId);
  return {
    'In-Reply-To': messageId,
    References: references.join(' ')
  };
}

export function buildReplySubject(subject: string): string {
  const safeSubject = sanitizeSubject(subject);
  return /^re\s*:/i.test(safeSubject) ? safeSubject : `Re: ${safeSubject}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addSignature(reply: string): string {
  const cleanReply = reply.trim().slice(0, 2_000);
  if (/maikol de soporte\s*$/i.test(cleanReply)) return cleanReply;
  return `${cleanReply}\n\nMaikol de Soporte`;
}

function idempotencyKey(emailId: string, purpose: 'reply' | 'escalation'): string {
  const digest = createHash('sha256').update(emailId).digest('hex');
  return `support-inbound-${purpose}-${digest}`;
}

function addresses(values: unknown[]): string[] {
  return values.map(extractEmailAddress).filter((value): value is string => Boolean(value));
}

export async function processReceivedSupportEmail(
  event: ReceivedEmailEvent,
  options: SupportProcessingOptions,
  dependencies: SupportProcessingDependencies
): Promise<{ action: 'ignored' | 'replied' | 'escalated'; reason?: string }> {
  const data = event.data;
  if (event.type !== 'email.received' || !data) return { action: 'ignored', reason: 'not_received_email' };

  const emailId = typeof data.email_id === 'string' ? data.email_id : '';
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(emailId)) return { action: 'ignored', reason: 'invalid_email_id' };

  const supportAddresses = addresses([options.supportEmail, ...(options.inboundAliases || [])]);
  const recipientAddresses = addresses([
    ...stringArray(data.to),
    ...stringArray(data.received_for)
  ]);
  if (!supportAddresses.some((address) => recipientAddresses.includes(address))) {
    return { action: 'ignored', reason: 'wrong_recipient' };
  }

  const sender = extractEmailAddress(data.from);
  if (!sender || supportAddresses.includes(sender)) return { action: 'ignored', reason: 'invalid_or_internal_sender' };
  const messageId = typeof data.message_id === 'string' ? data.message_id.trim() : '';
  if (!isValidMessageId(messageId)) return { action: 'ignored', reason: 'missing_thread_message_id' };

  const received = await dependencies.retrieveEmail(emailId);
  const receivedRecipients = addresses([
    ...stringArray(received.to),
    ...stringArray(received.received_for)
  ]);
  if (receivedRecipients.length && !supportAddresses.some((address) => receivedRecipients.includes(address))) {
    return { action: 'ignored', reason: 'wrong_retrieved_recipient' };
  }

  const subject = sanitizeSubject(typeof data.subject === 'string' ? data.subject : (received.subject || ''));
  const body = emailBodyToText(received);
  const classification = classifySupportMessage({
    from: sender,
    subject,
    body,
    headers: received.headers
  });
  if (classification === 'ignore') return { action: 'ignored', reason: 'not_clear_support_or_automated' };

  const fromEmail = extractEmailAddress(options.fromEmail);
  if (!fromEmail) throw new Error('support_from_email_not_configured');
  const escalationEmail = extractEmailAddress(options.escalationEmail);
  if (classification === 'critical' && !escalationEmail) throw new Error('support_escalation_email_invalid');
  const supportEmail = extractEmailAddress(options.supportEmail);
  if (!supportEmail) throw new Error('support_public_email_invalid');

  const headers = buildThreadHeaders(messageId, getMessageHeader(received.headers, 'references'));
  const replyTo = supportEmail;
  let reply: string;

  if (classification === 'critical') {
    const escalationText = [
      'Se requiere revisión prioritaria del equipo de soporte SaborAI POS.',
      `Remitente: ${sender}`,
      `Asunto: ${subject}`,
      `Referencia del correo entrante: ${emailId}`,
      '',
      'Mensaje recibido (solo texto; sin adjuntos):',
      body.slice(0, 8_000)
    ].join('\n');
    await dependencies.sendEmail({
      from: fromEmail,
      to: escalationEmail!,
      subject: `[SaborAI POS] Revisión prioritaria: ${subject}`,
      text: escalationText,
      html: `<p>Se requiere revisión prioritaria del equipo de soporte SaborAI POS.</p><p><strong>Remitente:</strong> ${escapeHtml(sender)}<br><strong>Asunto:</strong> ${escapeHtml(subject)}<br><strong>Referencia:</strong> ${escapeHtml(emailId)}</p><pre>${escapeHtml(body.slice(0, 8_000))}</pre>`
    }, idempotencyKey(emailId, 'escalation'));
    reply = 'Gracias por avisarnos. Recibimos tu mensaje y ya lo escalamos con prioridad a Maikol de Soporte para revisión humana. No compartas contraseñas, códigos de acceso, claves ni datos de tarjetas por correo.\n\nMaikol de Soporte';
  } else {
    reply = addSignature(await dependencies.generateReply(subject, body));
  }

  await dependencies.sendEmail({
    from: fromEmail,
    to: sender,
    replyTo,
    subject: buildReplySubject(subject),
    text: reply,
    html: `<div>${escapeHtml(reply).replace(/\n/g, '<br>')}</div>`,
    headers
  }, idempotencyKey(emailId, 'reply'));

  return { action: classification === 'critical' ? 'escalated' : 'replied' };
}
