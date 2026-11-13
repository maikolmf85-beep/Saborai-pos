import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleOptions, requireAuth, setCorsHeaders } from './security.js';
import { supabaseAdmin } from './supabase.js';
import { ROLE_PERMISSIONS } from './rolePermissions.js';
import { HACIENDA_P12_PIN_FORMAT_ERROR, isValidHaciendaP12Pin, isValidHaciendaP12PinInput } from '../../src/utils/haciendaP12Pin.js';
import {
  decryptHaciendaConfig,
  encryptHaciendaConfig,
  mergeHaciendaConfig,
  normalizeHaciendaBranchCode,
  publicHaciendaConfig,
  type EncryptedHaciendaConfig
} from './haciendaConfig.js';

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function respondStorageError(res: VercelResponse): void {
  res.status(503).json({
    error: 'El almacenamiento seguro de Hacienda no está disponible. Verifica la clave de cifrado del servidor y el acceso al almacenamiento.'
  });
}

export async function handleHaciendaConfigRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const permittedRoles = req.method === 'GET'
    ? ROLE_PERMISSIONS.haciendaOperations
    : ROLE_PERMISSIONS.haciendaSettings;
  const auth = await requireAuth(req, res, [...permittedRoles]);
  if (!auth) return;
  if (!auth.tenantId) {
    res.status(403).json({ error: 'La sesión no tiene un restaurante asociado.' });
    return;
  }

  try {
    const { data: branches, error: branchesError } = await supabaseAdmin
      .from('pos_branches')
      .select('id, name, code')
      .eq('tenant_id', auth.tenantId)
      .eq('is_active', true)
      .order('code', { ascending: true });
    if (branchesError) {
      console.error('[Hacienda Config] No se pudieron consultar sucursales.');
      res.status(500).json({ error: 'No se pudieron cargar las sucursales del restaurante.' });
      return;
    }

    if (req.method === 'GET') {
      const rawBranchCode = queryString(req.query.branchCode);
      if (!rawBranchCode) {
        res.status(200).json({ success: true, branches: branches || [] });
        return;
      }
      const branchCode = normalizeHaciendaBranchCode(rawBranchCode);
      if (!branchCode) {
        res.status(400).json({ error: 'El código de sucursal debe tener de 1 a 3 dígitos.' });
        return;
      }
      const branch = (branches || []).find(item => item.code === branchCode);
      if (!branch) {
        res.status(404).json({ error: 'La sucursal no pertenece a este restaurante o está inactiva.' });
        return;
      }

      const { data: record, error } = await supabaseAdmin
        .from('pos_hacienda_configs')
        .select('encrypted_config')
        .eq('tenant_id', auth.tenantId)
        .eq('branch_code', branchCode)
        .maybeSingle();
      if (error) {
        console.error('[Hacienda Config] El registro seguro no está disponible.');
        respondStorageError(res);
        return;
      }
      if (!record) {
        res.status(200).json({ success: true, branches: branches || [], branch, config: null });
        return;
      }

      let config;
      try {
        config = decryptHaciendaConfig(record.encrypted_config as EncryptedHaciendaConfig, auth.tenantId, branchCode);
      } catch {
        console.error('[Hacienda Config] No se pudo descifrar una configuración de sucursal.');
        respondStorageError(res);
        return;
      }
      res.status(200).json({ success: true, branches: branches || [], branch, config: publicHaciendaConfig(config) });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const submittedConfig = body.config && typeof body.config === 'object' && !Array.isArray(body.config)
      ? body.config as Record<string, unknown>
      : {};
    if (
      Object.prototype.hasOwnProperty.call(submittedConfig, 'pinP12') &&
      !isValidHaciendaP12PinInput(submittedConfig.pinP12)
    ) {
      res.status(400).json({ error: HACIENDA_P12_PIN_FORMAT_ERROR });
      return;
    }
    const branchCode = normalizeHaciendaBranchCode(body.branchCode);
    if (!branchCode) {
      res.status(400).json({ error: 'Selecciona una sucursal válida antes de guardar.' });
      return;
    }
    const branch = (branches || []).find(item => item.code === branchCode);
    if (!branch) {
      res.status(404).json({ error: 'La sucursal no pertenece a este restaurante o está inactiva. Sincroniza primero las sucursales del POS.' });
      return;
    }

    const { data: existingRecord, error: existingError } = await supabaseAdmin
      .from('pos_hacienda_configs')
      .select('encrypted_config')
      .eq('tenant_id', auth.tenantId)
      .eq('branch_code', branchCode)
      .maybeSingle();
    if (existingError) {
      console.error('[Hacienda Config] No se pudo leer el registro previo.');
      respondStorageError(res);
      return;
    }

    let existingConfig = null;
    if (existingRecord) {
      try {
        existingConfig = decryptHaciendaConfig(existingRecord.encrypted_config as EncryptedHaciendaConfig, auth.tenantId, branchCode);
      } catch {
        console.error('[Hacienda Config] No se pudo descifrar el registro previo.');
        respondStorageError(res);
        return;
      }
    }

    const config = mergeHaciendaConfig(existingConfig, body.config, {
      removeCertificate: body.removeCertificate === true,
      clearAtvCredentials: body.clearAtvCredentials === true
    });
    if (Boolean(config.atvUsername) !== Boolean(config.atvPassword)) {
      res.status(400).json({ error: 'Para registrar credenciales de ATV debes indicar usuario y contraseña juntos.' });
      return;
    }
    if (Boolean(config.p12Base64) !== Boolean(config.pinP12)) {
      res.status(400).json({ error: 'Para registrar la llave .p12 debes indicar su PIN o contraseña junto con el archivo.' });
      return;
    }
    if (config.pinP12 && !isValidHaciendaP12Pin(config.pinP12)) {
      res.status(400).json({ error: HACIENDA_P12_PIN_FORMAT_ERROR });
      return;
    }

    let encryptedConfig: EncryptedHaciendaConfig;
    try {
      encryptedConfig = encryptHaciendaConfig(config, auth.tenantId, branchCode);
    } catch {
      console.error('[Hacienda Config] Falta la clave de cifrado del servidor o no es válida.');
      respondStorageError(res);
      return;
    }

    const { error: saveError } = await supabaseAdmin
      .from('pos_hacienda_configs')
      .upsert({
        tenant_id: auth.tenantId,
        branch_code: branchCode,
        environment: config.environment,
        encrypted_config: encryptedConfig,
        is_validated: Boolean(config.isValidated),
        cert_expires_on: config.certExpiresOn || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id,branch_code' });
    if (saveError) {
      console.error('[Hacienda Config] No se pudo guardar la configuración cifrada.');
      respondStorageError(res);
      return;
    }

    res.status(200).json({
      success: true,
      branch,
      config: publicHaciendaConfig(config),
      message: 'Configuración de Hacienda guardada de forma segura para esta sucursal.'
    });
  } catch {
    console.error('[Hacienda Config] Error procesando la solicitud.');
    res.status(500).json({ error: 'No se pudo procesar la configuración de Hacienda.' });
  }
}
