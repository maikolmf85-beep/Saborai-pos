export const TILOPAY_SIGNUP_PLAN = Object.freeze({
  id: 'pro',
  amount: 45000,
  currency: 'CRC'
});

export function isSupportedTilopayPlan(value: unknown): value is typeof TILOPAY_SIGNUP_PLAN.id {
  return value === TILOPAY_SIGNUP_PLAN.id;
}
