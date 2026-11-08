import { describe, expect, it } from 'vitest';
import { hidesNewBookingFab } from '@/components/app/nav';

describe('hidesNewBookingFab', () => {
  it('hides the floating button on the Pro checkout, where it could cover the Pay button', () => {
    expect(hidesNewBookingFab('/app/checkout')).toBe(true);
    expect(hidesNewBookingFab('/app/checkout/')).toBe(true);
  });
  it('keeps it everywhere else, including look-alike paths', () => {
    for (const p of ['/app', '/app/settings', '/app/clients', '/app/checkout-history', '/app/checkoutx'])
      expect(hidesNewBookingFab(p), p).toBe(false);
  });
});
