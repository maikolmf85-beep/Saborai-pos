import { getTenantItem, setTenantItem } from './tenantStorage.ts';
import type { UserProfile } from '../types';

export type EmployeeCreditTransactionType = 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID';

export interface EmployeeCreditEmployee {
  id: string;
  name: string;
  active: boolean;
}

export interface EmployeeCreditAccount {
  employeeId: string;
  employeeName: string;
  status: string;
  balance: number;
  updatedAt?: string;
}

export interface EmployeeCreditTransaction {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  type: EmployeeCreditTransactionType;
  amount: number;
  balanceAfter: number;
  orderNumber?: string;
  orderId?: string;
  invoiceClave?: string;
  reference?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  idempotencyKey?: string;
  pending?: boolean;
  alreadyApplied?: boolean;
}

export interface EmployeeCreditLedger {
  employees: EmployeeCreditEmployee[];
  accounts: EmployeeCreditAccount[];
  transactions: EmployeeCreditTransaction[];
  hasMoreTransactions?: boolean;
}

const LEDGER_STORAGE_KEY = 'employee_credit_ledger';
const LEGACY_TRANSACTIONS_KEY = 'employee_credit_transactions';

function emptyLedger(): EmployeeCreditLedger {
  return { employees: [], accounts: [], transactions: [], hasMoreTransactions: false };
}

function finiteAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

