import { describe, expect, it } from 'vitest';
import {
  renderReminderEmail,
  renderWhatsappMessage,
  type EmailContext,
} from '@/server/i18n/emailRender';
import { renderOfferEmail, type OfferEmailContext } from '@/server/i18n/offerEmail';
import { inviteEmail } from '@/server/providers/email/inviteTemplate';

const startAt = new Date('2026-11-04T07:00:00Z'); // 09:00 in Beirut
const reminder = (locale: string, kind: EmailContext['kind']): EmailContext => ({
  kind,
  locale,
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  startAt,
  confirmUrl: 'https://app.test/l/confirm.sig',
  cancelUrl: 'https://app.test/l/cancel.sig',
});
const offer = (locale: string): OfferEmailContext => ({
  locale,
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  startAt,
  expiresAt: new Date('2026-11-03T10:30:00Z'),
  claimUrl: 'https://app.test/o/claim.sig',
  leaveUrl: 'https://app.test/o/leave.sig',
});

const ARABIC = /[؀-ۿ]/;
function expectClean(out: { subject: string; text: string; html: string }) {
  for (const part of [out.subject, out.text, out.html]) {
    expect(part).not.toContain('undefined');
    expect(part).not.toMatch(/\{\w+\}/);
  }
}

describe('Arabic and English mail templates', () => {
  for (const kind of ['BOOKING', 'H24', 'H2'] as const) {
    it(`reminder ${kind}: ar is rtl, Arabic subject, links unchanged`, () => {
      const out = renderReminderEmail(reminder('ar', kind));
      expect(out.html).toContain('<html lang="ar" dir="rtl">');
      expect(out.html).toContain('Tahoma');
      expect(out.subject).toMatch(ARABIC);
      expect(out.text).toContain('https://app.test/l/confirm.sig');
      expect(out.html).toContain('href="https://app.test/l/cancel.sig"');
      expect(out.text).toContain('09:00');
      expectClean(out);
    });
    it(`reminder ${kind}: en is ltr`, () => {
      const out = renderReminderEmail(reminder('en', kind));
      expect(out.html).toContain('<html lang="en" dir="ltr">');
      expect(out.subject).not.toMatch(ARABIC);
      expectClean(out);
    });
  }

  it('whatsapp text is Arabic for ar and carries both links', () => {
    for (const kind of ['H24', 'H2'] as const) {
      const ar = renderWhatsappMessage({ ...reminder('ar', kind), kind });
      expect(ar).toMatch(ARABIC);
      expect(ar).toContain('Studio Nour');
      expect(ar).toContain('https://app.test/l/confirm.sig');
      expect(ar).toContain('https://app.test/l/cancel.sig');
      expect(ar).not.toContain('undefined');
      expect(ar.length).toBeLessThan(600);
    }
  });

  it('waitlist offer: ar and en', () => {
    const ar = renderOfferEmail(offer('ar'));
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(ar.subject).toMatch(ARABIC);
    expect(ar.text).toContain('https://app.test/o/claim.sig');
    expect(ar.text).toContain('12:30'); // 10:30Z in Beirut (UTC+2)
    expectClean(ar);
    const en = renderOfferEmail(offer('en'));
    expect(en.html).toContain('dir="ltr"');
    expectClean(en);
  });

  it('invite: ar is rtl with an Arabic subject, en is ltr, link unchanged', () => {
    const opts = {
      businessName: 'Studio Nour',
      acceptUrl: 'https://app.test/invite/abc',
      expiresAt: new Date('2026-11-10T10:00:00Z'),
      timezone: 'Asia/Beirut',
    };
    const ar = inviteEmail({ ...opts, locale: 'ar' });
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(ar.subject).toMatch(ARABIC);
    expect(ar.subject).toContain('Studio Nour');
    expect(ar.text).toContain('https://app.test/invite/abc');
    expect(ar.html).toContain('href="https://app.test/invite/abc"');
    expect(ar.text).toContain('12:00');
    expectClean(ar);
    const en = inviteEmail({ ...opts, locale: 'en' });
    expect(en.html).toContain('dir="ltr"');
    expect(en.subject).toBe('You are invited to join Studio Nour on Maw3ed');
    expectClean(en);
  });

  it('escapes hostile business names in the invite html', () => {
    const out = inviteEmail({
      businessName: '<script>x</script>',
      acceptUrl: 'https://app.test/invite/abc',
      expiresAt: startAt,
      locale: 'ar',
    });
    expect(out.html).not.toContain('<script>');
  });
});
