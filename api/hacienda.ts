import { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-ignore
import signer from 'haciendacostarica-signer';

// Configuración de Entornos Oficiales de Hacienda Costa Rica
const HACIENDA_ENV = {
  sandbox: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
    api: 'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/recepcion',
    clientId: 'api-stag'
  },
  production: {
    token: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token',
    api: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1/recepcion',
    clientId: 'api-prod'
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { 
      action = 'emit',
      xmlString, 
      xmlBase64, 
      clave, 
      fecha, 
      emisor, 
      receptor,
      atvUsername: reqAtvUser,
      atvPassword: reqAtvPass,
      p12Base64: reqP12,
      p12Pin: reqPin,
      environment: reqEnv
    } = req.body;

    // Determinar credenciales: primero desde el request (Tenant), luego desde variables de entorno
    const atvUsername = reqAtvUser || process.env.HACIENDA_USER; 
    const atvPassword = reqAtvPass || process.env.HACIENDA_PASSWORD;
    const p12Base64 = reqP12 || process.env.HACIENDA_P12_BASE64;
    const p12Pin = reqPin || process.env.HACIENDA_PIN;
    const environment: 'sandbox' | 'production' = (reqEnv === 'production' || process.env.HACIENDA_ENV === 'production') ? 'production' : 'sandbox';
    const endpoints = HACIENDA_ENV[environment];

    // ==========================================
    // ACCIÓN: TEST DE CONEXIÓN Y CERTIFICADO
    // ==========================================
    if (action === 'test-connection') {
      const results: {
        tokenOk: boolean;
        certOk: boolean;
        expiresOn?: string;
        message?: string;
        tokenDetails?: any;
      } = { tokenOk: false, certOk: false };

      // 1. Validar Llave Criptográfica (.p12) y PIN si se proporcionaron
      if (p12Base64 && p12Pin) {
        try {
          const certValidation = await signer.verifySignature(p12Base64, p12Pin);
          if (certValidation && certValidation.isValid) {
            results.certOk = true;
            results.expiresOn = certValidation.expiresOn;
          }
        } catch (certErr: any) {
          return res.status(400).json({ 
            success: false, 
            error: 'Certificado .p12 o PIN inválido', 
            details: certErr.message 
          });
        }
      }

      // 2. Validar Credenciales ATV con el IDP de Hacienda
      if (atvUsername && atvPassword) {
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', endpoints.clientId);
        tokenParams.append('grant_type', 'password');
        tokenParams.append('username', atvUsername);
        tokenParams.append('password', atvPassword);

        const tokenRes = await fetch(endpoints.token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams
        });

        const tokenData = (await tokenRes.json().catch(() => null)) as any;
        if (!tokenRes.ok || !tokenData?.access_token) {
          return res.status(401).json({
            success: false,
            error: 'Credenciales ATV inválidas en Hacienda CR',
            details: tokenData,
            environment
          });
        }
        results.tokenOk = true;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Faltan credenciales ATV (usuario o contraseña) para probar conexión.'
        });
      }

      return res.status(200).json({
        success: true,
        environment,
        ...results,
        message: `Conexión con Hacienda CR (${environment.toUpperCase()}) exitosa. Token ATV verificado${results.certOk ? ` y Llave .p12 válida hasta ${results.expiresOn}` : ''}.`
      });
    }

    // ==========================================
    // ACCIÓN: CONSULTAR ESTADO DE COMPROBANTE
    // ==========================================
    if (action === 'consultar-estado') {
      if (!clave) {
        return res.status(400).json({ error: 'La clave de 50 dígitos es requerida para consultar.' });
      }

      if (!atvUsername || !atvPassword) {
        return res.status(400).json({ error: 'Credenciales ATV no configuradas para consulta.' });
      }

      // Obtener Token
      const token = await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);

      const statusRes = await fetch(`${endpoints.api}/${clave}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const statusData = (await statusRes.json().catch(() => null)) as any;
      return res.status(statusRes.status).json({
        success: statusRes.ok,
        status: statusRes.status,
        data: statusData
      });
    }

    // ==========================================
    // ACCIÓN: EMITIR FACTURA (FIRMA XAdES + ENVÍO)
    // ==========================================
    if (!clave || !emisor) {
      return res.status(400).json({ error: 'Faltan datos requeridos (clave, emisor)' });
    }

    let finalXmlBase64 = xmlBase64;

    // Si viene XML en texto crudo (o si hay que firmarlo con .p12)
    let rawXml = xmlString;
    if (!rawXml && xmlBase64) {
      try {
        rawXml = Buffer.from(xmlBase64, 'base64').toString('utf-8');
      } catch (e) {
        // Ignorar si ya era binario
      }
    }

    // 1. FIRMA DIGITAL XAdES-EPES CON LA LLAVE .P12
    if (p12Base64 && p12Pin && rawXml) {
      try {
        // signer.sign devuelve el XML firmado convertido directamente a Base64
        finalXmlBase64 = await signer.sign(rawXml, p12Base64, p12Pin);
      } catch (signError: any) {
        console.error('Error firmando XML XAdES-EPES:', signError);
        return res.status(400).json({
          error: 'Error al firmar digitalmente el XML con la llave .p12',
          message: signError.message
        });
      }
    } else if (!finalXmlBase64) {
      return res.status(400).json({ 
        error: 'XML no proporcionado o imposible de firmar (se requiere archivo .p12 y PIN, o xmlBase64 ya firmado)' 
      });
    }

    if (!atvUsername || !atvPassword) {
      return res.status(500).json({ 
        error: 'Credenciales ATV no configuradas',
        message: 'Configure sus credenciales del Ministerio de Hacienda (ATV) en Configuración.'
      });
    }

    // 2. Obtener Token de Hacienda (OAuth2)
    const accessToken = await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);

    // 3. Preparar Payload oficial para Recepción
    const payload: any = {
      clave: clave,
      fecha: fecha || new Date().toISOString(),
      emisor: {
        tipoIdentificacion: emisor.tipoIdentificacion || '02',
        numeroIdentificacion: String(emisor.cedulaJuridica || emisor.numeroIdentificacion).replace(/[^0-9]/g, '')
      },
      comprobanteXml: finalXmlBase64
    };

    if (receptor && (receptor.identificacion || receptor.numeroIdentificacion)) {
      payload.receptor = {
        tipoIdentificacion: receptor.tipoIdentificacion || '01',
        numeroIdentificacion: String(receptor.identificacion || receptor.numeroIdentificacion).replace(/[^0-9]/g, '')
      };
    }

    // 4. Enviar a Recepción de Hacienda
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
        clave: clave,
        mensaje: 'Factura firmada con XAdES-EPES y recibida por Hacienda CR. Pendiente de validación asíncrona.',
        signedXmlBase64: finalXmlBase64
      });
    } else {
      const recepcionData = (await recepcionRes.json().catch(() => null)) as any;
      console.error('Rechazo Hacienda:', recepcionRes.status, recepcionData);
      return res.status(400).json({ 
        error: 'Hacienda rechazó la recepción de la factura', 
        status: recepcionRes.status,
        details: recepcionData 
      });
    }

  } catch (error: any) {
    console.error('Error interno Facturación:', error);
    return res.status(500).json({ error: 'Error interno del servidor', message: error.message });
  }
}

// Función auxiliar para obtener Token OAuth2 de Hacienda
async function getHaciendaToken(tokenUrl: string, clientId: string, user: string, pass: string): Promise<string> {
  const tokenParams = new URLSearchParams();
  tokenParams.append('client_id', clientId);
  tokenParams.append('grant_type', 'password');
  tokenParams.append('username', user);
  tokenParams.append('password', pass);

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams
  });

  const tokenData = (await tokenRes.json().catch(() => null)) as any;
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(`Error autenticando con IDP Hacienda ATV: ${tokenData?.error_description || tokenData?.error || 'Token no generado'}`);
  }

  return tokenData.access_token;
}
