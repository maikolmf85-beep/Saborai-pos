export const ADMIN_RESTAURANT_SELECT = 'id,name,email,phone,plan,onboarding_completed';
export const ADMIN_RESTAURANT_SUBSCRIPTION_SELECT = 'tenant_id,mode,plan,trial_ends_at,activated_at';
export const ADMIN_RESTAURANT_BRANCH_SELECT = 'id,tenant_id,name,code,is_active';

export const DEFAULT_ADMIN_RESTAURANT_PAGE_SIZE = 50;
export const MAX_ADMIN_RESTAURANT_PAGE_SIZE = 100;
const MAX_ADMIN_RESTAURANT_OFFSET = 1_000_000;

export interface AdminRestaurantPagination {
  limit: number;
  offset: number;
}

export type AdminRestaurantPlan = 'express' | 'pro' | 'multibranch' | null;
export type AdminRestaurantSubscriptionMode = 'DEMO' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;

export interface AdminRestaurantSubscription {
  mode: AdminRestaurantSubscriptionMode;
  plan: AdminRestaurantPlan;
  trialEndsAt: string | null;
  activatedAt: string | null;
}

export interface AdminRestaurantBranch {
  id: string;
  name: string;
  code: string;
  isActive: boolean | null;
}

export interface AdminRestaurantSummary {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan: AdminRestaurantPlan;
  onboardingCompleted: boolean | null;
  subscription: AdminRestaurantSubscription | null;
  branches: AdminRestaurantBranch[];
}

function parseQueryInteger(value: unknown, defaultValue: number): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseAdminRestaurantPagination(
  limitValue: unknown,
  offsetValue: unknown
): AdminRestaurantPagination | null {
  const limit = parseQueryInteger(limitValue, DEFAULT_ADMIN_RESTAURANT_PAGE_SIZE);
  const offset = parseQueryInteger(offsetValue, 0);

  if (limit === null || limit < 1 || limit > MAX_ADMIN_RESTAURANT_PAGE_SIZE) return null;
  if (offset === null || offset > MAX_ADMIN_RESTAURANT_OFFSET) return null;

  return { limit, offset };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function planValue(value: unknown): AdminRestaurantPlan {
  return value === 'express' || value === 'pro' || value === 'multibranch' ? value : null;
}

function dateValue(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function subscriptionModeValue(value: unknown): AdminRestaurantSubscriptionMode {
  return value === 'DEMO' || value === 'TRIAL' || value === 'ACTIVE'
    || value === 'PAST_DUE' || value === 'CANCELLED'
    ? value
    : null;
}

export function mapAdminRestaurantSubscription(value: unknown): {
  tenantId: string;
  subscription: AdminRestaurantSubscription;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const tenantId = stringValue(row.tenant_id);
  if (!tenantId) return null;

  return {
    tenantId,
    subscription: {
      mode: subscriptionModeValue(row.mode),
      plan: planValue(row.plan),
      trialEndsAt: dateValue(row.trial_ends_at),
      activatedAt: dateValue(row.activated_at)
    }
  };
}

export function mapAdminRestaurantBranch(value: unknown): {
  tenantId: string;
  branch: AdminRestaurantBranch;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const id = stringValue(row.id);
  const tenantId = stringValue(row.tenant_id);
  if (!id || !tenantId) return null;

  return {
    tenantId,
    branch: {
      id,
      name: stringValue(row.name) || 'Sucursal sin nombre',
      code: stringValue(row.code),
      isActive: typeof row.is_active === 'boolean' ? row.is_active : null
    }
  };
}

export function mapAdminRestaurantSummary(value: unknown): AdminRestaurantSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  const id = stringValue(row.id);
  if (!id) return null;

  return {
    id,
    name: stringValue(row.name) || 'Restaurante sin nombre',
    email: stringValue(row.email),
    phone: stringValue(row.phone),
    plan: planValue(row.plan),
    onboardingCompleted: typeof row.onboarding_completed === 'boolean'
      ? row.onboarding_completed
      : null,
    subscription: null,
    branches: []
  };
}
