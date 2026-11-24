import { mergeConcurrentTableLayouts, mergeConcurrentTenantZones } from './tableLayoutConcurrency.ts';
import { normalizeTenantZones } from './tenantZones.ts';
import { validateTableLayout, type TableLayoutItem } from './tableLayoutValidation.ts';

export interface BranchFloorplanRecord {
  branchId: string;
  zones: string[];
  layout: TableLayoutItem[];
  updatedAt: string | null;
}

export interface BranchFloorplanSnapshot {
  zones: string[];
  layout: TableLayoutItem[];
  updatedAt: string | null;
}

export class BranchFloorplanRequestError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly current?: BranchFloorplanRecord;

  constructor(
    message: string,
    code: string,
    status: number,
    current?: BranchFloorplanRecord
  ) {
    super(message);
    this.name = 'BranchFloorplanRequestError';
    this.code = code;
    this.status = status;
    this.current = current;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readToken(): string {
  try {
    const token = localStorage.getItem('saborai_token');
    if (token) return token;
  } catch {}
  throw new Error('No hay una sesión autenticada para cargar o guardar el plano.');
}

function parseRecord(value: unknown, expectedBranchId: string): BranchFloorplanRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El servidor devolvió un plano con formato inválido.');
  }
  const row = value as Record<string, unknown>;
  const zones = normalizeTenantZones(row.zones);
  const layout = validateTableLayout(row.layout);
  if (row.branchId !== expectedBranchId || !zones || !layout
    || !(row.updatedAt === null || typeof row.updatedAt === 'string')) {
    throw new Error('El servidor devolvió un plano inválido o de otra sucursal.');
  }
  return { branchId: expectedBranchId, zones, layout, updatedAt: row.updatedAt as string | null };
}

async function readResponse(response: Response, branchId: string): Promise<BranchFloorplanRecord> {
  let payload: any;
  try { payload = await response.json(); } catch {}
  if (response.status === 409 && payload?.floorplan) {
    throw new BranchFloorplanRequestError(
      payload.error || 'El plano cambió en otro dispositivo.',
      payload.code || 'FLOORPLAN_CONFLICT',
      response.status,
      parseRecord(payload.floorplan, branchId)
    );
  }
  if (!response.ok || payload?.success !== true) {
    throw new BranchFloorplanRequestError(
      typeof payload?.error === 'string' ? payload.error : 'No se pudo confirmar el plano de esta sucursal.',
      typeof payload?.code === 'string' ? payload.code : 'FLOORPLAN_REQUEST_FAILED',
      response.status
    );
  }
  return parseRecord(payload.floorplan, branchId);
}

export async function readBranchFloorplan(
  tenantId: string,
  branchId: string,
  request: typeof fetch = fetch
): Promise<BranchFloorplanRecord> {
  if (!isUuid(tenantId) || !isUuid(branchId)) throw new Error('El restaurante y la sucursal deben ser válidos.');
  const response = await request(`/api/tenant/floorplan?branchId=${encodeURIComponent(branchId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${readToken()}` }
  });
  return readResponse(response, branchId);
}

export async function writeBranchFloorplan(
  tenantId: string,
  record: BranchFloorplanSnapshot,
  branchId: string,
  request: typeof fetch = fetch
): Promise<BranchFloorplanRecord> {
  if (!isUuid(tenantId) || !isUuid(branchId)) throw new Error('El restaurante y la sucursal deben ser válidos.');
  const zones = normalizeTenantZones(record.zones);
  const layout = validateTableLayout(record.layout);
  if (!zones || !layout || !(record.updatedAt === null || typeof record.updatedAt === 'string')) {
    throw new Error('El plano que se intenta guardar no es válido.');
  }
  const response = await request('/api/tenant/floorplan', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${readToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      branchId,
      zones,
      layout,
      expectedUpdatedAt: record.updatedAt
    })
  });
  return readResponse(response, branchId);
}

/** Guarda con compare-and-swap; los cambios independientes se mezclan y los conflictos de la misma mesa/zona prevalecen desde la nube. */
export async function persistBranchFloorplan(
  tenantId: string,
  branchId: string,
  base: BranchFloorplanRecord,
  desired: Pick<BranchFloorplanSnapshot, 'zones' | 'layout'>,
  request: typeof fetch = fetch,
  maxAttempts = 5
): Promise<BranchFloorplanRecord> {
  if (base.branchId !== branchId) throw new Error('La versión base pertenece a otra sucursal.');
  const localZones = normalizeTenantZones(desired.zones);
  const localLayout = validateTableLayout(desired.layout);
  if (!localZones || !localLayout) throw new Error('El plano que se intenta guardar no es válido.');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await readBranchFloorplan(tenantId, branchId, request);
    const zones = mergeConcurrentTenantZones(base.zones, localZones, current.zones);
    const layout = mergeConcurrentTableLayouts(base.layout, localLayout, current.layout);
    if (JSON.stringify(zones) === JSON.stringify(current.zones)
      && JSON.stringify(layout) === JSON.stringify(current.layout)) return current;

    try {
      return await writeBranchFloorplan(tenantId, {
        zones,
        layout,
        updatedAt: current.updatedAt
      }, branchId, request);
    } catch (error) {
      if (!(error instanceof BranchFloorplanRequestError)
        || error.code !== 'FLOORPLAN_CONFLICT' || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error('No se pudo guardar el plano después de varios cambios simultáneos.');
}

/** El API usa service_role, así que los clientes refrescan por polling y por eventos de conectividad/visibilidad. */
export function subscribeToBranchFloorplan(
  tenantId: string,
  branchId: string,
  onChange: (record: BranchFloorplanRecord) => void,
  onError?: (error: unknown) => void,
  intervalMs = 15_000,
  request: typeof fetch = fetch
): () => void {
  let active = true;
  let inFlight = false;
  let lastUpdatedAt: string | null | undefined;
  const refresh = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const record = await readBranchFloorplan(tenantId, branchId, request);
      if (!active) return;
      if (lastUpdatedAt === undefined || record.updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = record.updatedAt;
        onChange(record);
      }
    } catch (error) {
      if (active) onError?.(error);
    } finally {
      inFlight = false;
    }
  };
  const handleResume = () => { void refresh(); };
  const timer = window.setInterval(() => { void refresh(); }, intervalMs);
  window.addEventListener('online', handleResume);
  window.addEventListener('focus', handleResume);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener('online', handleResume);
    window.removeEventListener('focus', handleResume);
  };
}
