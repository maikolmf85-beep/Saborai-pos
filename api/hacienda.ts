import { VercelRequest, VercelResponse } from '@vercel/node';

// Configuración de Entornos de Hacienda CR
const HACIENDA_ENV = {
  sandbox: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    api: 'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion'
  },
  production: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    api: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion'
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { xmlBase64, clave, fecha, emisor, receptor } = req.body;

    if (!xmlBase64 || !clave || !emisor) {
      return res.status(400).json({ error: 'Faltan datos requeridos (xmlBase64, clave, emisor)' });
    }

    // TODO: Recuperar credenciales ATV y Llave Criptográfica (.p12) desde la base de datos (Supabase)
    // del Tenant (Restaurante) actual.
    const atvUsername = process.env.HACIENDA_USER; 
    const atvPassword = process.env.HACIENDA_PASSWORD;
    const environment = 'sandbox'; // Cambiar a 'production' en vivo
    const endpoints = HACIENDA_ENV[environment];

    if (!atvUsername || !atvPassword) {
      return res.status(500).json({ 
        error: 'Credenciales ATV no configuradas',
        message: 'El restaurante debe configurar sus credenciales del Ministerio de Hacienda (ATV) en el panel.'
      });
    }

    // 1. Obtener Token de Hacienda (OAuth2)
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', environment === 'sandbox' ? 'api-stag' : 'api-prod');
    tokenParams.append('grant_type', 'password');
    tokenParams.append('username', atvUsername);
    tokenParams.append('password', atvPassword);

    const tokenRes = await fetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('Error Auth Hacienda:', tokenData);
      return res.status(401).json({ error: 'Error autenticando con Hacienda CR (ATV)', details: tokenData });
    }

    const accessToken = tokenData.access_token;

    // 2. Firmar XML (Requiere librería externa o servicio para leer el .p12 y aplicar firma XAdES-EPES)
    // NOTA: Para este prototipo asumimos que el frontend/cliente o un microservicio ya envió el XML firmado.
    // El payload debe contener la firma XAdES incrustada.
    const payload = {
      clave: clave,
      fecha: fecha || new Date().toISOString(),
      emisor: {
        tipoIdentificacion: emisor.tipoIdentificacion || '01',
        numeroIdentificacion: emisor.cedulaJuridica
      },
      comprobanteXml: xmlBase64 // El XML firmado y convertido a Base64
    };

    if (receptor && receptor.identificacion) {
      (payload as any).receptor = {
        tipoIdentificacion: receptor.tipoIdentificacion || '01',
        numeroIdentificacion: receptor.identificacion
      };
    }

    // 3. Enviar a Recepción de Hacienda
    const recepcionRes = await fetch(endpoints.api, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (recepcionRes.status === 202) {
      return res.status(200).json({ 
        success: true, 
        estado: 'PROCESANDO', 
        mensaje: 'Factura recibida por Hacienda. Pendiente de validación asíncrona.' 
      });
    } else {
      const recepcionData = await recepcionRes.json().catch(() => null);
      return res.status(400).json({ 
        error: 'Hacienda rechazó la estructura de la factura', 
        details: recepcionData 
      });
    }

  } catch (error: any) {
    console.error('Error interno Facturación:', error);
    return res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
}
