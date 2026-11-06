export interface CashClosureTable {
  status?: string;
}

export interface CashClosurePayment {
  paidAt?: string | null;
  status?: string | null;
  method?: string | null;
  amount?: number | null;
}

/** Las reservas no son comandas abiertas; una mesa ocupada o en pre-cuenta sí. */
export function isOpenDiningTable(table: CashClosureTable): boolean {
  return table.status === 'OCCUPIED' || table.status === 'PRE_CHECK';
}

export function shouldCloseOrderAfterPayment(
  items: Array<{ subAccountId?: number }>,
  paidSubAccountId: number | 'ALL'
): boolean {
  if (paidSubAccountId === 'ALL') return true;
  return !items.some(item => item.subAccountId !== paidSubAccountId);
}

/** Intervalo semiabierto [apertura, cierre): un cobro en el cierre va al siguiente turno. */
export function isPaymentInsideShift(
  payment: CashClosurePayment,
  openedAt: string,
  closedAt: string
): boolean {
  if (!payment.paidAt || !['PENDING', 'AUTHORIZED'].includes(payment.status || '')) return false;
  const paidAt = Date.parse(payment.paidAt);
  const opened = Date.parse(openedAt);
  const closed = Date.parse(closedAt);
  return Number.isFinite(paidAt) && Number.isFinite(opened) && Number.isFinite(closed)
    && paidAt >= opened && paidAt < closed;
}

export function getCostaRicaBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function summarizeShiftPayments(
  payments: CashClosurePayment[],
  openedAt: string,
  closedAt: string
) {
  const included = payments.filter(payment => isPaymentInsideShift(payment, openedAt, closedAt)
    && ['CASH', 'CARD', 'SINPE', 'CREDIT', 'MIXED'].includes(payment.method || ''));
  const totals = {
    cashSales: 0,
    cardSales: 0,
    sinpeSales: 0,
    creditSales: 0,
    mixedSales: 0,
    totalSales: 0,
    paymentsCount: included.length
  };
  for (const payment of included) {
    const amount = typeof payment.amount === 'number' && Number.isFinite(payment.amount) ? payment.amount : 0;
    if (payment.method === 'CASH') totals.cashSales += amount;
    else if (payment.method === 'CARD') totals.cardSales += amount;
    else if (payment.method === 'SINPE') totals.sinpeSales += amount;
    else if (payment.method === 'CREDIT') totals.creditSales += amount;
    else if (payment.method === 'MIXED') totals.mixedSales += amount;
  }
  totals.totalSales = totals.cashSales + totals.cardSales + totals.sinpeSales + totals.creditSales + totals.mixedSales;
  return totals;
}
