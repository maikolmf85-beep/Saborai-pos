import type { ElectronicInvoiceCR, Table } from '../types';
import { sanitizeFiscalInvoiceData } from '../utils/fiscalInvoiceItems.ts';
import { getUndispatchedItems } from './inventoryDispatch.ts';
import { isCloudTenantId } from './tenantStorage.ts';

export type PosCloudAction = 'UPDATE_TABLE' | 'TRANSFER_TABLE_ACCOUNT' | 'PAYMENT' | 'DEDUCT_INVENTORY' | 'DISPATCH_INVENTORY' | 'SAVE_INVENTORY_CONFIG' | 'LOAD_INVENTORY_CONFIG' | 'ADJUST_INVENTORY' | 'EMIT_INVOICE' | 'CLOSE_CASH_SHIFT' | 'CLOSE_DAILY_CASH' | 'GET_DAILY_CASH_STATUS' | 'OPEN_DAILY_CASH' | 'IMPORT_CASH_SHIFT' | 'ASSIGN_CASH_TERMINAL' | 'REASSIGN_CASH_TERMINAL';

export interface SaleCloudPayload {
  table: Table;
  invoice: ElectronicInvoiceCR;
  paymentMethod: '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito';
  total: number;
  closeOrder: boolean;
  cashRegisterId?: string;
  cashShiftId?: string;
  occurredAt?: string;
  items: Array<{ name: string; quantity: number; menuItemId?: string; inventoryDeductedAtDispatch?: boolean }>;
}

export class PosCloudSyncError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PosCloudSyncError';
    this.status = status;
    this.code = code;
  }
}

export function salePaymentOperationId(tenantId: string, sale: SaleCloudPayload): string {
  const orderNumber = sale.table.activeOrder?.orderNumber;
  if (!orderNumber) throw new Error('La venta no tiene número de orden.');
  return `sale:${tenantId}:${sale.invoice.clave50Digitos || orderNumber}:payment`;
}

function createOperationId(action: PosCloudAction): string {
  const randomId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `pos_${action.toLowerCase()}_${Date.now()}_${randomId}`;
}

function getToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
}

function getSessionActor(): { actorUserId: string; actorEmployeeId: string | null } | null {
  if (typeof localStorage === 'undefined') return null;
  const actorUserId = localStorage.getItem('saborai_account_user_id');
  if (!actorUserId) return null;
  return { actorUserId, actorEmployeeId: localStorage.getItem('saborai_employee_id') };
}

function localDemoResult(action: PosCloudAction, payload: Record<string, unknown>): unknown {
  if (action === 'PAYMENT') return { paymentIds: [] };
  if (action === 'OPEN_DAILY_CASH') {
    const openedAt = new Date().toISOString();
    return {
      openingId: `demo_opening_${Date.now()}`,
      cashRegisterId: String(payload.registerId || ''),
      businessDate: openedAt.slice(0, 10),
      timezone: 'America/Costa_Rica',
      openedAt,
      alreadyOpened: false
    };
  }
  if (action === 'CLOSE_DAILY_CASH') {
    return {
      closureId: `demo_closure_${Date.now()}`,
      cashRegisterId: String(payload.registerId || ''),
      closedAt: new Date().toISOString(),
      summary: {}
    };
  }
  if (action === 'IMPORT_CASH_SHIFT') return { alreadyExists: false };
  if (action === 'ASSIGN_CASH_TERMINAL') return { assigned: true, alreadyAssigned: false };
  if (action === 'REASSIGN_CASH_TERMINAL') return { assigned: true, alreadyAssigned: false };
  return {};
}

class PosCloudService {
  async syncOperation<T = unknown>(
    action: PosCloudAction,
    payload: Record<string, unknown>,
    tenantId: string,
    operationId = createOperationId(action)
  ): Promise<T> {
    if (!tenantId) throw new Error('Tenant requerido para sincronizar la operación.');
    if (!isCloudTenantId(tenantId)) return localDemoResult(action, payload) as T;
    const token = getToken();
    if (!token) throw new Error('No hay una sesión autenticada para sincronizar la operación.');
    const actor = getSessionActor();
    if (!actor) throw new Error('No se pudo verificar la identidad que inició la operación.');

    const response = await fetch('/api/offline/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ operationId, tenantId, action, ...actor, payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new PosCloudSyncError(
        data.error || `No se pudo sincronizar ${action}.`,
        response.status,
        typeof data.code === 'string' ? data.code : undefined
      );
    }
    return data.result as T;
  }

  async syncSale(tenantId: string, sale: SaleCloudPayload): Promise<void> {
    const orderNumber = sale.table.activeOrder?.orderNumber;
    if (!orderNumber) throw new Error('La venta no tiene número de orden.');

    const operationPrefix = `sale:${tenantId}:${sale.invoice.clave50Digitos || orderNumber}`;
    const paymentOperationId = salePaymentOperationId(tenantId, sale);
    await this.syncOperation('UPDATE_TABLE', sale.table as unknown as Record<string, unknown>, tenantId, `${operationPrefix}:order`);
    const paymentResult = await this.syncOperation<{ paymentIds?: string[] }>('PAYMENT', {
      orderNumber,
      payments: [{
        amount: sale.total,
        method: sale.paymentMethod === '01-Efectivo'
          ? 'CASH'
          : sale.paymentMethod === '02-Tarjeta' ? 'CARD' : sale.paymentMethod === '04-Credito' ? 'CREDIT' : 'SINPE',
        provider: 'POS_ONLINE'
      }],
      cashRegisterId: sale.cashRegisterId,
      cashShiftId: sale.cashShiftId,
      occurredAt: sale.occurredAt || new Date().toISOString(),
      employeeCredit: sale.paymentMethod === '04-Credito' && sale.table.activeOrder?.executiveEmployeeId
        ? {
            employeeId: sale.table.activeOrder.executiveEmployeeId,
            employeeName: sale.table.activeOrder.executiveEmployeeName || 'Trabajador',
            idempotencyKey: `credit:${paymentOperationId}`
          }
        : undefined,
      closeOrder: sale.closeOrder
    }, tenantId, paymentOperationId);
    const undispatchedItems = getUndispatchedItems(sale.items);
    if (undispatchedItems.length > 0) {
      await this.syncOperation('DEDUCT_INVENTORY', {
        orderNumber,
        items: undispatchedItems
      }, tenantId, `${operationPrefix}:inventory`);
    }
    await this.syncOperation('EMIT_INVOICE', {
      orderNumber,
      paymentId: paymentResult.paymentIds?.length === 1 ? paymentResult.paymentIds[0] : undefined,
      clave: sale.invoice.clave50Digitos,
      consecutivo: sale.invoice.consecutivo,
      documentType: sale.invoice.tipoDocumento || 'TE',
      total: sale.invoice.totalComprobante,
      invoiceData: sanitizeFiscalInvoiceData(sale.invoice),
      xmlContent: sale.invoice.xmlContent
    }, tenantId, `${operationPrefix}:invoice`);
  }
}

export const posCloudService = new PosCloudService();
