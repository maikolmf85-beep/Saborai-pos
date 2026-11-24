import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cleanTenantZones } from './tenantZones.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders, checkRateLimit } from './security.js';
import { supabaseAdmin } from './supabase.js';
import { validateTableLayout, type TableLayoutItem } from '../../src/services/tableLayoutValidation.js';

const FLOORPLAN_TABLE = 'pos_branch_floorplans';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BranchFloorplanRecord {
  branchId: string;
  zones: string[];
  layout: TableLayoutItem[];
  updatedAt: string | null;
}

export class BranchFloorplanError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message);
    this.name = 'BranchFloorplanError';
    this.status = status;
    this.code = code;
  }
}

export function isBranchFloorplanUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function cleanBranchFloorplanPayload(value: unknown): { zones: string[]; layout: TableLayoutItem[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const zones = cleanTenantZones(payload.zones);
  const layout = validateTableLayout(payload.layout);
  if (!zones || !layout || zones.length > 100 || layout.length > 500) return null;
  if (zones.some(zone => zone.length > 120)) return null;
  if (layout.some(item => item.id.length > 120 || item.name.length > 120 || item.zone.length > 120)) return null;
  return { zones, layout };
}

function parseFloorplanRow(row: any, branchId: string): BranchFloorplanRecord | null {
  if (!row || row.branch_id !== branchId) return null;
  const payload = cleanBranchFloorplanPayload({ zones: row.zones, layout: row.layout });
  if (!payload) return null;
  return {
    branchId,
    ...payload,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
  };
}

async function verifyActiveBranch(admin: any, tenantId: string, branchId: string): Promise<void> {
  const { data, error } = await admin.from('pos_branches')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new BranchFloorplanError(503, 'BRANCH_SCOPE_UNAVAILABLE', 'No se pudo verificar la sucursal; el plano quedó sin cambios.');
  if (!data) throw new BranchFloorplanError(404, 'BRANCH_NOT_AVAILABLE', 'La sucursal no pertenece a este restaurante o está inactiva.');
}

async function readCurrentRecord(admin: any, tenantId: string, branchId: string): Promise<BranchFloorplanRecord | null> {
  const { data, error } = await admin.from(FLOORPLAN_TABLE)
    .select('branch_id, zones, layout, updated_at')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw new BranchFloorplanError(503, 'FLOORPLAN_STORAGE_UNAVAILABLE', 'El almacenamiento del plano por sucursal no está disponible.');
  if (!data) return null;
  const record = parseFloorplanRow(data, branchId);
  if (!record) throw new BranchFloorplanError(503, 'FLOORPLAN_RECORD_INVALID', 'El plano guardado para esta sucursal no tiene un formato válido.');
  return record;
}

export async function readBranchFloorplan(
  admin: any,
  tenantId: string,
  branchId: string
): Promise<BranchFloorplanRecord> {
  if (!isBranchFloorplanUuid(tenantId) || !isBranchFloorplanUuid(branchId)) {
    throw new BranchFloorplanError(400, 'BRANCH_SCOPE_INVALID', 'La sucursal indicada no es válida.');
  }
  await verifyActiveBranch(admin, tenantId, branchId);
  return (await readCurrentRecord(admin, tenantId, branchId)) || {
    branchId,
    zones: [],
    layout: [],
    updatedAt: null
  };
}

export async function writeBranchFloorplan(
  admin: any,
  input: {
    tenantId: string;
    branchId: string;
    zones: string[];
    layout: TableLayoutItem[];
    expectedUpdatedAt: string | null;
  }
): Promise<{ record: BranchFloorplanRecord; conflict: boolean }> {
  const { tenantId, branchId, zones, layout, expectedUpdatedAt } = input;
  if (!isBranchFloorplanUuid(tenantId) || !isBranchFloorplanUuid(branchId)) {
    throw new BranchFloorplanError(400, 'BRANCH_SCOPE_INVALID', 'La sucursal indicada no es válida.');
  }
  await verifyActiveBranch(admin, tenantId, branchId);
  const current = await readCurrentRecord(admin, tenantId, branchId);

  if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
    return { record: current || { branchId, zones: [], layout: [], updatedAt: null }, conflict: true };
  }

  if (!current) {
    const inserted = await admin.from(FLOORPLAN_TABLE)
      .insert({ tenant_id: tenantId, branch_id: branchId, zones, layout })
      .select('branch_id, zones, layout, updated_at')
      .single();
    if (inserted.error) {
      if (inserted.error.code === '23505' || inserted.error.code === '409') {
        return {
          record: (await readCurrentRecord(admin, tenantId, branchId)) || { branchId, zones: [], layout: [], updatedAt: null },
          conflict: true
        };
      }
      throw new BranchFloorplanError(503, 'FLOORPLAN_STORAGE_UNAVAILABLE', 'No se pudo guardar el plano de esta sucursal.');
    }
    const record = parseFloorplanRow(inserted.data, branchId);
    if (!record) throw new BranchFloorplanError(503, 'FLOORPLAN_SAVE_UNCONFIRMED', 'El servidor no confirmó el plano guardado.');
    return { record, conflict: false };
  }

  const updated = await admin.from(FLOORPLAN_TABLE)
    .update({ zones, layout })
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('updated_at', expectedUpdatedAt)
    .select('branch_id, zones, layout, updated_at')
    .maybeSingle();
  if (updated.error) throw new BranchFloorplanError(503, 'FLOORPLAN_STORAGE_UNAVAILABLE', 'No se pudo guardar el plano de esta sucursal.');
  if (!updated.data) {
    return {
      record: (await readCurrentRecord(admin, tenantId, branchId)) || { branchId, zones: [], layout: [], updatedAt: null },
      conflict: true
    };
  }
  const record = parseFloorplanRow(updated.data, branchId);
  if (!record) throw new BranchFloorplanError(503, 'FLOORPLAN_SAVE_UNCONFIRMED', 'El servidor no confirmó el plano guardado.');
  return { record, conflict: false };
}

