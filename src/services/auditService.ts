import { UserProfile } from '../types';
import { getTenantItem, setTenantItem } from './tenantStorage';

export type AuditAction =
  | 'SHIFT_OPENED'
  | 'SHIFT_CLOSED'
  | 'CASH_MOVEMENT'
  | 'SALE_RECORDED'
  | 'INVOICE_VOID_REQUESTED'
  | 'REGISTER_CREATED'
  | 'REGISTER_UPDATED'
  | 'REGISTER_DELETED'
  | 'DISCOUNT_APPLIED'
  | 'REFUND_REQUESTED'
  | 'LOGIN';

export interface AuditEvent {
  id: string;
  tenantId: string;
  timestamp: string;
  action: AuditAction;
  actor: {
    userId: string;
    userName: string;
    role?: string;
  };
  registerId?: string;
  shiftId?: string;
  amount?: number;
  reason?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

const MAX_EVENTS = 5000;

class AuditService {
  record(params: {
    tenantId: string;
    action: AuditAction;
    actor?: UserProfile | { id?: string; name?: string; role?: string };
    registerId?: string;
    shiftId?: string;
    amount?: number;
    reason?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    const event: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      timestamp: new Date().toISOString(),
      action: params.action,
      actor: {
        userId: params.actor?.id || 'system',
        userName: params.actor?.name || 'Sistema',
        role: params.actor?.role
      },
      registerId: params.registerId,
      shiftId: params.shiftId,
      amount: params.amount,
      reason: params.reason?.trim() || undefined,
      reference: params.reference,
      metadata: params.metadata
    };

    const existing = this.get(params.tenantId);
    setTenantItem('audit_events', [event, ...existing].slice(0, MAX_EVENTS), params.tenantId);
    return event;
  }

  get(tenantId: string, filters?: { action?: AuditAction; limit?: number }): AuditEvent[] {
    const events = getTenantItem<AuditEvent[]>('audit_events', tenantId) || [];
    const filtered = filters?.action ? events.filter(event => event.action === filters.action) : events;
    return filtered.slice(0, filters?.limit || MAX_EVENTS);
  }

  clear(tenantId: string): void {
    setTenantItem('audit_events', [], tenantId);
  }
}

export const auditService = new AuditService();
