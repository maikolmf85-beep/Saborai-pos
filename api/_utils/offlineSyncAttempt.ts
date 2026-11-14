import { randomUUID } from 'node:crypto';

export const OFFLINE_ORDER_CREATE_ERROR_CODE = 'ORDER_CREATE_FAILED';
export const OFFLINE_ORDER_CREATE_ERROR_MESSAGE = 'No se pudo guardar la orden en la nube.';

export class OfflineOrderCreateError extends Error {
  readonly code = OFFLINE_ORDER_CREATE_ERROR_CODE;
  readonly attemptRef = randomUUID();

  constructor() {
    super(OFFLINE_ORDER_CREATE_ERROR_MESSAGE);
    this.name = 'OfflineOrderCreateError';
  }
}

export function toSafeOfflineOrderCreateFailure(error: unknown) {
  if (!(error instanceof OfflineOrderCreateError)) return null;

  return {
    error: OFFLINE_ORDER_CREATE_ERROR_MESSAGE,
    code: OFFLINE_ORDER_CREATE_ERROR_CODE,
    attemptRef: error.attemptRef
  };
}
