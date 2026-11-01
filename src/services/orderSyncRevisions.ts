export type RevisionAwareAction =
  | 'UPDATE_TABLE'
  | 'TRANSFER_TABLE_ITEM'
  | 'PAYMENT'
  | 'DEDUCT_INVENTORY'
  | 'EMIT_INVOICE';

export type OrderRevisionMap = Map<string, number>;

export function readNonNegativeRevision(value: unknown): number | null {
  const revision = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function orderNumber(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function relatedOrderNumbers(action: string, payload: any): string[] {
  const candidates = action === 'UPDATE_TABLE'
    ? [payload?.activeOrder?.orderNumber]
    : action === 'TRANSFER_TABLE_ITEM'
      ? [payload?.sourceOrderNumber, payload?.destinationOrderNumber]
      : ['PAYMENT', 'DEDUCT_INVENTORY', 'EMIT_INVOICE'].includes(action)
        ? [payload?.orderNumber]
        : [];
  return [...new Set(candidates.map(orderNumber).filter((value): value is string => Boolean(value)))];
}

/**
 * Rebase only queue entries that are known not to have reached the server.
 * An ambiguous prior request must retain its original idempotency payload.
 */
export function withLatestQueuedRevisions<T extends Record<string, any>>(
  action: string,
  payload: T,
  revisions: OrderRevisionMap,
  mayHaveBeenSent: boolean
): T {
  if (mayHaveBeenSent) return payload;

  if (action === 'UPDATE_TABLE' && payload.activeOrder) {
    const order = orderNumber(payload.activeOrder.orderNumber);
    const revision = order ? revisions.get(order) : undefined;
    if (revision === undefined) return payload;
    return { ...payload, activeOrder: { ...payload.activeOrder, cloudRevision: revision } };
  }

  if (action === 'TRANSFER_TABLE_ITEM') {
    const source = orderNumber(payload.sourceOrderNumber);
    const destination = orderNumber(payload.destinationOrderNumber);
    const sourceRevision = source ? revisions.get(source) : undefined;
    const destinationRevision = destination ? revisions.get(destination) : undefined;
    if (sourceRevision === undefined && destinationRevision === undefined) return payload;
    return {
      ...payload,
      ...(sourceRevision !== undefined ? { expectedSourceRevision: sourceRevision } : {}),
      ...(destinationRevision !== undefined ? { expectedDestinationRevision: destinationRevision } : {})
    };
  }

  return payload;
}

export function recordCommittedOrderRevisions(
  action: string,
  payload: any,
  result: any,
  revisions: OrderRevisionMap
): Array<{ orderNumber: string; cloudRevision: number }> {
  const updates: Array<{ orderNumber: string; cloudRevision: number }> = [];
  const add = (candidate: unknown, revisionValue: unknown) => {
    const order = orderNumber(candidate);
    const revision = readNonNegativeRevision(revisionValue);
    if (!order || revision === null) return;
    revisions.set(order, revision);
    updates.push({ orderNumber: order, cloudRevision: revision });
  };

  if (action === 'UPDATE_TABLE') {
    add(payload?.activeOrder?.orderNumber, result?.cloudRevision);
  } else if (action === 'TRANSFER_TABLE_ITEM') {
    add(payload?.sourceOrderNumber, result?.sourceRevision);
    add(payload?.destinationOrderNumber, result?.destinationRevision);
  } else if (action === 'PAYMENT' && payload?.closeOrder === true) {
    add(payload?.orderNumber, result?.cloudRevision);
  }

  return updates;
}
