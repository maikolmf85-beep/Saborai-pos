import { createHash } from 'node:crypto';

export const BETA_DOMAIN = 'mail.saborai.site';
export const BETA_RECIPIENT = 'maikolr85@outlook.es';
export const BETA_FROM = 'SaborAI Beta <beta@mail.saborai.site>';
export const BETA_APPLICANT_FROM = 'beta@mail.saborai.site';
export const BETA_APPLICANT_REPLY_TO = 'maikolr85@outlook.es';
export const BETA_MAX_BODY_BYTES = 8 * 1024;

const PROVINCES = new Set([
  'San José',
  'Alajuela',
  'Cartago',
  'Heredia',
  'Guanacaste',
  'Puntarenas',
  'Limón',
]);

const CURRENT_SYSTEMS = new Set([
  'Papel o Excel',
  'Otro POS',
  'Otro sistema',
  'No tengo un sistema',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function createRateLimiter({
  limit = 5,
  windowMs = 10 * 60 * 1000,
  now = () => Date.now(),
  maxKeys = 5000,
} = {}) {
  const buckets = new Map();

  return (identifier) => {
    const currentTime = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key);
    }

    if (!identifier) return true;

    const key = String(identifier);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      if (buckets.size >= maxKeys) return false;
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
      return true;
    }

    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
}

const defaultRateLimiter = createRateLimiter();

function getHeader(req, name) {
  const value = req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function isSameOriginRequest(req) {
  const origin = getHeader(req, 'origin');
  const requestHost = getHeader(req, 'host');
  if (typeof origin !== 'string' || typeof requestHost !== 'string') return false;

  const host = requestHost.split(',')[0].trim().toLowerCase();
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/u.test(host);
  if (host !== 'blog.saborai.site' && !isLocalHost) return false;
  try {
    const parsedOrigin = new URL(origin);
    const isLocalHttp = parsedOrigin.protocol === 'http:' && isLocalHost;
    const secureProtocol = parsedOrigin.protocol === 'https:' || isLocalHttp;
    return secureProtocol && parsedOrigin.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function requestClientKey(req) {
  const rawAddress = getHeader(req, 'x-vercel-forwarded-for')
    || getHeader(req, 'x-forwarded-for')
    || req?.socket?.remoteAddress;
  if (typeof rawAddress !== 'string' || !rawAddress.trim()) return null;

  const address = rawAddress.split(',')[0].trim();
  if (!address) return null;
  return createHash('sha256').update(address).digest('hex');
}

function byteLengthOfBody(body) {
  if (body === undefined || body === null) return 0;
  if (Buffer.isBuffer(body)) return body.byteLength;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return Infinity;
  }
}

function parseRequestBody(body) {
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

function readText(value, maxLength, { required = true } = {}) {
  if (value === undefined || value === null) {
    return required ? null : '';
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength || CONTROL_CHARACTERS.test(trimmed)) return null;
  if (required && !trimmed) return null;
  return trimmed;
}

export function validateBetaApplication(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid' };
  }

  const website = readText(body.website, 200, { required: false });
  if (website === null) return { ok: false, reason: 'invalid' };
  if (website) return { ok: false, reason: 'honeypot' };

  const name = readText(body.name, 100);
  const restaurant = readText(body.restaurant, 120);
  const email = readText(body.email, 160);
  const phone = readText(body.phone, 40, { required: false });
  const province = readText(body.province, 32);
  const currentPos = readText(body.currentPos, 60, { required: false });

  if (!name || !restaurant || !email || phone === null || !province || currentPos === null) {
    return { ok: false, reason: 'invalid' };
  }
  if (!EMAIL_PATTERN.test(email) || email.includes('..')) {
    return { ok: false, reason: 'invalid' };
  }
  const phoneDigits = phone ? phone.replace(/\D/gu, '').length : 0;
  if (phone && (!/^[+()\d .-]+$/u.test(phone) || phoneDigits < 7 || phoneDigits > 15)) {
    return { ok: false, reason: 'invalid' };
  }
  if (!PROVINCES.has(province)) {
    return { ok: false, reason: 'invalid' };
  }
  if (currentPos && !CURRENT_SYSTEMS.has(currentPos)) {
    return { ok: false, reason: 'invalid' };
  }
  if (body.roleConfirmation !== true) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    application: { name, restaurant, email, phone, province, currentPos },
  };
}

function notificationText(application) {
  return [
    'Nueva postulación para la beta de SaborAI POS',
    '',
    `Nombre: ${application.name}`,
    `Restaurante: ${application.restaurant}`,
    `Correo: ${application.email}`,
    `Teléfono: ${application.phone || 'No indicado'}`,
    `Provincia: ${application.province}`,
    `Sistema actual: ${application.currentPos || 'No indicado'}`,
    'Confirma ser dueño/a o encargado/a y acepta contacto: Sí',
    '',
    'Enviado desde el formulario de beta de blog.saborai.site.',
  ].join('\n');
}

function applicantConfirmationText() {
  return [
    'Hola,',
    '',
    'Recibimos tu postulación a la beta de SaborAI POS. Muchas gracias por postular tu restaurante.',
    '',
    'Enviar una postulación no garantiza un cupo. Si tu restaurante queda seleccionado, nos pondremos en contacto contigo por correo electrónico.',
    '',
    'Gracias por tu interés en ayudarnos a mejorar SaborAI POS.',
  ].join('\n');
}

function timeoutSignal() {
  const signal = globalThis.AbortSignal;
  return typeof signal?.timeout === 'function' ? signal.timeout(8000) : undefined;
}

export async function sendBetaApplication({ application, apiKey, fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { kind: 'not_configured' };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const domainResponse = await fetchImpl('https://api.resend.com/domains', {
      method: 'GET',
      headers: { Authorization: headers.Authorization },
      signal: timeoutSignal(),
    });
    if (!domainResponse.ok) return { kind: 'provider_error' };

    const domainList = await domainResponse.json();
    const verified = Array.isArray(domainList?.data)
      && domainList.data.some((domain) => (
        typeof domain?.name === 'string'
        && domain.name.toLowerCase() === BETA_DOMAIN
        && domain.status === 'verified'
      ));
    if (!verified) return { kind: 'domain_not_verified' };

    const emails = [
      {
        from: BETA_FROM,
        to: [BETA_RECIPIENT],
        reply_to: application.email,
        subject: 'Nueva postulación a la beta de SaborAI POS',
        text: notificationText(application),
      },
      {
        from: BETA_APPLICANT_FROM,
        to: [application.email],
        reply_to: BETA_APPLICANT_REPLY_TO,
        subject: 'Recibimos tu postulación a la beta de SaborAI POS',
        text: applicantConfirmationText(),
      },
    ];

    for (const email of emails) {
      // Resend tracking is disabled in the verified domain settings; it is not a per-message API option.
      const emailResponse = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        signal: timeoutSignal(),
        body: JSON.stringify(email),
      });
      if (!emailResponse.ok) return { kind: 'provider_error' };

      const result = await emailResponse.json();
      if (typeof result?.id !== 'string' || !result.id.trim()) {
        return { kind: 'provider_error' };
      }
    }
    return { kind: 'sent' };
  } catch {
    // Do not log request bodies, provider responses, or applicant data.
    return { kind: 'provider_error' };
  }
}

