/**
 * Global access is an explicit deployment policy, not a restaurant users.role.
 * An empty or malformed configuration grants nobody access.
 */
export function parseGlobalAdminUserIds(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(',')
      .map(id => id.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isGlobalAdminUser(userId: unknown, configuredIds: ReadonlySet<string>): boolean {
  return typeof userId === 'string' && configuredIds.has(userId.trim().toLowerCase());
}
