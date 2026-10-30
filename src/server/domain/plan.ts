// Plan limits. Pure: the single place the numbers live.
export type PlanName = 'FREE' | 'PRO';

/** Active bookable staff allowed per plan; `null` means unlimited. */
export const BOOKABLE_STAFF_LIMIT: Record<PlanName, number | null> = {
  FREE: 1,
  PRO: null,
};

/** Plain placeholder price for the Pro plan (test mode only; no card is ever charged). */
export const PLAN_PRICE = {
  PRO: { amount: 9, currency: 'USD' },
} as const;

export const bookableStaffLimit = (plan: PlanName): number | null => BOOKABLE_STAFF_LIMIT[plan];

export type AddCheck = { ok: true } | { ok: false; limit: number; current: number };

/** May one more active bookable staff member be added (or re-enabled) given `current` already? */
export function canAddBookableStaff(plan: PlanName, current: number): AddCheck {
  const limit = bookableStaffLimit(plan);
  if (limit === null || current < limit) return { ok: true };
  return { ok: false, limit, current };
}

/** Does existing usage fit the plan (used for downgrades; never hides or deactivates anyone)? */
export function fitsPlan(plan: PlanName, bookableCount: number): boolean {
  const limit = bookableStaffLimit(plan);
  return limit === null || bookableCount <= limit;
}
