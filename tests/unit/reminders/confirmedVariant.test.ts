import { describe, expect, it } from 'vitest';
import { confirmedBeforeReminder } from '@/server/domain/reminderConfirmed';
import { renderReminderEmail, renderWhatsappMessage } from '@/server/i18n/emailRender';
import { getEmailMessages } from '@/server/i18n/messages';

const CONFIRM = 'https://app.test/l/confirm.sig';
const CANCEL = 'https://app.test/l/cancel.sig';
const startAt = new Date('2026-11-10T09:00:00Z');

const base = (kind: 'H24' | 'H2', locale: 'en' | 'ar', confirmed?: boolean) => ({
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
  ...(confirmed === undefined ? {} : { confirmed }),
});
const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

describe('confirmedBeforeReminder', () => {
  const dueAt = new Date('2026-11-09T09:00:00Z');
  it('is true only when confirmed at or before the job is due', () => {
    expect(confirmedBeforeReminder(new Date('2026-11-08T10:00:00Z'), dueAt)).toBe(true);
    expect(confirmedBeforeReminder(dueAt, dueAt)).toBe(true);
    expect(confirmedBeforeReminder(new Date(dueAt.getTime() + 1), dueAt)).toBe(false);
    expect(confirmedBeforeReminder(null, dueAt)).toBe(false);
  });
});

describe('reminder email, confirmed variant', () => {
  for (const kind of ['H24', 'H2'] as const)
    for (const locale of ['en', 'ar'] as const) {
      const m = getEmailMessages(locale);
      it(`${kind} ${locale}: Cancel only, with the confirmed note; subject and heading unchanged`, () => {
        const normal = renderReminderEmail(base(kind, locale, false));
        const conf = renderReminderEmail(base(kind, locale, true));
        expect(conf.subject).toBe(normal.subject);
        expect(hrefs(conf.html)).toEqual([CANCEL]);
        expect(hrefs(normal.html)).toEqual([CONFIRM, CANCEL]);
        expect(conf.html).not.toContain(CONFIRM);
        expect(conf.html).not.toContain(m.actions.confirm);
        expect(conf.text).not.toContain(CONFIRM);
        expect(conf.text).not.toContain(m.actions.confirm);
        expect(conf.text).toContain(`${m.actions.cancel}: ${CANCEL}`);
        expect(m.confirmedNote.length).toBeGreaterThan(5);
        expect(conf.text).toContain(m.confirmedNote);
        expect(conf.html).toContain(m.confirmedNote);
        expect(normal.text).not.toContain(m.confirmedNote);
        // the "links stop working" note stays
        expect(conf.text).toContain(m.actions.linkNote);
        expect(conf.html).toContain(m.actions.linkNote);
      });
    }

  it('the English wording is exactly "You have confirmed this appointment."', () => {
    expect(getEmailMessages('en').confirmedNote).toBe('You have confirmed this appointment.');
  });

  it('is byte-for-byte deterministic: the same inputs render the same bytes every time', () => {
    const a = renderReminderEmail(base('H24', 'en', true));
    const b = renderReminderEmail(base('H24', 'en', true));
    expect(b).toEqual(a);
  });

  it('the default (flag absent) and the BOOKING email are the normal variant', () => {
    expect(renderReminderEmail(base('H2', 'en'))).toEqual(renderReminderEmail(base('H2', 'en', false)));
    const booking = renderReminderEmail({ ...base('H24', 'en', true), kind: 'BOOKING' });
    expect(booking.text).toContain(CONFIRM);
    expect(booking.text).not.toContain(getEmailMessages('en').confirmedNote);
  });
});

describe('WhatsApp text, confirmed variant', () => {
  for (const kind of ['H24', 'H2'] as const)
    for (const locale of ['en', 'ar'] as const) {
      it(`${kind} ${locale}: no Confirm line, the note, the Cancel line`, () => {
        const m = getEmailMessages(locale);
        const { kind: _k, ...rest } = base(kind, locale);
        void _k;
        const normal = renderWhatsappMessage({ kind, ...rest });
        const conf = renderWhatsappMessage({ kind, ...rest, confirmed: true });
        expect(normal).toContain(CONFIRM);
        expect(conf).not.toContain(CONFIRM);
        expect(conf).toContain(CANCEL);
        expect(conf).toContain(m.confirmedNote);
        expect(conf.split('\n').length).toBe(normal.split('\n').length);
      });
    }

  it('LATE (a booking confirmation text) is unchanged even when flagged', () => {
    const { kind: _k, ...rest } = base('H24', 'en');
    void _k;
    expect(renderWhatsappMessage({ kind: 'LATE', ...rest, confirmed: true })).toBe(
      renderWhatsappMessage({ kind: 'LATE', ...rest }),
    );
  });
});
