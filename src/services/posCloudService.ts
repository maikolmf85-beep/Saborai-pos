import type { ElectronicInvoiceCR, Table } from '../types';

export type PosCloudAction = 'UPDATE_TABLE' | 'PAYMENT' | 'DEDUCT_INVENTORY' | 'EMIT_INVOICE';

export interface SaleCloudPayload {
  table: Table;
  invoice: ElectronicInvoiceCR;
  paymentMethod: '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil';
  total: number;
  closeOrder: boolean;
  items: Array<{ name: string; quantity: number; menuItemId?: string }>;
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
    if (!response.ok) throw new Error(data.error || `No se pudo sincronizar ${action}.`);
    return data.result as T;
  }

  async syncSale(tenantId: string, sale: SaleCloudPayload): Promise<void> {
    const orderNumber = sale.table.activeOrder?.orderNumber;
    if (!orderNumber) throw new Error('La venta no tiene número de orden.');

    const operationPrefix = `sale:${tenantId}:${sale.invoice.clave50Digitos || orderNumber}`;
    await this.syncOperation('UPDATE_TABLE', sale.table as unknown as Record<string, unknown>, tenantId, `${operationPrefix}:order`);
    await this.syncOperation('PAYMENT', {
      orderNumber,
      payments: [{
        amount: sale.total,
        method: sale.paymentMethod === '01-Efectivo'
          ? 'CASH'
          : sale.paymentMethod === '02-Tarjeta' ? 'CARD' : 'SINPE',
        provider: 'POS_ONLINE'
      }],
      closeOrder: sale.closeOrder
    }, tenantId, `${operationPrefix}:payment`);
    await this.syncOperation('DEDUCT_INVENTORY', {
      orderNumber,
      items: sale.items
    }, tenantId, `${operationPrefix}:inventory`);
    await this.syncOperation('EMIT_INVOICE', {
      orderNumber,
      clave: sale.invoice.clave50Digitos,
      consecutivo: sale.invoice.consecutivo,
      documentType: sale.invoice.tipoDocumento || 'TE',
      total: sale.invoice.totalComprobante,
      invoiceData: sale.invoice,
      xmlContent: sale.invoice.xmlContent
    }, tenantId, `${operationPrefix}:invoice`);
  }
}

export const posCloudService = new PosCloudService();