function mapTransaction(raw: any, tenantId: string, fallbackPending = false): EmployeeCreditTransaction | null {
  if (!raw || typeof raw !== 'object' || typeof raw.employeeId !== 'string') return null;
  const amount = finiteAmount(raw.amount);
  const type: EmployeeCreditTransactionType = ['CHARGE', 'PAYMENT', 'ADJUSTMENT', 'VOID'].includes(raw.type) ? raw.type : 'CHARGE';
  if (!amount || !raw.employeeId.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `credit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    employeeId: raw.employeeId.trim(),
    employeeName: typeof raw.employeeName === 'string' && raw.employeeName.trim() ? raw.employeeName.trim() : 'Colaborador',
    type,
    amount,
    balanceAfter: Number.isFinite(Number(raw.balanceAfter)) ? Number(raw.balanceAfter) : 0,
    orderNumber: typeof raw.orderNumber === 'string' ? raw.orderNumber : undefined,
    orderId: typeof raw.orderId === 'string' ? raw.orderId : undefined,
    invoiceClave: typeof raw.invoiceClave === 'string' ? raw.invoiceClave : undefined,
    reference: typeof raw.reference === 'string' ? raw.reference : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    idempotencyKey: typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : undefined,
    pending: raw.pending === true || (raw.pending === undefined && fallbackPending),
    alreadyApplied: raw.alreadyApplied === true
  };
}

function mergeEmployee(list: EmployeeCreditEmployee[], candidate: EmployeeCreditEmployee): EmployeeCreditEmployee[] {
  const index = list.findIndex(employee => employee.id === candidate.id);
  if (index < 0) return [...list, candidate];
  const next = [...list];
  next[index] = { ...next[index], ...candidate };
  return next;
}

function deltaFor(transaction: EmployeeCreditTransaction): number {
  return transaction.type === 'CHARGE' ? transaction.amount : -transaction.amount;
}

function currentToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
}

async function responseData(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el registro de crédito.');
  return data;
}

export function getSelectableEmployees(staffList: Array<Pick<UserProfile, 'id' | 'name'> & { active?: boolean }>, ownerId?: string | null): EmployeeCreditEmployee[] {
  const unique = new Map<string, EmployeeCreditEmployee>();
  staffList.forEach(member => {
    const id = typeof member?.id === 'string' ? member.id.trim() : '';
    const name = typeof member?.name === 'string' ? member.name.trim() : '';
    if (!id || !name || member.active === false || (ownerId && id === ownerId)) return;
    if (!unique.has(id)) unique.set(id, { id, name, active: true });
  });
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

class EmployeeCreditService {
  getLedger(tenantId: string): EmployeeCreditLedger {
    const stored = getTenantItem<any>(LEDGER_STORAGE_KEY, tenantId);
    const ledger: EmployeeCreditLedger = stored && typeof stored === 'object' ? {
      employees: Array.isArray(stored.employees) ? stored.employees.filter((row: any) => row && typeof row.id === 'string' && typeof row.name === 'string').map((row: any) => ({ id: row.id, name: row.name, active: row.active !== false })) : [],
      accounts: Array.isArray(stored.accounts) ? stored.accounts.filter((row: any) => row && typeof row.employeeId === 'string').map((row: any) => ({
        employeeId: row.employeeId,
        employeeName: typeof row.employeeName === 'string' ? row.employeeName : 'Colaborador',
        status: typeof row.status === 'string' ? row.status : 'ACTIVE',
        balance: Math.max(0, Number.isFinite(Number(row.balance)) ? Number(row.balance) : 0),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined
      })) : [],
      transactions: Array.isArray(stored.transactions) ? stored.transactions.map((row: any) => mapTransaction(row, tenantId)).filter(Boolean) as EmployeeCreditTransaction[] : [],
      hasMoreTransactions: stored.hasMoreTransactions === true
    } : emptyLedger();

    const legacy = getTenantItem<any[]>(LEGACY_TRANSACTIONS_KEY, tenantId);
    if (Array.isArray(legacy)) {
      for (const raw of legacy) {
        const transaction = mapTransaction(raw, tenantId, true);
        if (!transaction || ledger.transactions.some(item => item.id === transaction.id)) continue;
        ledger.transactions.push(transaction);
      }
    }
    return ledger;
  }

  getBalance(tenantId: string, employeeId: string): number {
    const ledger = this.getLedger(tenantId);
    const account = ledger.accounts.find(item => item.employeeId === employeeId);
    if (account) return Math.max(0, account.balance);
    return ledger.transactions
      .filter(item => item.employeeId === employeeId)
      .reduce((balance, item) => balance + deltaFor(item), 0);
  }

  private saveLedger(tenantId: string, ledger: EmployeeCreditLedger): void {
    setTenantItem(LEDGER_STORAGE_KEY, ledger, tenantId);
  }

  recordCharge(params: {
    tenantId: string;
    employeeId: string;
    employeeName: string;
    amount: number;
    orderNumber?: string;
    invoiceClave?: string;
    createdBy?: string;
    idempotencyKey: string;
  }): EmployeeCreditTransaction {
    const amount = finiteAmount(params.amount);
    if (!params.tenantId || !params.employeeId || !params.idempotencyKey || !amount) {
      throw new Error('No se pudo preparar el cargo de la comanda ejecutiva.');
    }
    const ledger = this.getLedger(params.tenantId);
    const previous = ledger.transactions.find(item => item.idempotencyKey === params.idempotencyKey
      || (params.orderNumber && item.type === 'CHARGE' && item.employeeId === params.employeeId && item.orderNumber === params.orderNumber));
    if (previous) return previous;

    const account = ledger.accounts.find(item => item.employeeId === params.employeeId);
    const priorBalance = account?.balance ?? ledger.transactions
      .filter(item => item.employeeId === params.employeeId)
      .reduce((balance, item) => balance + deltaFor(item), 0);
    const transaction: EmployeeCreditTransaction = {
      id: params.idempotencyKey,
      tenantId: params.tenantId,
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      type: 'CHARGE',
      amount,
      balanceAfter: Math.max(0, priorBalance + amount),
      orderNumber: params.orderNumber,
      invoiceClave: params.invoiceClave,
      reference: params.orderNumber,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      pending: true
    };
    const nextAccounts = account
      ? ledger.accounts.map(item => item.employeeId === params.employeeId ? { ...item, employeeName: params.employeeName, balance: item.balance + amount, updatedAt: transaction.createdAt } : item)
      : [...ledger.accounts, { employeeId: params.employeeId, employeeName: params.employeeName, status: 'ACTIVE', balance: transaction.balanceAfter, updatedAt: transaction.createdAt }];
    const nextEmployees = mergeEmployee(ledger.employees, { id: params.employeeId, name: params.employeeName, active: true });
    this.saveLedger(params.tenantId, { ...ledger, employees: nextEmployees, accounts: nextAccounts, transactions: [transaction, ...ledger.transactions] });
    return transaction;
  }

  async refreshLedger(tenantId: string): Promise<EmployeeCreditLedger> {
    const token = currentToken();
    if (!token) throw new Error('No hay una sesión autenticada para consultar el registro de consumo.');
    const response = await fetch(`/api/employee-credit?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await responseData(response);
    if (data.tenantId !== tenantId || !Array.isArray(data.employees) || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
      throw new Error('El servidor devolvió un registro incompleto o de otro tenant.');
    }

    const serverEmployees: EmployeeCreditEmployee[] = data.employees
      .filter((row: any) => row && typeof row.id === 'string' && typeof row.name === 'string')
      .map((row: any) => ({ id: row.id, name: row.name, active: row.active !== false }));
    const serverAccounts: EmployeeCreditAccount[] = data.accounts
      .filter((row: any) => row && typeof row.employeeId === 'string')
      .map((row: any) => ({
        employeeId: row.employeeId,
        employeeName: typeof row.employeeName === 'string' ? row.employeeName : 'Colaborador',
        status: typeof row.status === 'string' ? row.status : 'ACTIVE',
        balance: Math.max(0, Number.isFinite(Number(row.balance)) ? Number(row.balance) : 0),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined
      }));
    const serverTransactions = data.transactions
      .map((row: any) => mapTransaction(row, tenantId, false))
      .filter(Boolean) as EmployeeCreditTransaction[];
    const cached = this.getLedger(tenantId);
    const serverIdempotencyKeys = new Set(serverTransactions.map(item => item.idempotencyKey).filter(Boolean));
    const pending = cached.transactions.filter(item => item.pending === true).filter(item => {
      if (item.idempotencyKey && serverIdempotencyKeys.has(item.idempotencyKey)) return false;
      return !serverTransactions.some(serverItem => serverItem.employeeId === item.employeeId
        && serverItem.type === item.type
        && serverItem.amount === item.amount
        && Boolean(item.orderNumber)
        && (serverItem.orderNumber === item.orderNumber || serverItem.reference === item.orderNumber));
    });
    const mergedTransactions = [...pending, ...serverTransactions]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    let mergedAccounts = [...serverAccounts];
    let mergedEmployees = [...serverEmployees];
    for (const transaction of pending) {
      const delta = deltaFor(transaction);
      const existingAccount = mergedAccounts.find(item => item.employeeId === transaction.employeeId);
      if (existingAccount) {
        mergedAccounts = mergedAccounts.map(item => item.employeeId === transaction.employeeId
          ? { ...item, balance: Math.max(0, item.balance + delta), employeeName: transaction.employeeName }
          : item);
      } else {
        mergedAccounts.push({ employeeId: transaction.employeeId, employeeName: transaction.employeeName, status: 'ACTIVE', balance: Math.max(0, delta) });
      }
      mergedEmployees = mergeEmployee(mergedEmployees, { id: transaction.employeeId, name: transaction.employeeName, active: true });
    }
    const result: EmployeeCreditLedger = {
      employees: mergedEmployees,
      accounts: mergedAccounts,
      transactions: mergedTransactions,
      hasMoreTransactions: data.hasMoreTransactions === true
    };
    this.saveLedger(tenantId, result);
    return result;
  }

  async recordPayment(params: {
    tenantId: string;
    employeeId: string;
    amount: number;
    reference?: string;
    idempotencyKey: string;
  }): Promise<EmployeeCreditTransaction> {
    const token = currentToken();
    if (!token) throw new Error('No hay una sesión autenticada para registrar el abono.');
    const amount = finiteAmount(params.amount);
    if (!amount || !params.employeeId || !params.idempotencyKey) throw new Error('El abono no es válido.');
    const response = await fetch('/api/employee-credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tenantId: params.tenantId,
        employeeId: params.employeeId,
        amount,
        reference: params.reference,
        idempotencyKey: params.idempotencyKey
      })
    });
    const data = await responseData(response);
    if (data.tenantId !== params.tenantId || !data.transaction || data.transaction.employeeId !== params.employeeId) {
      throw new Error('El servidor no confirmó el abono del colaborador.');
    }
    const raw = data.transaction;
    const transaction = mapTransaction({ ...raw, pending: false }, params.tenantId);
    if (!transaction) throw new Error('El servidor devolvió un abono incompleto.');
    const ledger = this.getLedger(params.tenantId);
    const pending = ledger.transactions.filter(item => item.pending === true && item.idempotencyKey !== transaction.idempotencyKey);
    const pendingDelta = pending.filter(item => item.employeeId === params.employeeId).reduce((total, item) => total + deltaFor(item), 0);
    const account = ledger.accounts.find(item => item.employeeId === params.employeeId);
    const nextAccount = {
      employeeId: params.employeeId,
      employeeName: transaction.employeeName,
      status: 'ACTIVE',
      balance: Math.max(0, transaction.balanceAfter + pendingDelta),
      updatedAt: transaction.createdAt
    };
    this.saveLedger(params.tenantId, {
      ...ledger,
      employees: mergeEmployee(ledger.employees, { id: params.employeeId, name: transaction.employeeName, active: true }),
      accounts: account
        ? ledger.accounts.map(item => item.employeeId === params.employeeId ? nextAccount : item)
        : [...ledger.accounts, nextAccount],
      transactions: [transaction, ...ledger.transactions.filter(item => item.id !== transaction.id && item.idempotencyKey !== transaction.idempotencyKey)]
    });
    try {
      const reconciled = await this.refreshLedger(params.tenantId);
      const confirmed = reconciled.transactions.find(item => item.id === transaction.id || item.idempotencyKey === transaction.idempotencyKey);
      return confirmed ? { ...confirmed, alreadyApplied: transaction.alreadyApplied } : transaction;
    } catch {
      // El abono ya quedó confirmado en el servidor; se conserva la respuesta
      // local y se reconciliará cuando vuelva a estar disponible la consulta.
    }
    return transaction;
  }
}

export const employeeCreditService = new EmployeeCreditService();
