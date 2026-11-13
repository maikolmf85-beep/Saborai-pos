import type { VercelRequest, VercelResponse } from '@vercel/node';
import forge from 'node-forge';
import { createRequire } from 'module';
import { handleOptions, requireAuth, setCorsHeaders } from './_utils/security.js';
import { handleHaciendaConfigRequest } from './_utils/haciendaConfigHandler.js';
import { supabaseAdmin } from './_utils/supabase.js';
import { ROLE_PERMISSIONS } from './_utils/rolePermissions.js';
import { parseFiscalInvoiceIssuedAt } from './_utils/fiscalInvoiceIssuedAt.js';
import { sanitizeFiscalInvoiceData } from '../src/utils/fiscalInvoiceItems.js';
import { HACIENDA_P12_PIN_FORMAT_ERROR, isValidHaciendaP12Pin } from '../src/utils/haciendaP12Pin.js';
import { validateHaciendaXmlDocumentAgainstBranchProfile } from './_utils/haciendaXmlValidation.js';
import { classifyHaciendaStatusQuery, isConfirmedHaciendaRejection } from './_utils/haciendaStatus.js';
import { canReserveHaciendaSubmission, claimHaciendaOperationLock, finishHaciendaOperationLock, updateHaciendaInvoiceIfSnapshot, type HaciendaInvoiceSnapshot } from './_utils/haciendaInvoiceConcurrency.js';
import { createHaciendaOperationLockToken, isHaciendaOperationLock, isHaciendaOperationLockStale } from './_utils/haciendaOperationLock.js';
import {
  decryptHaciendaConfig,
  encryptHaciendaConfig,
  mergeHaciendaConfig,
  normalizeHaciendaBranchCode,
  publicHaciendaConfig,
  type EncryptedHaciendaConfig,
  type HaciendaBranchConfig
} from './_utils/haciendaConfig.js';

const require = createRequire(import.meta.url);

// Inyectar polyfills para el entorno Node.js asegurando que afecte a la instancia CJS
const xmldom = require('@xmldom/xmldom');
const xpath = require('xpath');
const xmlCore = require('xml-core');

xmlCore.setNodeDependencies({
  DOMParser: xmldom.DOMParser,
  XMLSerializer: xmldom.XMLSerializer,
  DOMImplementation: xmldom.DOMImplementation,
  xpath: xpath
});

const signer = require('haciendacostarica-signer');

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

class HaciendaStorageUnavailableError extends Error {}

async function loadBranchConfig(tenantId: string, requestedBranchCode: unknown) {
  const branchCode = normalizeHaciendaBranchCode(requestedBranchCode);
  if (!branchCode) return null;
  const { data: branch, error: branchError } = await supabaseAdmin
    .from('pos_branches')
    .select('id, code')
    .eq('tenant_id', tenantId)
    .eq('code', branchCode)
    .eq('is_active', true)
    .maybeSingle();
  if (branchError || !branch) return null;

  const { data: record, error } = await supabaseAdmin
    .from('pos_hacienda_configs')
    .select('encrypted_config')
    .eq('tenant_id', tenantId)
    .eq('branch_code', branchCode)
    .maybeSingle();
  if (error) throw new HaciendaStorageUnavailableError();
  if (!record) return { branch, branchCode, config: null };
  try {
    return {
      branch,
      branchCode,
      config: decryptHaciendaConfig(record.encrypted_config as EncryptedHaciendaConfig, tenantId, branchCode)
    };
  } catch {
    throw new HaciendaStorageUnavailableError();
  }
}

