export function cleanTenantZones(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value
    .filter((zone): zone is string => typeof zone === 'string')
    .map(zone => zone.trim())
    .filter(Boolean)
  )).slice(0, 200);
}

export async function updateTenantZonesInSupabase(
  supabase: any,
  tenantId: string,
  userId: string,
  zones: string[]
) {
  return await supabase
    .from('tenants')
    .update({ zones })
    .eq('id', tenantId)
    .eq('user_id', userId)
    .select('id, zones')
    .single();
}