function sendJson(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

export function createBetaSignupHandler({
  getApiKey = () => process.env.RESEND_API_KEY,
  fetchImpl = globalThis.fetch,
  rateLimiter = defaultRateLimiter,
} = {}) {
  return async function betaSignupHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, message: 'Método no permitido.' });
    }

    if (!isSameOriginRequest(req)) {
      return sendJson(res, 403, { ok: false, message: 'Solicitud no válida.' });
    }

    const contentType = getHeader(req, 'content-type') || '';
    if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
      return sendJson(res, 415, { ok: false, message: 'Formato no compatible.' });
    }

    const contentLength = Number(getHeader(req, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > BETA_MAX_BODY_BYTES) {
      return sendJson(res, 413, { ok: false, message: 'La solicitud es demasiado grande.' });
    }
    if (byteLengthOfBody(req.body) > BETA_MAX_BODY_BYTES) {
      return sendJson(res, 413, { ok: false, message: 'La solicitud es demasiado grande.' });
    }

    const clientKey = requestClientKey(req);
    if (!clientKey) {
      return sendJson(res, 503, { ok: false, message: 'El envío no está disponible temporalmente.' });
    }
    if (!rateLimiter(clientKey)) {
      return sendJson(res, 429, { ok: false, message: 'Espera unos minutos antes de volver a enviar.' });
    }

    const body = parseRequestBody(req.body);
    if (!body) {
      return sendJson(res, 400, { ok: false, message: 'Revisa los datos del formulario.' });
    }

    const validation = validateBetaApplication(body);
    if (!validation.ok) {
      return sendJson(res, 400, { ok: false, message: 'Revisa los datos del formulario.' });
    }

    const result = await sendBetaApplication({
      application: validation.application,
      apiKey: getApiKey(),
      fetchImpl,
    });

    if (result.kind === 'sent') {
      return sendJson(res, 200, { ok: true });
    }
    if (result.kind === 'domain_not_verified' || result.kind === 'not_configured') {
      return sendJson(res, 503, { ok: false, message: 'El envío no está disponible temporalmente.' });
    }
    return sendJson(res, 502, { ok: false, message: 'No se pudo enviar la postulación.' });
  };
}
