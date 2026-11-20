import type { CashShiftV2BranchMode } from '../types/cashShift';

export class CashShiftLocalOpenGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CashShiftLocalOpenGuardError';
    this.code = code;
  }
}

/** Only an authoritative mode scoped to the selected cloud branch may permit a legacy local opening. */
export function assertLegacyShiftOpeningAllowed(mode: CashShiftV2BranchMode | null): void {
  if (mode === 'OFF' || mode === 'PREPARED') return;
  if (mode === 'ACTIVE') {
    throw new CashShiftLocalOpenGuardError(
      'CASH_SHIFT_V2_LEGACY_OPEN_BLOCKED',
      'Esta sucursal usa caja V2. No se permite abrir un turno local legacy.'
    );
  }
  if (mode === 'QUIESCING' || mode === 'FROZEN') {
    throw new CashShiftLocalOpenGuardError(
      'CASH_SHIFT_V2_BRANCH_TRANSITION',
      'La caja de esta sucursal está en transición o congelada; la apertura quedó bloqueada.'
    );
  }
  throw new CashShiftLocalOpenGuardError(
    'CASH_SHIFT_V2_MODE_UNAVAILABLE',
    'No se pudo verificar el modo de caja de esta sucursal; la apertura quedó bloqueada.'
  );
}
