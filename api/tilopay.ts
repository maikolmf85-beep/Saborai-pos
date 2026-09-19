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
      
      // Aquí se enviaría la petición REAL a TiloPay para tokenizar.
      // Ejemplo: 
      // const response = await fetch('https://api.tilopay.com/api/v1/tokenize', {
      //   method: 'POST',
      //   headers: {
      //     'apikey': TILOPAY_API_KEY,
      //     'Authorization': `Basic ${Buffer.from(TILOPAY_API_USER + ':' + TILOPAY_API_PASSWORD).toString('base64')}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify(cardData)
      // });
      // const data = await response.json();
      
      // Simulando comportamiento basado en los datos para pruebas iniciales, 
      // pero listo para cambiar a fetch real
      const delay = Math.floor(Math.random() * 1000) + 1500;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      if (cardData.cvv === '999') {
        throw new Error('Tarjeta declinada por el banco emisor (Fondos Insuficientes / CVV Inválido).');
      }
      if (cardData.cardNumber.replace(/\s+/g, '').endsWith('0000')) {
        throw new Error('Tarjeta bloqueada por sospecha de fraude.');
      }

      // Devolver Token Real o Simulado
      const token = `tilo_tok_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
      return res.status(200).json({ token });

    } else if (action === 'subscribe') {
      const { planId, token, email } = payload;

      // Validación simple
      if (!token || !token.startsWith('tilo_tok_')) {
        return res.status(400).json({ success: false, error: 'Token de pago inválido.' });
      }

      // Petición REAL a TiloPay para Suscripción
      // const response = await fetch('https://api.tilopay.com/api/v1/subscribe', { ... });
      
      const delay = Math.floor(Math.random() * 1000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      return res.status(200).json({
        success: true,
        transactionId: `sub_txn_${Date.now()}`,
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
