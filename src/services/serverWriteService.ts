export type ServerWriteAction =
  | 'SAVE_TABLE_LAYOUT'
  | 'SEED_TABLE_LAYOUT'
  | 'UPSERT_TABLE_RESERVATION'
  | 'DELETE_TABLE_RESERVATION'
  | 'CASH_CONTROL_SYNC'
  | 'CASH_CONTROL_IMPORT';

export interface ServerWriteActor {
  actorUserId: string;
  actorEmployeeId: string | null;
}

function currentToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
}

export function currentServerWriteActor(): ServerWriteActor | null {
  if (typeof localStorage === 'undefined') return null;
  const actorUserId = localStorage.getItem('saborai_account_user_id');
  if (!actorUserId) return null;
  return {
    actorUserId,
    actorEmployeeId: localStorage.getItem('saborai_employee_id')
  };
}

function createOperationId(action: ServerWriteAction): string {
  const randomId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `server_${action.toLowerCase()}_${Date.now()}_${randomId}`;
}

async function responseData(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `No se pudo completar ${data.action || 'la operación'}.`);
  return data;
}

export async function writePosOperation<T = unknown>(
  action: ServerWriteAction,
  tenantId: string,
  payload: Record<string, unknown>,
  options: { operationId?: string; actor?: ServerWriteActor | null } = {}
): Promise<T> {
  if (!tenantId) throw new Error('Tenant requerido para guardar la operación.');
  const token = currentToken();
  if (!token) throw new Error('No hay una sesión autenticada para guardar la operación.');
  const actor = options.actor === undefined ? currentServerWriteActor() : options.actor;
  if (!actor) throw new Error('No se pudo verificar la identidad que inició la operación.');

  const response = await fetch('/api/pos/write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      operationId: options.operationId || createOperationId(action),
      tenantId,
      action,
      actorUserId: actor.actorUserId,
      actorEmployeeId: actor.actorEmployeeId,
      payload
    })
  });
  const data = await responseData(response);
  return data.result as T;
}
