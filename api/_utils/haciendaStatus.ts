export type NormalizedHaciendaStatus = 'ACCEPTED' | 'REJECTED' | 'PROCESSING';

export interface HaciendaStatusQueryResult {
  querySucceeded: boolean;
  status: NormalizedHaciendaStatus;
  indicator?: string;
}

/** A failed upstream status request can never confirm acceptance or rejection. */
export function classifyHaciendaStatusQuery(
  responseSucceeded: boolean,
  rawIndicator: unknown
): HaciendaStatusQueryResult {
  const indicator = typeof rawIndicator === 'string' ? rawIndicator.trim().toLowerCase() : '';
  if (!responseSucceeded) {
    return { querySucceeded: false, status: 'PROCESSING' };
  }
  if (indicator === 'aceptado') return { querySucceeded: true, status: 'ACCEPTED', indicator };
  if (indicator === 'rechazado') return { querySucceeded: true, status: 'REJECTED', indicator };
  return { querySucceeded: true, status: 'PROCESSING', indicator: indicator || undefined };
}

export function isConfirmedHaciendaRejection(result: HaciendaStatusQueryResult): boolean {
  return result.querySucceeded && result.status === 'REJECTED' && result.indicator === 'rechazado';
}
