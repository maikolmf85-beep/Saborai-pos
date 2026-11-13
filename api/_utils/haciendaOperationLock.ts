import { randomUUID } from 'node:crypto';

const HACIENDA_OPERATION_LOCK_PREFIX = '__HACIENDA_OPERATION_LOCK__:';
export const HACIENDA_OPERATION_LOCK_MAX_AGE_MS = 15 * 60 * 1000;

export function createHaciendaOperationLockToken(now = Date.now()): string {
  return `${HACIENDA_OPERATION_LOCK_PREFIX}${now.toString(36)}:${randomUUID()}`;
}

export function isHaciendaOperationLock(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(HACIENDA_OPERATION_LOCK_PREFIX);
}

export function isHaciendaOperationLockStale(value: unknown, now = Date.now()): boolean {
  if (!isHaciendaOperationLock(value)) return false;
  const match = value.match(/^__HACIENDA_OPERATION_LOCK__:([0-9a-z]+):[0-9a-f-]{36}$/i);
  if (!match) return false;
  const createdAt = Number.parseInt(match[1], 36);
  if (!Number.isFinite(createdAt) || createdAt > now) return false;
  return now - createdAt >= HACIENDA_OPERATION_LOCK_MAX_AGE_MS;
}

export function publicHaciendaErrorMessage(value: unknown): string | undefined {
  if (isHaciendaOperationLock(value)) {
    return 'Hay una operación de Hacienda en curso; el estado se actualizará al completarse.';
  }
  return typeof value === 'string' && value ? value : undefined;
}
