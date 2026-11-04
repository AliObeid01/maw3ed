import { describe, expect, it } from 'vitest';
import { bookingEmailPlan } from '@/server/domain/bookingPlan';
import { renderReminderEmail, type EmailContext } from '@/server/i18n/emailRender';
import { getEmailMessages } from '@/server/i18n/messages';

const bookedAt = new Date('2026-11-01T08:00:00Z');
const startIn = (ms: number) => new Date(bookedAt.getTime() + ms);
const H = 3_600_000;
const M = 60_000;

const CONFIRM = 'https://app.test/l/confirm.sig';
const CANCEL = 'https://app.test/l/cancel.sig';

const ctx = (
  kind: EmailContext['kind'],
  startAt: Date,
  locale: 'en' | 'ar',
  hasEmail = true,
) => ({
  kind,
  locale,
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  startAt,
  confirmUrl: CONFIRM,
  cancelUrl: CANCEL,
  ...(kind === 'BOOKING' ? bookingEmailPlan(startAt, bookedAt, hasEmail) : {}),
});

const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

interface Tier {
  name: string;
  lead: number;
  links: 'both' | 'cancel';
  promise: boolean;
}
const TIERS: Tier[] = [
  { name: '23 h 59 m', lead: 24 * H - M, links: 'both', promise: true },
  { name: '24 h 0 m', lead: 24 * H, links: 'cancel', promise: true },
  { name: '25 h', lead: 25 * H, links: 'cancel', promise: true },
  { name: '1 h', lead: 1 * H, links: 'both', promise: false },
  { name: 'exactly 2 h', lead: 2 * H, links: 'both', promise: true },
  { name: '10 days', lead: 240 * H, links: 'cancel', promise: true },
];

describe('F68 booking email: wording says BOOKED, never confirmed', () => {
  it('English subject, heading and intro', () => {
    const out = renderReminderEmail(ctx('BOOKING', startIn(48 * H), 'en'));
    expect(out.subject).toBe('Your slot is booked: Haircut on Tuesday 3 November 2026');
    expect(out.text).toContain('Your slot has been booked');
    expect(out.text).toContain('You are booked in at Studio Nour.');
    expect(out.html).toContain('<h1');
    expect(out.html).toContain('Your slot has been booked');
  });

  it('Arabic subject, heading and intro', () => {
    const m = getEmailMessages('ar').booking;
    const out = renderReminderEmail(ctx('BOOKING', startIn(48 * H), 'ar'));
    expect(out.subject).toContain('تم حجز موعدك');
    expect(out.text).toContain(m.heading);
    expect(m.heading).toBe('تم حجز موعدك');
    // Neither language calls the booking "confirmed".
    expect(m.subject + m.heading + m.intro).not.toMatch(/تأكيد/);
    expect(getEmailMessages('en').booking.subject + getEmailMessages('en').booking.heading).not.toMatch(
      /confirm/i,
    );
  });

  for (const t of TIERS) {
    for (const locale of ['en', 'ar'] as const) {
      describe(`${t.name} ahead (${locale})`, () => {
        const start = startIn(t.lead);
        const out = renderReminderEmail(ctx('BOOKING', start, locale));
        const m = getEmailMessages(locale);

        it('never says "confirmed" (en) in subject, text or html', () => {
          if (locale === 'en') {
            for (const s of [out.subject, out.text, out.html]) expect(s).not.toMatch(/confirmed/i);
          } else {
            expect(out.subject).not.toContain('تأكيد');
          }
        });

        it(`carries ${t.links === 'both' ? 'BOTH links' : 'the CANCEL link only'} in text and html`, () => {
          if (t.links === 'both') {
            expect(out.text).toContain(`${m.actions.confirm}: ${CONFIRM}`);
            expect(out.text).toContain(`${m.actions.cancel}: ${CANCEL}`);
            expect(hrefs(out.html)).toEqual([CONFIRM, CANCEL]);
          } else {
            expect(out.text).toContain(`${m.actions.cancel}: ${CANCEL}`);
            expect(out.text).not.toContain(CONFIRM);
            expect(out.text).not.toContain(m.actions.confirm);
            expect(out.html).not.toContain(CONFIRM);
            expect(out.html).not.toContain(m.actions.confirm);
            // Cancel is the only button and the only link.
            expect(hrefs(out.html)).toEqual([CANCEL]);
            expect(out.html).toContain(`>${m.actions.cancel}</a>`);
          }
        });

        it('the link-expiry note is there (the email carries links)', () => {
          expect(out.text).toContain(m.actions.linkNote);
          expect(out.html).toContain(m.actions.linkNote);
        });

        it('keeps the calendar-file note', () => {
          expect(out.text).toContain(m.calendar);
          expect(out.html).toContain(m.calendar);
        });

        it(`${t.promise ? 'promises' : 'does not promise'} a reminder`, () => {
          const sentence = m.booking.reminderPromise;
          expect(sentence).toBeTruthy();
          for (const s of [out.text, out.html]) {
            if (t.promise) expect(s).toContain(sentence);
            else expect(s).not.toContain(sentence);
          }
        });

        it('is byte-for-byte the same on a retry', () => {
          expect(renderReminderEmail(ctx('BOOKING', start, locale))).toEqual(out);
        });
      });
    }
  }

  it('a client without an email is promised no reminder', () => {
    const out = renderReminderEmail(ctx('BOOKING', startIn(48 * H), 'en', false));
    expect(out.text).not.toContain(getEmailMessages('en').booking.reminderPromise);
  });
});

describe('F68 reminders keep both links and the "Reminder" wording', () => {
  for (const kind of ['H24', 'H2'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      it(`${kind} (${locale}): both links, the note, no reminder promise, no calendar note`, () => {
        const out = renderReminderEmail(ctx(kind, startIn(48 * H), locale));
        const m = getEmailMessages(locale);
        expect(hrefs(out.html)).toEqual([CONFIRM, CANCEL]);
        expect(out.text).toContain(CONFIRM);
        expect(out.text).toContain(CANCEL);
        expect(out.text).toContain(m.actions.linkNote);
        expect(out.text).not.toContain(m.booking.reminderPromise);
        expect(out.text).not.toContain(m.calendar);
        if (locale === 'en') expect(out.subject).toMatch(/^Reminder: /);
      });
    }
  }

  it('a links option on a reminder is ignored: only the booking email can be cancel-only', () => {
    const out = renderReminderEmail({ ...ctx('H24', startIn(48 * H), 'en'), links: 'cancel' });
    expect(hrefs(out.html)).toEqual([CONFIRM, CANCEL]);
  });
});
