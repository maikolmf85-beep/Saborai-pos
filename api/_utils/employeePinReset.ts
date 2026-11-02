export interface OwnEmployeePinResetContext {
  userId?: string;
  tenantId?: string;
  role?: string;
  employeeId?: string;
}

export interface OwnEmployeePinResetInput {
  currentPassword: string;
  newPin: string;
}

/** Only a root account session may reset the owner's employee PIN. */
export function isOwnerAdminSession(context: OwnEmployeePinResetContext): boolean {
  return Boolean(
    context.userId
    && context.tenantId
    && context.role === 'ADMIN'
    && context.employeeId === undefined
  );
}

/** Accept exactly the current password and a four-digit replacement PIN. */
export function parseOwnEmployeePinResetInput(body: unknown): OwnEmployeePinResetInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || keys.some(key => key !== 'currentPassword' && key !== 'newPin')) return null;

  if (typeof input.currentPassword !== 'string'
    || input.currentPassword.length === 0
    || input.currentPassword.length > 1024
    || typeof input.newPin !== 'string'
    || !/^\d{4}$/.test(input.newPin)) {
    return null;
  }

  return {
    currentPassword: input.currentPassword,
    newPin: input.newPin
  };
}

export async function consumeOwnerEmployeePinResetAttempt(database: any, ownerUserId: string): Promise<boolean> {
  const { data, error } = await database.rpc('consume_owner_employee_pin_reset_attempt', {
    p_user_id: ownerUserId
  });
  if (error) throw error;
  return data === true;
}
