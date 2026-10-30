export interface OrderLineLike {
  name: string;
  quantity: number;
  subAccountId?: number;
  kdsStatus?: string;
  selectedModifiers?: unknown[];
}

function modifierSignature(modifiers: unknown[] | undefined): string {
  return JSON.stringify(modifiers || []);
}

export function addOrIncrementUnsentOrderItem<T extends OrderLineLike>(items: T[], candidate: T): T[] {
  const existingIndex = items.findIndex(item =>
    item.name === candidate.name &&
    item.subAccountId === candidate.subAccountId &&
    !item.kdsStatus &&
    modifierSignature(item.selectedModifiers) === modifierSignature(candidate.selectedModifiers)
  );

  if (existingIndex < 0) return [...items, candidate];
  return items.map((item, index) => index === existingIndex
    ? { ...item, quantity: item.quantity + candidate.quantity }
    : item);
}

export function shouldCloseOrderAfterPayment<T extends Pick<OrderLineLike, 'subAccountId'>>(
  allItems: T[],
  paidSubAccountId: number | 'ALL'
): boolean {
  return paidSubAccountId === 'ALL' || allItems.every(item => item.subAccountId === paidSubAccountId);
}