async function requestHaciendaStatus(apiUrl: string, token: string, clave: string) {
  const response = await fetch(`${apiUrl}/${clave}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  const responseText = await response.text().catch(() => '');
  let data: any = null;
  try { data = responseText ? JSON.parse(responseText) : null; } catch { data = null; }
  const indicator = String(data?.['ind-estado'] || '').trim().toLowerCase();
  let detail: string | undefined;
  const responseXml = data?.['respuesta-xml'];
  if (response.ok && responseXml) {
    try {
      const decoded = Buffer.from(responseXml, 'base64').toString('utf-8');
      const message = decoded.match(/<Mensaje>([\s\S]*?)<\/Mensaje>/i)?.[1];
      const description = decoded.match(/<DetalleMensaje>([\s\S]*?)<\/DetalleMensaje>/i)?.[1];
      detail = [message, description].filter(Boolean).join(' - ').trim().slice(0, 500) || undefined;
    } catch { /* ignore malformed provider detail */ }
  }
  return {
    response,
    indicator,
    detail,
    classification: classifyHaciendaStatusQuery(response.ok, indicator)
  };
}

function invoiceSnapshot(tenantId: string, branchId: string, clave: string, row: any): HaciendaInvoiceSnapshot {
  return {
    tenantId,
    branchId,
    clave,
    haciendaStatus: String(row?.hacienda_status || 'PENDING'),
    errorMessage: typeof row?.error_message === 'string' ? row.error_message : null
  };
}

async function reserveHaciendaSubmission(
  snapshot: HaciendaInvoiceSnapshot | null,
  lockToken: string,
  invoiceRecord: Record<string, unknown>
): Promise<{ lockToken: string | null; busy: boolean; error: boolean }> {
  if (snapshot && (snapshot.haciendaStatus === 'PROCESSING' || isHaciendaOperationLock(snapshot.errorMessage))) {
    return { lockToken: null, busy: true, error: false };
  }
  const lockedRecord = {
    ...invoiceRecord,
    hacienda_status: 'PROCESSING',
    error_message: lockToken,
    accepted_at: null
  };

  if (snapshot) {
    const claimed = await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, snapshot, lockedRecord);
    if (claimed.updated) return { lockToken, busy: false, error: false };
    const current = await supabaseAdmin.from('pos_invoices')
      .select('branch_id, hacienda_status, error_message')
      .eq('tenant_id', snapshot.tenantId)
      .eq('clave', snapshot.clave)
      .maybeSingle();
    if (!current.error && current.data?.branch_id === snapshot.branchId &&
        current.data.hacienda_status === 'PROCESSING' && current.data.error_message === lockToken) {
      return { lockToken, busy: false, error: false };
    }
    return { lockToken: null, busy: !claimed.error, error: Boolean(claimed.error || current.error) };
  }

  const inserted = await supabaseAdmin.from('pos_invoices').insert(lockedRecord).select('clave').maybeSingle();
  if (!inserted.error && inserted.data) return { lockToken, busy: false, error: false };

  // An insert response can be lost after the unique reservation committed. Re-read before deciding.
  const current = await supabaseAdmin.from('pos_invoices')
    .select('branch_id, hacienda_status, error_message')
    .eq('tenant_id', String(invoiceRecord.tenant_id))
    .eq('clave', String(invoiceRecord.clave))
    .maybeSingle();
  if (current.error) return { lockToken: null, busy: false, error: true };
  if (current.data?.branch_id === invoiceRecord.branch_id && current.data.hacienda_status === 'PROCESSING' &&
      current.data.error_message === lockToken) {
    return { lockToken, busy: false, error: false };
  }
  if (current.data) {
    if (current.data.branch_id !== invoiceRecord.branch_id || current.data.hacienda_status !== 'PENDING' ||
        isHaciendaOperationLock(current.data.error_message)) {
      return { lockToken: null, busy: true, error: false };
    }
    const pendingSnapshot = invoiceSnapshot(String(invoiceRecord.tenant_id), String(invoiceRecord.branch_id),
      String(invoiceRecord.clave), current.data);
    const claimed = await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, pendingSnapshot, lockedRecord);
    if (claimed.updated) return { lockToken, busy: false, error: false };
    const afterClaim = await supabaseAdmin.from('pos_invoices')
      .select('branch_id, hacienda_status, error_message')
      .eq('tenant_id', pendingSnapshot.tenantId)
      .eq('clave', pendingSnapshot.clave)
      .maybeSingle();
    if (!afterClaim.error && afterClaim.data?.branch_id === pendingSnapshot.branchId &&
        afterClaim.data.hacienda_status === 'PROCESSING' && afterClaim.data.error_message === lockToken) {
      return { lockToken, busy: false, error: false };
    }
    return { lockToken: null, busy: !claimed.error, error: Boolean(claimed.error || afterClaim.error) };
  }

  if (inserted.error?.code === '23505') {
    const consecutive = await supabaseAdmin.from('pos_invoices')
      .select('id')
      .eq('tenant_id', String(invoiceRecord.tenant_id))
      .eq('consecutivo', String(invoiceRecord.consecutivo))
      .maybeSingle();
    if (consecutive.error) return { lockToken: null, busy: false, error: true };
    if (consecutive.data) return { lockToken: null, busy: true, error: false };
  }
  return { lockToken: null, busy: false, error: true };
}

function getCostaRicaIsoDate(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-06:00`;
}

// Función auxiliar para parsear y validar llave criptográfica .p12
function parseAndVerifyP12(p12Base64: string, pin: string) {
  // Limpiar prefijo data URL y espacios en blanco
  const cleanBase64 = p12Base64.includes(',') ? p12Base64.split(',')[1].replace(/\s+/g, '') : p12Base64.replace(/\s+/g, '');
  const der = forge.util.decode64(cleanBase64);
  const asn = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn, true, pin);
  
  // Buscar certificado en certBag
  let cert: any = null;
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (certBags && certBags.length > 0 && certBags[0].cert) {
    cert = certBags[0].cert;
  } else {
    const p12Any = p12 as any;
    for (const bagType in p12Any.bags) {
      const bags = p12Any.bags[bagType];
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

  const subjectAttrs: string[] = (cert.subject?.attributes || []).map((a: any) => String(a.value || ''));
  const subjectDigits = subjectAttrs.map(v => v.replace(/\D/g, '').replace(/^0+/, '')).filter(Boolean);
  const subjectText = (cert.subject?.attributes || []).map((a: any) => `${a.shortName || a.name}=${a.value}`).join(', ');

  return {
    isValid: true,
    expiresOn,
    cleanBase64,
    subjectDigits,
    subjectText
  };
}

function validateXmlAgainstBranchProfile(
  rawXml: string,
  config: HaciendaBranchConfig,
  expectedClave: string,
  expectedConsecutivo: string
): string | null {
  try {
    const document = new xmldom.DOMParser().parseFromString(rawXml, 'application/xml');
    return validateHaciendaXmlDocumentAgainstBranchProfile(document, config, expectedClave, expectedConsecutivo);
  } catch {
    return 'No se pudo leer el XML del comprobante para validar su perfil fiscal.';
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method === 'GET' || req.method === 'PUT') {
    return handleHaciendaConfigRequest(req, res);
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : 'emit';
  if (!['test-connection', 'consultar-estado', 'emit', 'resend'].includes(action)) {
    return res.status(400).json({ error: 'Acción de Hacienda no válida.' });
  }
  const allowedRoles = action === 'test-connection'
    ? ROLE_PERMISSIONS.haciendaSettings
    : ROLE_PERMISSIONS.haciendaOperations;
  const auth = await requireAuth(req, res, [...allowedRoles]);
  if (!auth) return;
  const tenantId = auth.tenantId;
  if (!tenantId) return res.status(403).json({ error: 'La sesión no tiene un restaurante asociado.' });

  let providerSubmissionAttempted = false;
  let statusQuerySnapshot: HaciendaInvoiceSnapshot | null = null;
  try {
    const {
      xmlString,
      xmlBase64,
      clave,
      consecutivo,
      documentType,
      total,
      fecha,
      emisor,
      receptor,
      codigoActividadReceptor,
      condicionVenta,
      medioPago,
      moneda,
      tipoCambio,
      pagos,
      items,
      subtotal,
      iva13,
      iva4,
      iva2,
      iva1,
      servicio10
    } = req.body || {};
    let branchCode = normalizeHaciendaBranchCode(req.body?.branchCode || emisor?.sucursal);
    let branchId: string | undefined;
    let haciendaConfig: HaciendaBranchConfig | null = null;

    if (action === 'consultar-estado') {
      if (!/^\d{50}$/.test(String(clave || ''))) return res.status(400).json({ error: 'La clave debe contener exactamente 50 dígitos para consultar.' });
      const { data: invoiceRow, error: invoiceError } = await supabaseAdmin
        .from('pos_invoices')
        .select('branch_id, hacienda_status, error_message')
        .eq('tenant_id', tenantId)
        .eq('clave', clave)
        .maybeSingle();
      if (invoiceError || !invoiceRow?.branch_id) return res.status(404).json({ error: 'No se encontró el comprobante en este restaurante.' });
      const { data: branch, error: branchError } = await supabaseAdmin
        .from('pos_branches')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .eq('id', invoiceRow.branch_id)
        .eq('is_active', true)
        .maybeSingle();
      if (branchError || !branch) return res.status(404).json({ error: 'La sucursal del comprobante no está disponible.' });
      if (branchCode && branchCode !== branch.code) return res.status(403).json({ error: 'El comprobante no pertenece a la sucursal indicada.' });
      branchCode = branch.code;
      branchId = branch.id;
      statusQuerySnapshot = invoiceSnapshot(tenantId, branchId, String(clave), invoiceRow);
      if (isHaciendaOperationLock(statusQuerySnapshot.errorMessage) &&
          !isHaciendaOperationLockStale(statusQuerySnapshot.errorMessage)) {
        return res.status(200).json({
          success: true,
          estado: 'procesando',
          clave,
          detalle: 'Hay una operación de Hacienda en curso; se consultará de nuevo al completarse.'
        });
      }
    }

    if (!branchCode) return res.status(400).json({ error: 'Selecciona una sucursal válida para Hacienda.' });
    const branchConfig = await loadBranchConfig(tenantId, branchCode);
    if (!branchConfig) return res.status(409).json({ error: 'La sucursal no tiene un perfil de Hacienda disponible o no se pudo leer el almacenamiento seguro.' });
    branchId = branchConfig.branch.id;
    if (action === 'test-connection') {
      haciendaConfig = mergeHaciendaConfig(branchConfig.config, req.body?.config, {
        removeCertificate: req.body?.removeCertificate === true,
        clearAtvCredentials: req.body?.clearAtvCredentials === true
      });
    } else {
      if (!branchConfig.config) return res.status(409).json({ error: 'Esta sucursal no tiene una configuración segura de Hacienda disponible.' });
      haciendaConfig = branchConfig.config;
    }
    if (!haciendaConfig) return res.status(409).json({ error: 'No se pudo cargar el perfil de Hacienda de esta sucursal.' });
    const atvUsername = haciendaConfig.atvUsername || '';
    const atvPassword = haciendaConfig.atvPassword || '';
    const rawP12 = haciendaConfig.p12Base64 || '';
    const p12Pin = haciendaConfig.pinP12 || '';
    const environment = haciendaConfig.environment || 'sandbox';
    const endpoints = HACIENDA_ENV[environment];

    // ==========================================
    // ACCIÓN: TEST DE CONEXIÓN Y CERTIFICADO
    // ==========================================
    if (action === 'test-connection') {
      if (!atvUsername || !atvPassword || !rawP12 || !p12Pin) {
        return res.status(400).json({ error: 'Completa el usuario, contraseña y llave .p12 de esta sucursal antes de probar.' });
      }
      if (!isValidHaciendaP12Pin(p12Pin)) {
        return res.status(400).json({ error: HACIENDA_P12_PIN_FORMAT_ERROR });
      }
      let certValidation;
      try {
        certValidation = parseAndVerifyP12(rawP12, p12Pin);
      } catch {
        return res.status(400).json({ error: 'No se pudo validar la llave .p12; verifica el archivo y su PIN o contraseña.' });
      }

      try {
        await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);
      } catch {
        return res.status(401).json({ error: `No se pudo autenticar con Hacienda en el ambiente ${environment.toUpperCase()}.` });
      }
      const testedAt = new Date().toISOString();
      haciendaConfig.isValidated = true;
      haciendaConfig.certExpiresOn = certValidation.expiresOn;
      haciendaConfig.lastTestedAt = testedAt;
      let encryptedConfig: EncryptedHaciendaConfig;
      try {
        encryptedConfig = encryptHaciendaConfig(haciendaConfig, tenantId, branchCode);
      } catch {
        return res.status(503).json({ error: 'El almacenamiento seguro de Hacienda no está disponible. Revisa la clave de cifrado del servidor.' });
      }
      const { error: updateError } = await supabaseAdmin
        .from('pos_hacienda_configs')
        .upsert({
          tenant_id: tenantId,
          branch_code: branchCode,
          environment,
          encrypted_config: encryptedConfig,
          is_validated: true,
          cert_expires_on: certValidation.expiresOn || null,
          last_tested_at: testedAt,
          updated_at: testedAt
        }, { onConflict: 'tenant_id,branch_code' });
      if (updateError) return res.status(500).json({ error: 'La conexión se validó, pero no se pudo guardar el resultado.' });
      return res.status(200).json({
        success: true,
        environment,
        tokenOk: true,
        certOk: true,
        expiresOn: certValidation.expiresOn,
        config: publicHaciendaConfig(haciendaConfig),
        message: `Conexión con Hacienda validada para la sucursal ${branchCode} (${environment.toUpperCase()}).`
      });
    }

    // ==========================================
    // ACCIÓN: CONSULTAR ESTADO DE COMPROBANTE
    // ==========================================
    if (action === 'consultar-estado') {
      if (!/^\d{50}$/.test(String(clave || ''))) {
        return res.status(400).json({ error: 'La clave debe contener exactamente 50 dígitos para consultar.' });
      }

      if (!statusQuerySnapshot || !branchId) {
        return res.status(404).json({ error: 'No se encontró el comprobante en este restaurante.' });
      }
      const statusLockToken = createHaciendaOperationLockToken();
      const lockClaim = await claimHaciendaOperationLock(supabaseAdmin, statusQuerySnapshot, statusLockToken);
      if (lockClaim.error) return res.status(500).json({ error: 'No se pudo reservar la consulta de estado.' });
      if (!lockClaim.updated) {
        return res.status(200).json({
          success: true,
          estado: 'procesando',
          clave,
          detalle: 'Otra operación de Hacienda está consultando esta clave; se actualizará al completarse.'
        });
      }
      const finishStatusQuery = (updates: Record<string, unknown>) => finishHaciendaOperationLock(
        supabaseAdmin, tenantId, branchId!, String(clave), statusLockToken, updates
      );
      const markStatusUnconfirmed = (message: string) => finishStatusQuery({
        hacienda_status: 'PROCESSING',
        error_message: message,
        accepted_at: null
      });

      if (!atvUsername || !atvPassword) {
        const saved = await markStatusUnconfirmed('No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.');
        if (saved.error || !saved.updated) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras faltar credenciales de consulta.' });
        }
        return res.status(502).json({ success: false, code: 'STATUS_QUERY_FAILED', error: 'No se pudo consultar el estado con las credenciales ATV de esta sucursal.' });
      }

      let token: string;
      try {
        token = await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);
      } catch {
        const saved = await markStatusUnconfirmed('No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.');
        if (saved.error || !saved.updated) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras fallar la autenticación con Hacienda.' });
        }
        return res.status(502).json({ success: false, code: 'STATUS_QUERY_FAILED', error: 'No se pudo obtener acceso para consultar el estado; el comprobante no se reenvió.' });
      }

      let statusResult: Awaited<ReturnType<typeof requestHaciendaStatus>>;
      try {
        statusResult = await requestHaciendaStatus(endpoints.api, token, String(clave));
      } catch {
        const saved = await markStatusUnconfirmed('No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.');
        if (saved.error || !saved.updated) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras fallar la consulta DGT.' });
        }
        return res.status(502).json({ success: false, code: 'STATUS_QUERY_FAILED', error: 'Falló la consulta del estado con Hacienda; no se reenvió el comprobante.' });
      }
      if (!statusResult.response.ok) {
        const saved = await markStatusUnconfirmed('No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.');
        if (saved.error || !saved.updated) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras una consulta HTTP fallida.' });
        }
        return res.status(502).json({
          success: false,
          code: 'STATUS_QUERY_FAILED',
          httpStatus: statusResult.response.status,
          error: 'No se pudo confirmar el estado del comprobante con Hacienda.'
        });
      }
      const normalizedStatus = statusResult.classification.status;
      const statusUpdate = await finishStatusQuery({
        hacienda_status: normalizedStatus,
        error_message: normalizedStatus === 'REJECTED' ? (statusResult.detail || null) : null,
        accepted_at: normalizedStatus === 'ACCEPTED' ? new Date().toISOString() : null
      });
      if (statusUpdate.error) return res.status(500).json({ error: 'No se pudo actualizar el estado del comprobante.' });
      if (!statusUpdate.updated) {
        return res.status(409).json({
          success: false,
          code: 'RESEND_ALREADY_CLAIMED',
          error: 'El estado cambió durante la consulta; se consultará de nuevo antes de cualquier reenvío.'
        });
      }

      return res.status(200).json({
        success: true,
        httpStatus: statusResult.response.status,
        estado: statusResult.indicator || undefined,
        detalle: statusResult.detail
      });
    }

    // ==========================================
    // ACCIÓN: EMITIR FACTURA (FIRMA XAdES + ENVÍO)
    // ==========================================
    if (!clave || !emisor) {
      return res.status(400).json({ error: 'Faltan datos requeridos (clave, emisor)' });
    }
    const documentTypeCodes: Record<string, string> = { FE: '01', ND: '02', NC: '03', TE: '04' };
    const expectedDocumentCode = documentTypeCodes[String(documentType || 'TE')];
    if (!/^\d{50}$/.test(String(clave)) || !/^\d{20}$/.test(String(consecutivo || '')) || String(clave).slice(21, 41) !== String(consecutivo)) {
      return res.status(400).json({ error: 'La clave y el consecutivo del comprobante no tienen el formato oficial esperado.' });
    }
    if (String(consecutivo).slice(0, 3) !== branchCode || String(consecutivo).slice(8, 10) !== expectedDocumentCode) {
      return res.status(400).json({ error: 'La sucursal o el tipo documental del consecutivo no coincide con la configuración seleccionada.' });
    }
    const requestedTerminal = String(emisor?.terminal || '').replace(/\D/g, '').padStart(5, '0').slice(-5);
    if (!requestedTerminal || String(consecutivo).slice(3, 8) !== requestedTerminal) {
      return res.status(400).json({ error: 'El terminal del emisor no coincide con el consecutivo del comprobante.' });
    }
    if (!atvUsername || !atvPassword || !rawP12 || !p12Pin) {
      return res.status(409).json({ error: 'Configura usuario, contraseña y llave digital para esta sucursal antes de emitir.' });
    }
    if (!haciendaConfig.isValidated) {
      return res.status(409).json({ error: 'Prueba y valida primero las credenciales de Hacienda de esta sucursal.' });
    }
    if (!haciendaConfig.codigoActividad || !haciendaConfig.provincia || !haciendaConfig.canton ||
        !haciendaConfig.distrito || !haciendaConfig.otrasSenas?.trim()) {
      return res.status(409).json({ error: 'Completa la actividad económica y ubicación fiscal real de esta sucursal antes de emitir.' });
    }
    const savedIssuerId = String(haciendaConfig?.cedulaEmisor || '').replace(/\D/g, '').replace(/^0+/, '');
    const requestIssuerId = String(emisor?.cedulaJuridica || emisor?.numeroIdentificacion || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!savedIssuerId || !requestIssuerId || savedIssuerId !== requestIssuerId) {
      return res.status(400).json({ error: 'La cédula del emisor del comprobante no coincide con la configuración de esta sucursal.' });
    }
    const issuerInClave = String(haciendaConfig?.cedulaEmisor || '').replace(/\D/g, '').padStart(12, '0').slice(-12);
    if (String(clave).slice(9, 21) !== issuerInClave) {
      return res.status(400).json({ error: 'La identificación incluida en la clave no coincide con el emisor de esta sucursal.' });
    }
    if (normalizeHaciendaBranchCode(emisor?.sucursal) !== branchCode) {
      return res.status(400).json({ error: 'La sucursal del comprobante no coincide con la configuración seleccionada.' });
    }

    let rejectionConfirmedForResend = false;
    const existingInvoice = await supabaseAdmin
      .from('pos_invoices')
      .select('branch_id, hacienda_status, signed_xml_content, error_message')
      .eq('tenant_id', tenantId)
      .eq('clave', clave)
      .maybeSingle();
    if (existingInvoice.error) return res.status(500).json({ error: 'No se pudo verificar el historial del comprobante.' });
    if (existingInvoice.data && existingInvoice.data.branch_id !== branchId) {
      return res.status(403).json({ error: 'El comprobante pertenece a otra sucursal.' });
    }
    const existingInvoiceSnapshot = existingInvoice.data
      ? invoiceSnapshot(tenantId, String(branchId), String(clave), existingInvoice.data)
      : null;
    if (existingInvoice.data && ['PROCESSING', 'ACCEPTED'].includes(existingInvoice.data.hacienda_status)) {
      return res.status(200).json({
        success: true,
        estado: existingInvoice.data.hacienda_status === 'ACCEPTED' ? 'ACEPTADO' : 'PROCESANDO',
        clave,
        signedXmlBase64: existingInvoice.data.signed_xml_content || undefined,
        mensaje: 'Este comprobante ya fue recibido anteriormente; no se reenvía para evitar duplicarlo.'
      });
    }
    if (action === 'resend') {
      if (!existingInvoice.data || existingInvoice.data.hacienda_status !== 'REJECTED') {
        return res.status(409).json({
          success: false,
          code: 'RESEND_NOT_CONFIRMED',
          error: 'No se reenvió: el comprobante no tiene un rechazo confirmado en el historial de esta sucursal.'
        });
      }
      let statusToken: string;
      try {
        statusToken = await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);
      } catch {
        const saved = existingInvoiceSnapshot && await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, existingInvoiceSnapshot, {
          hacienda_status: 'PROCESSING',
          error_message: 'No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.',
          accepted_at: null
        });
        if (!saved || saved.error) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras fallar la autenticación con Hacienda.' });
        }
        if (!saved.updated) return res.status(409).json({ success: false, code: 'RESEND_ALREADY_CLAIMED', error: 'El estado cambió durante la consulta; se consultará de nuevo antes de cualquier reenvío.' });
        return res.status(502).json({ success: false, code: 'STATUS_QUERY_FAILED', error: 'No se pudo consultar DGT para confirmar el rechazo; no se reenvió el comprobante.' });
      }
      let statusResult: Awaited<ReturnType<typeof requestHaciendaStatus>>;
      try {
        statusResult = await requestHaciendaStatus(endpoints.api, statusToken, String(clave));
      } catch {
        const saved = existingInvoiceSnapshot && await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, existingInvoiceSnapshot, {
          hacienda_status: 'PROCESSING',
          error_message: 'No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.',
          accepted_at: null
        });
        if (!saved || saved.error) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras fallar la consulta DGT.' });
        }
        if (!saved.updated) return res.status(409).json({ success: false, code: 'RESEND_ALREADY_CLAIMED', error: 'El estado cambió durante la consulta; se consultará de nuevo antes de cualquier reenvío.' });
        return res.status(502).json({ success: false, code: 'STATUS_QUERY_FAILED', error: 'Falló la consulta del estado con Hacienda; no se reenvió el comprobante.' });
      }
      if (!statusResult.response.ok) {
        const saved = existingInvoiceSnapshot && await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, existingInvoiceSnapshot, {
          hacienda_status: 'PROCESSING',
          error_message: 'No se pudo confirmar el estado actual con Hacienda; consulte de nuevo por clave.',
          accepted_at: null
        });
        if (!saved || saved.error) {
          return res.status(500).json({ error: 'No se pudo guardar el estado pendiente tras una consulta HTTP fallida.' });
        }
        if (!saved.updated) return res.status(409).json({ success: false, code: 'RESEND_ALREADY_CLAIMED', error: 'El estado cambió durante la consulta; se consultará de nuevo antes de cualquier reenvío.' });
        return res.status(502).json({
          success: false,
          code: 'STATUS_QUERY_FAILED',
          httpStatus: statusResult.response.status,
          error: 'No se pudo confirmar el rechazo actual con Hacienda; no se reenvió el comprobante.'
        });
      }
      if (!isConfirmedHaciendaRejection(statusResult.classification)) {
        const statusUpdate = existingInvoiceSnapshot && await updateHaciendaInvoiceIfSnapshot(supabaseAdmin, existingInvoiceSnapshot, {
          hacienda_status: statusResult.classification.status,
          error_message: statusResult.classification.status === 'REJECTED' ? (statusResult.detail || null) : null,
          accepted_at: statusResult.classification.status === 'ACCEPTED' ? new Date().toISOString() : null
        });
        if (!statusUpdate || statusUpdate.error) return res.status(500).json({ error: 'No se pudo actualizar el estado consultado.' });
        if (!statusUpdate.updated) return res.status(409).json({ success: false, code: 'RESEND_ALREADY_CLAIMED', error: 'El estado cambió durante la consulta; no se reenvió el comprobante.' });
        return res.status(200).json({
          success: true,
          estado: statusResult.classification.status === 'ACCEPTED' ? 'ACEPTADO' : 'PROCESANDO',
          clave,
          signedXmlBase64: existingInvoice.data.signed_xml_content || undefined,
          mensaje: 'La consulta actual no confirmó un rechazo; no se reenvió el comprobante.'
        });
      }
      rejectionConfirmedForResend = true;
    } else if (existingInvoice.data?.hacienda_status === 'REJECTED') {
      return res.status(409).json({
        success: false,
        code: 'STATUS_QUERY_REQUIRED',
        error: 'El comprobante ya existe y está rechazado; verifica su estado actual antes de solicitar un reenvío.'
      });
    } else if (existingInvoice.data && existingInvoice.data.hacienda_status !== 'PENDING') {
      return res.status(409).json({
        success: false,
        code: 'STATUS_QUERY_REQUIRED',
        error: 'Este comprobante ya tiene un registro; consulta su estado antes de cualquier nueva emisión.'
      });
    }

    let finalXmlBase64 = xmlBase64;

    // Si viene XML en texto crudo (o si hay que firmarlo con .p12)
    let rawXml = xmlString;
    if (!rawXml && xmlBase64) {
      try {
        rawXml = Buffer.from(xmlBase64, 'base64').toString('utf-8');
      } catch {
        // Ignorar si ya era binario
      }
    }

    if (rawP12 && p12Pin && rawXml && !isValidHaciendaP12Pin(p12Pin)) {
      return res.status(400).json({ error: HACIENDA_P12_PIN_FORMAT_ERROR });
    }
    if (rawXml) {
      const profileError = validateXmlAgainstBranchProfile(rawXml, haciendaConfig, String(clave), String(consecutivo || ''));
      if (profileError) return res.status(400).json({ error: profileError });
    }

    // 1. FIRMA DIGITAL XAdES-EPES CON LA LLAVE .P12
    if (rawXml) {
      try {
        const cleanP12 = rawP12.includes(',') ? rawP12.split(',')[1].replace(/\s+/g, '') : rawP12.replace(/\s+/g, '');
        // Verificar que el certificado pertenezca al emisor (evita error -60 de Hacienda)
        const info = parseAndVerifyP12(rawP12, p12Pin);
        const matches = info.subjectDigits.some((digit: string) => digit.length >= 6 && (digit === savedIssuerId || digit.endsWith(savedIssuerId) || savedIssuerId.endsWith(digit)));
        if (!matches) return res.status(400).json({ error: 'La llave .p12 no corresponde a la cédula configurada para esta sucursal.' });
        // signer.sign devuelve el XML firmado convertido directamente a Base64
        finalXmlBase64 = await signer.sign(rawXml, cleanP12, p12Pin);
      } catch {
        console.error('[Hacienda] No se pudo validar o firmar el comprobante.');
        return res.status(400).json({
          error: 'No se pudo validar o firmar el XML con la llave .p12. Revisa el archivo y su PIN o contraseña.'
        });
      }
    } else if (!finalXmlBase64) {
      return res.status(400).json({ 
        error: 'XML no proporcionado o imposible de firmar (se requiere archivo .p12 y PIN, o xmlBase64 ya firmado)' 
      });
    }

    // 2. Obtener Token de Hacienda (OAuth2)
    const accessToken = await getHaciendaToken(endpoints.token, endpoints.clientId, atvUsername, atvPassword);

    // 3. Preparar Payload oficial para Recepción
    const emisorIdRaw = String(emisor?.cedulaJuridica || emisor?.numeroIdentificacion || '').replace(/[^0-9]/g, '');
    if (!emisorIdRaw) {
      return res.status(400).json({
      error: 'Falta la cédula del emisor en la configuración de Hacienda de esta sucursal.'
      });
    }
    const payload: any = {
      clave: clave,
      fecha: fecha || getCostaRicaIsoDate(),
      emisor: {
        tipoIdentificacion: String(haciendaConfig?.tipoIdentificacion || emisor.tipoIdentificacion || '02').substring(0, 2),
        numeroIdentificacion: savedIssuerId
      },
      comprobanteXml: finalXmlBase64
    };

    if (receptor && (receptor.identificacion || receptor.numeroIdentificacion)) {
      payload.receptor = {
        tipoIdentificacion: String(receptor.tipoIdentificacion || '01').substring(0, 2),
        numeroIdentificacion: String(receptor.identificacion || receptor.numeroIdentificacion).replace(/[^0-9]/g, '')
      };
    }

    const invoiceData = sanitizeFiscalInvoiceData({
      emisor,
      receptor: receptor || null,
      documentType: String(documentType || 'TE').slice(0, 2),
      fechaEmision: fecha || getCostaRicaIsoDate(),
      total: Number(total || 0),
      codigoActividadReceptor,
      condicionVenta,
      medioPago,
      moneda,
      tipoCambio,
      pagos,
      items: Array.isArray(items) ? items : [],
      subtotal: Number(subtotal || 0),
      iva13: Number(iva13 || 0),
      iva4: Number(iva4 || 0),
      iva2: Number(iva2 || 0),
      iva1: Number(iva1 || 0),
      servicio10: Number(servicio10 || 0),
      clave,
      consecutivo: String(consecutivo || clave).slice(0, 20)
    });
    const issuedAt = parseFiscalInvoiceIssuedAt(invoiceData.fechaEmision);
    const payloadBody = JSON.stringify(payload);
    const submissionLockToken = createHaciendaOperationLockToken();
    const invoiceRecord = {
      tenant_id: tenantId,
      branch_id: branchId,
      clave,
      consecutivo: String(consecutivo || clave).slice(0, 20),
      document_type: String(documentType || 'TE').slice(0, 2),
      total: Number(total || 0),
      ...(issuedAt ? { issued_at: issuedAt } : {}),
      invoice_data: invoiceData,
      xml_content: rawXml || null,
      signed_xml_content: finalXmlBase64
    };
    if (!canReserveHaciendaSubmission(existingInvoiceSnapshot, action === 'resend' ? 'resend' : 'emit', rejectionConfirmedForResend)) {
      return res.status(409).json({
        success: false,
        submitted: false,
        code: 'RESEND_ALREADY_CLAIMED',
        error: 'El estado actual no permite una nueva emisión; se consultará la clave antes de cualquier reenvío.'
      });
    }
    const reservation = await reserveHaciendaSubmission(existingInvoiceSnapshot, submissionLockToken, invoiceRecord);
    if (!reservation.lockToken) {
      return res.status(reservation.error ? 503 : 409).json({
        success: false,
        submitted: false,
        code: 'RESEND_ALREADY_CLAIMED',
        error: reservation.error
          ? 'No se pudo confirmar la reserva de emisión; se consultará la clave antes de intentar otra transmisión.'
          : 'Otra solicitud reservó este comprobante; se consultará la clave antes de cualquier reenvío.'
      });
    }

    // 4. Enviar a Recepción de Hacienda
    providerSubmissionAttempted = true;
    let recepcionRes: Response;
    try {
      recepcionRes = await fetch(endpoints.api, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: payloadBody
      });
    } catch {
      const saved = await finishHaciendaOperationLock(supabaseAdmin, tenantId, String(branchId), String(clave), submissionLockToken, {
        ...invoiceRecord,
        hacienda_status: 'PROCESSING',
        submitted_at: new Date().toISOString(),
        error_message: 'Se perdió la respuesta de recepción; consulte el estado por clave antes de cualquier reenvío.'
      });
      if (saved.error || !saved.updated) console.error('[Hacienda] No se pudo finalizar el lock tras perder la respuesta.');
      return res.status(502).json({
        success: false,
        submitted: true,
        code: 'SUBMISSION_UNCONFIRMED',
        error: saved.error || !saved.updated
          ? 'Se perdió la respuesta y no se pudo guardar su resultado; la clave quedó reservada para impedir duplicados. Consulte más tarde.'
          : 'Se perdió la respuesta de recepción. El resultado es incierto y debe consultarse por clave antes de reenviar.'
      });
    }

    if (recepcionRes.status === 202) {
      const saved = await finishHaciendaOperationLock(supabaseAdmin, tenantId, String(branchId), String(clave), submissionLockToken, {
        ...invoiceRecord,
        hacienda_status: 'PROCESSING',
        submitted_at: new Date().toISOString(),
        error_message: null
      });
      if (saved.error || !saved.updated) {
        console.error('[Hacienda] No se pudo persistir un comprobante recibido.');
        return res.status(502).json({
          success: false,
          submitted: true,
          code: 'SUBMISSION_UNCONFIRMED',
          error: 'Hacienda recibió la solicitud, pero no se pudo finalizar su estado local. La clave permanece reservada; consulte más tarde.'
        });
      }
      return res.status(200).json({ 
        success: true, 
        estado: 'PROCESANDO', 
        clave: clave,
        mensaje: 'Factura firmada con XAdES-EPES y recibida por Hacienda CR. Pendiente de validación asíncrona.',
        signedXmlBase64: finalXmlBase64
      });
    } else {
      console.warn('[Hacienda] La respuesta de recepción no confirmó el estado del comprobante.', recepcionRes.status);
      const saved = await finishHaciendaOperationLock(supabaseAdmin, tenantId, String(branchId), String(clave), submissionLockToken, {
        ...invoiceRecord,
        hacienda_status: 'PROCESSING',
        submitted_at: new Date().toISOString(),
        error_message: 'La recepción no confirmó el estado; consulte el comprobante por clave.'
      });
      if (saved.error || !saved.updated) {
        console.error('[Hacienda] No se pudo persistir el estado pendiente de un comprobante.');
        return res.status(502).json({
          success: false,
          submitted: true,
          code: 'SUBMISSION_UNCONFIRMED',
          error: 'La recepción no confirmó el estado y tampoco se pudo guardar el resultado. La clave permanece reservada; consulte más tarde.',
          status: recepcionRes.status
        });
      }
      return res.status(502).json({
        success: false,
        submitted: true,
        code: 'SUBMISSION_UNCONFIRMED',
        error: 'No se confirmó la recepción con Hacienda; se consultará por clave antes de permitir cualquier reenvío.',
        status: recepcionRes.status,
        signedXmlBase64: finalXmlBase64
      });
    }

  } catch (error) {
    if (error instanceof HaciendaStorageUnavailableError) {
      return res.status(503).json({
        success: false,
        submitted: providerSubmissionAttempted,
        code: providerSubmissionAttempted ? 'SUBMISSION_UNCONFIRMED' : 'NOT_SUBMITTED',
        error: 'El almacenamiento seguro de Hacienda no está disponible. Verifica la clave de cifrado del servidor y el acceso al almacenamiento.'
      });
    }
    console.error('[Hacienda] Error interno procesando la solicitud.');
    return res.status(500).json({
      success: false,
      submitted: providerSubmissionAttempted,
      code: providerSubmissionAttempted ? 'SUBMISSION_UNCONFIRMED' : 'NOT_SUBMITTED',
      error: providerSubmissionAttempted
        ? 'No se confirmó la respuesta de Hacienda; consulte el estado por clave antes de reenviar.'
        : 'La operación no se transmitió a Hacienda; corrija el problema y vuelva a intentarlo.'
    });
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
    throw new Error('No se pudo autenticar con Hacienda; revisa las credenciales de esta sucursal.');
  }

  return tokenData.access_token;
}
