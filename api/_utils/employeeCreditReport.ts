export type EmployeeCreditReportTransactionType = 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID';

export interface EmployeeCreditReportTransaction {
  id: string;
  accountId: string;
  employeeId: string;
  employeeName: string;
  type: EmployeeCreditReportTransactionType;
  amount: number;
  balanceAfter: number;
  orderId?: string;
  orderNumber?: string;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
  createdBy?: string;
  createdAt: string;
}

export interface EmployeeCreditReportEmployeeSummary {
  employeeId: string;
  employeeName: string;
  chargeTotal: number;
  paymentTotal: number;
  netTotal: number;
  transactionCount: number;
}

export interface EmployeeCreditPeriodReport {
  from: string;
  to: string;
  chargeTotal: number;
  paymentTotal: number;
  netTotal: number;
  transactionCount: number;
  employeeSummaries: EmployeeCreditReportEmployeeSummary[];
  transactions: EmployeeCreditReportTransaction[];
  hasMoreTransactions: boolean;
}

export const EMPLOYEE_CREDIT_REPORT_TRANSACTION_LIMIT = 500;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeTransactionType(value: unknown): EmployeeCreditReportTransactionType | null {
  return value === 'CHARGE' || value === 'PAYMENT' || value === 'ADJUSTMENT' || value === 'VOID'
    ? value
    : null;
}

export class EmployeeCreditPeriodReportAccumulator {
  private readonly from: string;
  private readonly to: string;
  private readonly employeeNames: ReadonlyMap<string, string>;
  private chargeTotal = 0;
  private paymentTotal = 0;
  private transactionCount = 0;
  private readonly employeeSummaries = new Map<string, EmployeeCreditReportEmployeeSummary>();
  private readonly transactions: EmployeeCreditReportTransaction[] = [];

  constructor(from: string, to: string, employeeNames: ReadonlyMap<string, string>) {
    this.from = from;
    this.to = to;
    this.employeeNames = employeeNames;
  }

  add(rows: any[]): void {
    for (const row of rows) {
      if (!row || typeof row.employee_id !== 'string' || !row.employee_id) continue;
      const type = safeTransactionType(row.transaction_type);
      const amount = Number(row.amount);
      if (!type || !Number.isFinite(amount) || amount <= 0) continue;

      const employeeId = row.employee_id;
      const employeeName = this.employeeNames.get(employeeId) || 'Colaborador';
      const summary = this.employeeSummaries.get(employeeId) || {
        employeeId,
        employeeName,
        chargeTotal: 0,
        paymentTotal: 0,
        netTotal: 0,
        transactionCount: 0
      };
      summary.transactionCount += 1;
      this.transactionCount += 1;

      if (type === 'CHARGE') {
        summary.chargeTotal = roundMoney(summary.chargeTotal + amount);
        this.chargeTotal = roundMoney(this.chargeTotal + amount);
      } else if (type === 'PAYMENT') {
        summary.paymentTotal = roundMoney(summary.paymentTotal + amount);
        this.paymentTotal = roundMoney(this.paymentTotal + amount);
      }
      summary.netTotal = roundMoney(summary.chargeTotal - summary.paymentTotal);
      this.employeeSummaries.set(employeeId, summary);

      if (this.transactions.length >= EMPLOYEE_CREDIT_REPORT_TRANSACTION_LIMIT) continue;
      const reference = typeof row.reference === 'string' ? row.reference : undefined;
      this.transactions.push({
        id: typeof row.id === 'string' ? row.id : '',
        accountId: typeof row.account_id === 'string' ? row.account_id : '',
        employeeId,
        employeeName,
        type,
        amount: roundMoney(amount),
        balanceAfter: Number.isFinite(Number(row.balance_after)) ? Number(row.balance_after) : 0,
        orderId: typeof row.order_id === 'string' ? row.order_id : undefined,
        orderNumber: type === 'CHARGE' ? reference : undefined,
        reference,
        notes: typeof row.notes === 'string' ? row.notes : undefined,
        idempotencyKey: typeof row.idempotency_key === 'string' ? row.idempotency_key : '',
        createdBy: typeof row.created_by === 'string' ? row.created_by : undefined,
        createdAt: typeof row.created_at === 'string' ? row.created_at : ''
      });
    }
  }

  toReport(): EmployeeCreditPeriodReport {
    const employeeSummaries = [...this.employeeSummaries.values()]
      .map(summary => ({
        ...summary,
        chargeTotal: roundMoney(summary.chargeTotal),
        paymentTotal: roundMoney(summary.paymentTotal),
        netTotal: roundMoney(summary.netTotal)
      }))
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'es'));

    return {
      from: this.from,
      to: this.to,
      chargeTotal: roundMoney(this.chargeTotal),
      paymentTotal: roundMoney(this.paymentTotal),
      netTotal: roundMoney(this.chargeTotal - this.paymentTotal),
      transactionCount: this.transactionCount,
      employeeSummaries,
      transactions: [...this.transactions],
      hasMoreTransactions: this.transactionCount > this.transactions.length
    };
  }
}
