import type { VercelRequest, VercelResponse } from '@vercel/node';

// Tipos requeridos
interface TilopayCardData {
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  cardholderName: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers para pruebas seguras
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Leer variables de entorno (Nunca expuestas al frontend)
  const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY;
  const TILOPAY_API_USER = process.env.TILOPAY_API_USER;
  const TILOPAY_API_PASSWORD = process.env.TILOPAY_API_PASSWORD;
  
  if (!TILOPAY_API_KEY || !TILOPAY_API_USER || !TILOPAY_API_PASSWORD) {
    console.error('Missing Tilopay credentials in environment variables.');
    return res.status(500).json({ error: 'El servidor no está configurado correctamente para procesar pagos.' });
  }

  const { action, payload } = req.body;

  try {
    if (action === 'tokenize') {
      const cardData = payload as TilopayCardData;
      
      const response = await fetch('https://app.tilopay.com/api/v1/processTokenize', {
        method: 'POST',
        headers: {
          'apikey': TILOPAY_API_KEY,
          'Authorization': `Basic ${Buffer.from(TILOPAY_API_USER + ':' + TILOPAY_API_PASSWORD).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cardData)
      });
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
         const text = await response.text();
         console.error('TiloPay Non-JSON Response:', text.substring(0, 200));
         throw new Error(`La pasarela de pagos falló al responder (código ${response.status}). Intenta de nuevo.`);
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Tarjeta declinada o error de validación por el banco emisor.');
      }

      return res.status(200).json({ token: data.token || data.id });

    } else if (action === 'subscribe') {
      const { planId, token, email } = payload;

      // Validación simple (dependiendo de TiloPay los tokens varían)
      if (!token) {
        return res.status(400).json({ success: false, error: 'Token de pago inválido.' });
      }

      const response = await fetch('https://app.tilopay.com/api/v1/processPayment', {
        method: 'POST',
        headers: {
          'apikey': TILOPAY_API_KEY,
          'Authorization': `Basic ${Buffer.from(TILOPAY_API_USER + ':' + TILOPAY_API_PASSWORD).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ planId, token, email })
      });
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
         const text = await response.text();
         console.error('TiloPay Non-JSON Response:', text.substring(0, 200));
         throw new Error(`La pasarela de pagos falló al procesar la suscripción (código ${response.status}).`);
      }

      const data = await response.json();

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
