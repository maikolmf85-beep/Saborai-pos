export interface CashRegisterArchiveOperations {
  findByLegacyId(tenantId: string, legacyId: string): Promise<{ id: string } | null>;
  findById(tenantId: string, id: string): Promise<{ id: string } | null>;
  deactivate(tenantId: string, cloudId: string): Promise<void>;
}

export async function archiveCashRegisterInCloud(
  tenantId: string,
  localRegisterId: string,
  operations: CashRegisterArchiveOperations
): Promise<void> {
  const register = await operations.findByLegacyId(tenantId, localRegisterId)
    || await operations.findById(tenantId, localRegisterId);
  if (register) await operations.deactivate(tenantId, register.id);
}

export async function deleteCashRegisterFromState<T extends { id: string }>(
  registers: T[],
  activeShiftsMap: Record<string, unknown>,
  currentTerminalId: string,
  registerId: string,
  archiveRemote: () => Promise<void>
): Promise<{ registers: T[]; currentTerminalId: string }> {
  if (activeShiftsMap[registerId]) {
    throw new Error('No se puede eliminar una caja con un turno abierto. Primero debe cerrarse el turno.');
  }

  await archiveRemote();
  const nextRegisters = registers.filter(register => register.id !== registerId);
  return {
    registers: nextRegisters,
    currentTerminalId: currentTerminalId === registerId
      ? nextRegisters[0]?.id || ''
      : currentTerminalId
  };
}

export function getVisibleCashRegisters<T extends { is_active: boolean }>(registers: T[]): T[] {
  return registers.filter(register => register.is_active);
}
