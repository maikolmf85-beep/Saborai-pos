function toEpochNanoseconds(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const epochMilliseconds = Date.parse(value);
  if (!Number.isFinite(epochMilliseconds)) return null;

  // Date.parse conserva sólo milisegundos. Supabase timestamptz puede incluir
  // microsegundos; agrega los dígitos posteriores al milisegundo para ordenar
  // eventos del mismo ms sin aceptar una instantánea anterior como más nueva.
  const fractionalSecond = value.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:?\d{2})?$)/i)?.[1] || '';
  const subMillisecondNanoseconds = fractionalSecond.slice(3, 9).padEnd(6, '0');
  return BigInt(Math.trunc(epochMilliseconds)) * 1_000_000n
    + BigInt(subMillisecondNanoseconds || '0');
}

/** True only when `incoming` represents a strictly later instant than `accepted`. */
export function isNewerTableLayoutTimestamp(
  incoming: string | null | undefined,
  accepted: string | null | undefined
): boolean {
  if (!accepted) return true;
  if (!incoming) return false;

  const incomingInstant = toEpochNanoseconds(incoming);
  if (incomingInstant === null) return false;
  const acceptedInstant = toEpochNanoseconds(accepted);
  if (acceptedInstant === null) return true;
  return incomingInstant > acceptedInstant;
}
