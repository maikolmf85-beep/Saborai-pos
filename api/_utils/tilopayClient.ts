import {
  PurchaseIntentError,
  subscribeToPurchaseIntent,
  type TilopayConsultedTransaction,
  type TilopayPaymentStore,
  type TilopayPurchaseGateway
} from './tilopayPurchaseFlow.js';
import { tilopayPaymentStore } from './tilopaySignupHandoff.js';

interface JsonRecord {
  [key: string]: any;
}

async function readJsonResponse(response: Response, operation: string): Promise<JsonRecord> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${operation} no devolvió una respuesta válida (código ${response.status}).`);
  }
  return await response.json() as JsonRecord;
}

async function getBearerToken(): Promise<string> {
  const apiUser = process.env.TILOPAY_API_USER;
  const apiPassword = process.env.TILOPAY_API_PASSWORD;
  if (!apiUser || !apiPassword) throw new Error('Tilopay no está configurado correctamente.');

  const loginResponse = await fetch('https://app.tilopay.com/api/v1/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiuser: apiUser, password: apiPassword }),
    signal: AbortSignal.timeout(20000)
  });
  const loginData = await readJsonResponse(loginResponse, 'La autenticación de Tilopay');
  if (!loginResponse.ok) throw new Error(`Error de autenticación con Tilopay (código ${loginResponse.status}).`);

  const bearerToken = loginData.access_token || loginData.token;
  if (typeof bearerToken !== 'string' || !bearerToken) {
    throw new Error('Tilopay no devolvió un token de acceso válido.');
  }
  return bearerToken;
}

async function tilopayPost(path: string, body: JsonRecord, operation: string): Promise<JsonRecord> {
  const bearerToken = await getBearerToken();
  const response = await fetch(`https://app.tilopay.com/api/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJsonResponse(response, operation);
  if (!response.ok) {
    throw new Error(`${operation} falló (código ${response.status}).`);
  }
  return data;
}

const gateway: TilopayPurchaseGateway = {
  async tokenize(input) {
    const apiKey = process.env.TILOPAY_API_KEY;
    if (!apiKey) throw new Error('Tilopay no está configurado correctamente.');
    const data = await tilopayPost('processTokenize', {
      key: apiKey,
      email: input.email,
      firstname: input.firstName,
      lastname: input.lastName,
      language: 'es',
      redirect: input.redirect,
      token_version: 'v2'
    }, 'La tokenización de Tilopay');

    if (typeof data.url !== 'string' || !data.url) {
      throw new Error('Tilopay no devolvió un enlace de tokenización válido.');
    }
    const paymentUrl = new URL(data.url);
    if (paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== 'secure.tilopay.com') {
      throw new Error('Tilopay devolvió un dominio de tokenización no permitido.');
    }
    return data.url;
  },

  async charge(input) {
    const apiKey = process.env.TILOPAY_API_KEY;
    if (!apiKey) throw new Error('Tilopay no está configurado correctamente.');
    const data = await tilopayPost('processRecurrentPayment', {
      key: apiKey,
      amount: input.amount,
      currency: input.currency,
      orderNumber: input.orderNumber,
      capture: '1',
      email: input.email,
      card: input.token
    }, 'El cobro de Tilopay');

    if (String(data.response) !== '1') {
      throw new Error('Tilopay no confirmó el cobro; se consultará el número de pedido antes de cualquier reintento.');
    }
  },

  async consult(orderNumber) {
    const apiKey = process.env.TILOPAY_API_KEY;
    if (!apiKey) throw new Error('Tilopay no está configurado correctamente.');
    const data = await tilopayPost('consult', {
      key: apiKey,
      orderNumber,
      merchantId: ''
    }, 'La consulta de la transacción en Tilopay');

    if (!Array.isArray(data.response) || data.response.length === 0) return null;
    const transaction = data.response[0];
    if (!transaction || typeof transaction !== 'object') return null;
    return transaction as TilopayConsultedTransaction;
  }
};

export async function createTilopayTokenizationLink(input: {
  email: string;
  firstName: string;
  lastName: string;
  redirect: string;
}): Promise<string> {
  return gateway.tokenize(input);
}

export async function processTilopaySubscription(input: {
  reference: unknown;
  token: unknown;
}, store: TilopayPaymentStore = tilopayPaymentStore) {
  try {
    return await subscribeToPurchaseIntent(input.reference, input.token, store, gateway);
  } catch (error) {
    if (error instanceof PurchaseIntentError) throw error;
    // Do not log or return provider payloads, tokens, email, or credentials.
    throw new Error('No se pudo verificar el resultado del pago con Tilopay.');
  }
}
