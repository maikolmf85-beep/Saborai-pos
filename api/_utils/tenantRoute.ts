export type TenantApiAction = 'onboarding' | 'profile';

export function resolveTenantApiAction(requestUrl?: string): TenantApiAction | null {
  if (!requestUrl) return null;

  let pathname: string;
  try {
    pathname = new URL(requestUrl, 'http://localhost').pathname;
  } catch {
    return null;
  }

  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalizedPath === '/api/tenant/onboarding') return 'onboarding';
  if (normalizedPath === '/api/tenant/profile') return 'profile';
  return null;
}
