export function normalizeSalonOptions(zones: readonly unknown[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const zone of zones || []) {
    if (typeof zone !== 'string') continue;
    const name = zone.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    normalized.push(name);
  }

  return normalized;
}

/** Resolve an opening assignment against real tenant salons, preferring an explicit floor-plan request. */
export function getInitialShiftZones(
  tenantZones: readonly unknown[] | null | undefined,
  registerZones: readonly unknown[] | null | undefined,
  requestedZone?: string | null
): string[] {
  const availableZones = normalizeSalonOptions(tenantZones);
  const canonicalByKey = new Map(availableZones.map(zone => [zone.toLocaleLowerCase(), zone]));
  const requestedKey = typeof requestedZone === 'string' ? requestedZone.trim().toLocaleLowerCase() : '';
  const requestedMatch = requestedKey ? canonicalByKey.get(requestedKey) : undefined;

  if (requestedMatch) return [requestedMatch];

  return normalizeSalonOptions(registerZones)
    .map(zone => canonicalByKey.get(zone.toLocaleLowerCase()))
    .filter((zone): zone is string => Boolean(zone));
}
