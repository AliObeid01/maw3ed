import { describe, expect, it } from 'vitest';
import {
  BOOKABLE_STAFF_LIMIT,
  bookableStaffLimit,
  canAddBookableStaff,
  fitsPlan,
  PLAN_PRICE,
} from '@/server/domain/plan';

describe('plan limits', () => {
  it('keeps the numbers in one place', () => {
    expect(BOOKABLE_STAFF_LIMIT.FREE).toBe(1);
    expect(BOOKABLE_STAFF_LIMIT.PRO).toBeNull();
    expect(bookableStaffLimit('FREE')).toBe(1);
    expect(bookableStaffLimit('PRO')).toBeNull();
    expect(PLAN_PRICE.PRO).toEqual({ amount: 20, currency: 'USD' }); // PR-13: Pro is $20 a month
  });

  it('FREE allows the first bookable staff member and blocks the second', () => {
    expect(canAddBookableStaff('FREE', 0)).toEqual({ ok: true });
    expect(canAddBookableStaff('FREE', 1)).toEqual({ ok: false, limit: 1, current: 1 });
  });

  it('FREE blocks when existing data is already over the limit (grandfathered)', () => {
    expect(canAddBookableStaff('FREE', 3)).toEqual({ ok: false, limit: 1, current: 3 });
  });

  it('PRO is unlimited', () => {
    expect(canAddBookableStaff('PRO', 0)).toEqual({ ok: true });
    expect(canAddBookableStaff('PRO', 500)).toEqual({ ok: true });
  });

  it('fitsPlan: a downgrade is allowed only when usage fits', () => {
    expect(fitsPlan('FREE', 0)).toBe(true);
    expect(fitsPlan('FREE', 1)).toBe(true);
    expect(fitsPlan('FREE', 2)).toBe(false);
    expect(fitsPlan('PRO', 99)).toBe(true);
  });
});
