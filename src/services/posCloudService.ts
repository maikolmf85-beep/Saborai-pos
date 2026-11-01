import type { ElectronicInvoiceCR, Table } from '../types';

export type PosCloudAction = 'UPDATE_TABLE' | 'TRANSFER_TABLE_ITEM' | 'PAYMENT' | 'DEDUCT_INVENTORY' | 'EMIT_INVOICE';

export interface SaleCloudPayload {
  table: Table;
  invoice: ElectronicInvoiceCR;
  paymentMethod: '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito';
  total: number;
  closeOrder: boolean;
  items: Array<{ name: string; quantity: number; menuItemId?: string }>;
}

export interface OrderSyncResult {
  tableId?: string;
  orderId?: string | null;
  orderNumber?: string;
  cloudRevision?: number;
}

export interface TransferSyncResult {
  sourceRevision: number;
  destinationRevision: number;
  sourceOrderNumber: string;
  destinationOrderNumber: string;
}

export class PosCloudSyncError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PosCloudSyncError';
    this.code = code;
  }
}

export function createOperationId(action: PosCloudAction): string {
  const randomId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `pos_${action.toLowerCase()}_${Date.now()}_${randomId}`;
}

function saleOperationPrefix(tenantId: string, sale: SaleCloudPayload): string {
  const orderNumber = sale.table.activeOrder?.orderNumber;
  if (!orderNumber) throw new Error('La venta no tiene número de orden.');
  return `sale:${tenantId}:${sale.invoice.clave50Digitos || orderNumber}`;
}

export function saleOrderOperationId(tenantId: string, sale: SaleCloudPayload): string {
  return `${saleOperationPrefix(tenantId, sale)}:order`;
}

export function salePaymentOperationId(tenantId: string, sale: SaleCloudPayload): string {
  return `${saleOperationPrefix(tenantId, sale)}:payment`;
}

export function saleInventoryOperationId(tenantId: string, sale: SaleCloudPayload): string {
  return `${saleOperationPrefix(tenantId, sale)}:inventory`;
}

export function saleInvoiceOperationId(tenantId: string, sale: SaleCloudPayload): string {
  return `${saleOperationPrefix(tenantId, sale)}:invoice`;
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

class PosCloudService {
  async syncOperation<T = unknown>(
    action: PosCloudAction,
    payload: Record<string, unknown>,
    tenantId: string,
    operationId = createOperationId(action)
  ): Promise<T> {
    if (!tenantId) throw new Error('Tenant requerido para sincronizar la operación.');
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
      throw new PosCloudSyncError(data.error || `No se pudo sincronizar ${action}.`, data.code);
    }
    return data.result as T;
  }

  async syncSale(tenantId: string, sale: SaleCloudPayload): Promise<OrderSyncResult> {
    const orderNumber = sale.table.activeOrder?.orderNumber;
    if (!orderNumber) throw new Error('La venta no tiene número de orden.');

    const orderResult = await this.syncOperation<OrderSyncResult>(
      'UPDATE_TABLE',
      sale.table as unknown as Record<string, unknown>,
      tenantId,
      saleOrderOperationId(tenantId, sale)
    );
    const paymentResult = await this.syncOperation<OrderSyncResult & { orderId?: string; paymentIds?: string[] }>('PAYMENT', {
      orderNumber,
      payments: [{
        amount: sale.total,
        method: sale.paymentMethod === '01-Efectivo'
          ? 'CASH'
          : sale.paymentMethod === '02-Tarjeta' ? 'CARD' : sale.paymentMethod === '04-Credito' ? 'CREDIT' : 'SINPE',
        provider: 'POS_ONLINE'
      }],
      employeeCredit: sale.paymentMethod === '04-Credito' && sale.table.activeOrder?.executiveEmployeeId
        ? {
            employeeId: sale.table.activeOrder.executiveEmployeeId,
            employeeName: sale.table.activeOrder.executiveEmployeeName || 'Trabajador',
            idempotencyKey: `credit:${salePaymentOperationId(tenantId, sale)}`
          }
        : undefined,
      closeOrder: sale.closeOrder
    }, tenantId, salePaymentOperationId(tenantId, sale));
    await this.syncOperation('DEDUCT_INVENTORY', {
      orderNumber,
      items: sale.items
    }, tenantId, saleInventoryOperationId(tenantId, sale));
    await this.syncOperation('EMIT_INVOICE', {
      orderNumber,
      clave: sale.invoice.clave50Digitos,
      consecutivo: sale.invoice.consecutivo,
      documentType: sale.invoice.tipoDocumento || 'TE',
      total: sale.invoice.totalComprobante,
      invoiceData: sale.invoice,
      xmlContent: sale.invoice.xmlContent
    }, tenantId, saleInvoiceOperationId(tenantId, sale));

    return {
      orderId: paymentResult.orderId || orderResult.orderId,
      orderNumber,
      tableId: orderResult.tableId,
      cloudRevision: paymentResult.cloudRevision ?? orderResult.cloudRevision
    };
  }
}

export const posCloudService = new PosCloudService();
