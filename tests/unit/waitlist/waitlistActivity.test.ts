import { describe, expect, it } from 'vitest';
import { summarizeActivity, type ActivityOffer } from '@/server/domain/waitlistActivity';
import { renderOfferEmail } from '@/server/i18n/offerEmail';

const offer = (id: string, freed: string, over: Partial<ActivityOffer> = {}): ActivityOffer => ({
  id,
  status: 'OPEN',
  startAt: new Date('2026-11-04T07:00:00Z'),
  expiresAt: new Date('2026-11-02T08:30:00Z'),
  createdAt: new Date('2026-11-02T08:00:00Z'),
  freedFromAppointmentId: freed,
  claimedAt: null,
  service: { id: 's', name: 'Cut' },
  staff: { id: 'k', displayName: 'Karim' },
  clientName: 'Rami Haddad',
  ...over,
});

describe('summarizeActivity', () => {
  it('groups per freed slot and picks OFFERED / CLAIMED / EXPIRED', () => {
    const items = summarizeActivity(
      [
        offer('a1', 'A'),
        offer('a2', 'A'),
        offer('a3', 'A'),
        offer('b1', 'B', {
          status: 'CLAIMED',
          claimedAt: new Date('2026-11-02T08:10:00Z'),
          createdAt: new Date('2026-11-02T07:00:00Z'),
        }),
        offer('b2', 'B', { status: 'SUPERSEDED', createdAt: new Date('2026-11-02T07:00:00Z') }),
        offer('c1', 'C', {
          status: 'EXPIRED',
          createdAt: new Date('2026-11-01T07:00:00Z'),
          expiresAt: new Date('2026-11-01T07:30:00Z'),
        }),
      ],
      10,
    );
    expect(items.map((i) => [i.type, i.offeredTo, i.offerId])).toEqual([
      ['CLAIMED', 2, 'b1'],
      ['OFFERED', 3, 'a1'],
      ['EXPIRED', 1, 'c1'],
    ]);
    expect(items[0]!.claimedBy).toEqual({ name: 'Rami' });
    expect(items[1]!.claimedBy).toBeNull();
  });

  it('applies the limit after sorting newest first', () => {
    const items = summarizeActivity(
      [
        offer('a', 'A', { createdAt: new Date('2026-11-01T00:00:00Z') }),
        offer('b', 'B', { createdAt: new Date('2026-11-03T00:00:00Z') }),
      ],
      1,
    );
    expect(items.map((i) => i.offerId)).toEqual(['b']);
  });
});

describe('renderOfferEmail', () => {
  const ctx = {
    locale: 'en',
    timezone: 'Asia/Beirut',
    businessName: 'Studio Nour',
    clientName: 'Lina',
    serviceName: 'Cut',
    staffName: 'Karim',
    startAt: new Date('2026-11-04T07:00:00Z'),
    expiresAt: new Date('2026-11-02T08:30:00Z'),
    claimUrl: 'https://app.test/o/abc.def',
    leaveUrl: 'https://app.test/o/xyz.sig/leave',
  };

  it('is deterministic and shows local time, expiry and the claim link', () => {
    const one = renderOfferEmail(ctx);
    expect(renderOfferEmail(ctx)).toEqual(one);
    expect(one.text).toContain('09:00');
    expect(one.text).toContain('10:30');
    expect(one.text).toContain('https://app.test/o/abc.def');
    expect(one.text).toContain('https://app.test/o/xyz.sig/leave');
    expect(one.html).toContain('https://app.test/o/xyz.sig/leave');
    expect(one.subject).toBe('A spot opened up: Cut on Wednesday 4 November 2026 at 09:00');
  });

  it('renders Arabic right to left and escapes names', () => {
    const r = renderOfferEmail({ ...ctx, locale: 'ar', businessName: '<b>x</b>\r\nBcc: evil' });
    expect(r.html).toContain('dir="rtl"');
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.text).not.toMatch(/\r|\nBcc/);
  });
});
