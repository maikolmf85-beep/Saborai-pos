export type TenantBoundSequenceStatus = 'COMPLETED' | 'CANCELLED';

/**
 * Runs an approved tool sequence only while the tenant that approved it remains active.
 * Side-effecting tools must perform their mutation synchronously after the dispatcher guard,
 * or add their own tenant check immediately before any post-await mutation.
 */
export async function runTenantBoundToolSequence<TTool, TResult>(
  tenantId: string,
  tools: readonly TTool[],
  getCurrentTenantId: () => string,
  execute: (tool: TTool, tenantId: string, isTenantActive: () => boolean) => Promise<TResult>,
  onResult: (tool: TTool, result: TResult) => void
): Promise<TenantBoundSequenceStatus> {
  const isTenantActive = () => Boolean(tenantId) && getCurrentTenantId() === tenantId;

  for (const tool of tools) {
    if (!isTenantActive()) return 'CANCELLED';
    const result = await execute(tool, tenantId, isTenantActive);
    if (!isTenantActive()) return 'CANCELLED';
    onResult(tool, result);
  }

  return 'COMPLETED';
}
