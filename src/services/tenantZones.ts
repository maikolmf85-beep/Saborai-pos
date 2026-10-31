export function normalizeTenantZones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((zone): zone is string => typeof zone === 'string')
    .map(zone => zone.trim())
    .filter(Boolean)));
}

/** Una lista válida del servidor es autoritativa, también cuando está vacía. */
export function resolveTenantZones(serverZones: unknown, cachedZones: unknown): string[] {
  return normalizeTenantZones(Array.isArray(serverZones) ? serverZones : cachedZones);
}

/** Los snapshots de una sesión con datos locales no pueden revivir zonas antiguas. */
export function resolveRealtimeTenantZones(
  incomingZones: unknown,
  currentZones: unknown,
  isSnapshot: boolean,
  hasLocalData: boolean
): string[] {
  if (isSnapshot && hasLocalData) return normalizeTenantZones(currentZones);
  return resolveTenantZones(incomingZones, currentZones);
}

export function removeTenantZone(zones: readonly string[], zoneToRemove: string): string[] {
  return normalizeTenantZones(zones).filter(zone => zone !== zoneToRemove);
}

type TenantZonesFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Envía la lista exacta y solo resuelve si el servidor confirma el mismo estado. */
export async function persistTenantZones(
  zones: readonly string[],
  token: string,
  request: TenantZonesFetch = fetch
): Promise<string[]> {
  if (!token.trim()) throw new Error('No hay una sesión autenticada para guardar los salones.');

  const desiredZones = normalizeTenantZones(zones);
  const response = await request('/api/tenant/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ zones: desiredZones })
  });
  const result = await response.json().catch(() => null) as {
    success?: boolean;
    zones?: unknown;
    error?: string;
  } | null;

  if (!response.ok || !result?.success || !Array.isArray(result.zones)) {
    throw new Error(result?.error || 'El servidor no confirmó el guardado de los salones.');
  }

  const savedZones = normalizeTenantZones(result.zones);
  if (JSON.stringify(savedZones) !== JSON.stringify(desiredZones)) {
    throw new Error('El servidor devolvió una lista de salones distinta a la solicitada.');
  }
  return savedZones;
}