export default async function branchFloorplanHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!auth.tenantId) {
    res.status(403).json({ error: 'La sesión no tiene un restaurante asociado.' });
    return;
  }
  if (req.method === 'PUT' && !requireRole(auth, res, ['ADMIN'])) return;

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const rawBranchId = req.method === 'GET' ? req.query.branchId : body.branchId;
  const branchId = Array.isArray(rawBranchId) ? rawBranchId[0] : rawBranchId;
  if (!isBranchFloorplanUuid(branchId)) {
    res.status(400).json({ error: 'Se requiere un UUID válido de sucursal.', code: 'BRANCH_SCOPE_INVALID' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const floorplan = await readBranchFloorplan(supabaseAdmin, auth.tenantId, branchId);
      res.status(200).json({ success: true, floorplan });
    } catch (error) {
      const failure = error instanceof BranchFloorplanError
        ? error
        : new BranchFloorplanError(503, 'FLOORPLAN_STORAGE_UNAVAILABLE', 'No se pudo cargar el plano de esta sucursal.');
      if (failure.status >= 500) console.error('[Branch Floorplan] Falló la lectura del plano.', { code: failure.code });
      res.status(failure.status).json({ error: failure.message, code: failure.code });
    }
    return;
  }

  const rateLimit = checkRateLimit(`branch-floorplan:${auth.userId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    res.status(429).json({ error: 'Demasiados cambios en el plano. Espera un minuto antes de volver a guardar.' });
    return;
  }

  const payload = cleanBranchFloorplanPayload(body);
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (!payload || !(expectedUpdatedAt === null || (typeof expectedUpdatedAt === 'string' && expectedUpdatedAt.length <= 80))) {
    res.status(400).json({ error: 'Los salones, el plano o la versión base no son válidos.' });
    return;
  }

  try {
    const result = await writeBranchFloorplan(supabaseAdmin, {
      tenantId: auth.tenantId,
      branchId,
      ...payload,
      expectedUpdatedAt: expectedUpdatedAt as string | null
    });
    if (result.conflict) {
      res.status(409).json({ error: 'El plano cambió desde la última lectura.', code: 'FLOORPLAN_CONFLICT', floorplan: result.record });
      return;
    }
    res.status(200).json({ success: true, floorplan: result.record });
  } catch (error) {
    const failure = error instanceof BranchFloorplanError
      ? error
      : new BranchFloorplanError(503, 'FLOORPLAN_STORAGE_UNAVAILABLE', 'No se pudo guardar el plano de esta sucursal.');
    if (failure.status >= 500) console.error('[Branch Floorplan] Falló el guardado del plano.', { code: failure.code });
    res.status(failure.status).json({ error: failure.message, code: failure.code });
  }
}
