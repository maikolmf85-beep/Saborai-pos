import { getTenantItem, setTenantItem } from './tenantStorage';

export interface EmployeeCreditTransaction {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  type: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID';
  amount: number;
  balanceAfter: number;
  orderNumber?: string;
  invoiceClave?: string;
  reference?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

const STORAGE_KEY = 'employee_credit_transactions';

class EmployeeCreditService {
  list(tenantId: string): EmployeeCreditTransaction[] {
    return getTenantItem<EmployeeCreditTransaction[]>(STORAGE_KEY, tenantId) || [];
  }

  getBalance(tenantId: string, employeeId: string): number {
    return this.list(tenantId)
      .filter(item => item.employeeId === employeeId)
      .reduce((balance, item) => item.type === 'CHARGE' ? balance + item.amount : balance - item.amount, 0);
  }

  recordCharge(params: {
    tenantId: string;
    employeeId: string;
    employeeName: string;
    amount: number;
    orderNumber?: string;
    invoiceClave?: string;
    createdBy?: string;
  }): EmployeeCreditTransaction {
    const balanceAfter = this.getBalance(params.tenantId, params.employeeId) + params.amount;
    const transaction: EmployeeCreditTransaction = {
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      type: 'CHARGE',
      amount: params.amount,
      balanceAfter,
      orderNumber: params.orderNumber,
      invoiceClave: params.invoiceClave,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString()
    };
    setTenantItem(STORAGE_KEY, [transaction, ...this.list(params.tenantId)], params.tenantId);
    return transaction;
  }

  recordPayment(params: {
    tenantId: string;
    employeeId: string;
    employeeName: string;
    amount: number;
    reference?: string;
    createdBy?: string;
  }): EmployeeCreditTransaction {
    const balanceBefore = this.getBalance(params.tenantId, params.employeeId);
    if (params.amount <= 0 || params.amount > balanceBefore) throw new Error('El abono supera el saldo pendiente.');
    const transaction: EmployeeCreditTransaction = {
      id: `execpay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      type: 'PAYMENT',
      amount: params.amount,
      balanceAfter: balanceBefore - params.amount,
      reference: params.reference,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString()
    };
    setTenantItem(STORAGE_KEY, [transaction, ...this.list(params.tenantId)], params.tenantId);
    return transaction;
  }
}

export const employeeCreditService = new EmployeeCreditService();
