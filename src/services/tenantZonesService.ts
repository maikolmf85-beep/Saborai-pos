export interface TenantZonesResponse {
  success?: unknown;
  zones?: unknown;
  error?: unknown;
}

export async function persistTenantZones(
  zones: string[],
  token: string | null | undefined,
  fetcher: typeof fetch = fetch
): Promise<string[]> {
  if (!token?.trim()) {
    throw new Error('No hay una sesión válida para guardar los salones. Inicia sesión e inténtalo de nuevo.');
  }

  const response = await fetcher('/api/tenant/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ zones })
  });

  let result: TenantZonesResponse;
  try {
    result = await response.json() as TenantZonesResponse;
  } catch {
    throw new Error('El servidor devolvió una respuesta inválida al guardar los salones.');
  }

  if (!response.ok || result.success !== true) {
    const message = typeof result.error === 'string' && result.error.trim()
      ? result.error
      : `No se pudieron guardar los salones (HTTP ${response.status}).`;
    throw new Error(message);
  }

  if (!Array.isArray(result.zones) || result.zones.some(zone => typeof zone !== 'string')) {
    throw new Error('El servidor no confirmó la lista de salones guardada.');
  }

  return result.zones as string[];
}
