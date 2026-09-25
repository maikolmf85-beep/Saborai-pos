import { VercelRequest, VercelResponse } from '@vercel/node';
import forge from 'node-forge';
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

// Función auxiliar para parsear y validar llave criptográfica .p12
function parseAndVerifyP12(p12Base64: string, pin: string) {
  // Limpiar prefijo data URL y espacios en blanco
  const cleanBase64 = p12Base64.includes(',') ? p12Base64.split(',')[1].replace(/\s+/g, '') : p12Base64.replace(/\s+/g, '');
  const der = forge.util.decode64(cleanBase64);
  const asn = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn, true, pin.trim());
  
  // Buscar certificado en certBag
  let cert: any = null;
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (certBags && certBags.length > 0 && certBags[0].cert) {
    cert = certBags[0].cert;
  } else {
    for (const bagType in p12.bags) {
      const bags = p12.bags[bagType];
      if (bags) {
        for (const b of bags) {
          if (b.cert) {
            cert = b.cert;
            break;
          }
        }
      }
      if (cert) break;
    }
  }

  if (!cert) {
    throw new Error('No se encontró ningún certificado dentro del archivo .p12');
  }

  const notAfter = cert.validity?.notAfter;
  const expiresOn = notAfter ? notAfter.toISOString() : undefined;
  const now = new Date();
  if (notAfter && notAfter < now) {
    throw new Error(`El certificado criptográfico expiró el ${notAfter.toLocaleDateString()}. Debe renovarlo en ATV Hacienda.`);
  }

  return {
    isValid: true,
    expiresOn,
    cleanBase64
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

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
    const atvUsername = (reqAtvUser || process.env.HACIENDA_USER || '').trim(); 
    const atvPassword = (reqAtvPass || process.env.HACIENDA_PASSWORD || '').trim();
    const rawP12 = reqP12 || process.env.HACIENDA_P12_BASE64;
    const p12Pin = (reqPin || process.env.HACIENDA_PIN || '').trim();
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
      if (rawP12 && p12Pin) {
        try {
          const certValidation = parseAndVerifyP12(rawP12, p12Pin);
          if (certValidation && certValidation.isValid) {
            results.certOk = true;
            results.expiresOn = certValidation.expiresOn;
          }
        } catch (certErr: any) {
          const msg = certErr.message?.includes('MAC could not be verified') 
            ? 'El PIN de 4 dígitos es incorrecto para este archivo .p12'
            : certErr.message || 'Error procesando certificado .p12';
          return res.status(400).json({ 
            success: false, 
            error: msg, 
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
          const desc = tokenData?.error_description || tokenData?.error || 'Credenciales ATV no autorizadas';
          return res.status(401).json({
            success: false,
            error: `Error de autenticación con Hacienda (${environment.toUpperCase()}): ${desc}`,
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

      const certText = results.certOk ? ` y Llave Criptográfica .p12 válida (expira: ${results.expiresOn?.split('T')[0]})` : '';
      return res.status(200).json({
        success: true,
        environment,
        ...results,
        message: `¡Conexión exitosa con Ministerio de Hacienda CR (${environment.toUpperCase()})! Usuario ATV autenticado${certText}.`
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
    if (rawP12 && p12Pin && rawXml) {
      try {
        const cleanP12 = rawP12.includes(',') ? rawP12.split(',')[1].replace(/\s+/g, '') : rawP12.replace(/\s+/g, '');
        // signer.sign devuelve el XML firmado convertido directamente a Base64
        finalXmlBase64 = await signer.sign(rawXml, cleanP12, p12Pin.trim());
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
