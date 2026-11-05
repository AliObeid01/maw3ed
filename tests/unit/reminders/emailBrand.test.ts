import { describe, expect, it } from 'vitest';
import { renderReminderEmail, type EmailContext } from '@/server/i18n/emailRender';
import { renderOfferEmail } from '@/server/i18n/offerEmail';
import { EMAIL_COLORS, EMAIL_LOGO_HEIGHT, EMAIL_LOGO_PATH } from '@/server/i18n/emailLayout';
import { getEmailMessages } from '@/server/i18n/messages';
import { inviteEmail } from '@/server/providers/email/inviteTemplate';
import { accountEmail } from '@/server/providers/email/accountEmails';

interface Out {
  subject: string;
  text: string;
  html: string;
}
interface Kind {
  name: string;
  render: (locale: string, names?: { business: string; client: string }) => Out;
  cta: string;
  secondary: string[];
  subjectEn: string;
}

const startAt = new Date('2026-11-04T07:00:00Z');
const reminder =
  (kind: EmailContext['kind'], extra: { links?: 'both' | 'cancel'; reminderPromise?: boolean } = {}) =>
  (locale: string, names = { business: 'Studio Nour', client: 'Rana' }) =>
    renderReminderEmail({
      ...extra,
      kind,
      locale,
      timezone: 'Asia/Beirut',
      businessName: names.business,
      clientName: names.client,
      serviceName: 'Haircut',
      staffName: 'Maya',
      startAt,
      confirmUrl: 'https://app.test/l/confirm.sig?a=1&b=2',
      cancelUrl: 'https://app.test/l/cancel.sig',
    });

const KINDS: Kind[] = [
  {
    name: 'booking',
    render: reminder('BOOKING'),
    cta: 'https://app.test/l/confirm.sig?a=1&b=2',
    secondary: ['https://app.test/l/cancel.sig'],
    subjectEn: 'Your slot is booked: Haircut on Wednesday 4 November 2026',
  },
  {
    name: 'h24',
    render: reminder('H24'),
    cta: 'https://app.test/l/confirm.sig?a=1&b=2',
    secondary: ['https://app.test/l/cancel.sig'],
    subjectEn: 'Reminder: Haircut tomorrow at 09:00',
  },
  {
    name: 'h2',
    render: reminder('H2'),
    cta: 'https://app.test/l/confirm.sig?a=1&b=2',
    secondary: ['https://app.test/l/cancel.sig'],
    subjectEn: '',
  },
  {
    name: 'offer',
    render: (locale, names = { business: 'Studio Nour', client: 'Rana' }) =>
      renderOfferEmail({
        locale,
        timezone: 'Asia/Beirut',
        businessName: names.business,
        clientName: names.client,
        serviceName: 'Haircut',
        staffName: 'Maya',
        startAt,
        expiresAt: new Date('2026-11-03T10:30:00Z'),
        claimUrl: 'https://app.test/o/claim.sig',
        leaveUrl: 'https://app.test/o/leave.sig',
      }),
    cta: 'https://app.test/o/claim.sig',
    secondary: ['https://app.test/o/leave.sig'],
    subjectEn: '',
  },
  {
    name: 'invite',
    render: (locale, names = { business: 'Studio Nour', client: 'Rana' }) =>
      inviteEmail({
        locale,
        businessName: names.business,
        acceptUrl: 'https://app.test/invite/abc',
        expiresAt: new Date('2026-11-10T10:00:00Z'),
        timezone: 'Asia/Beirut',
      }),
    cta: 'https://app.test/invite/abc',
    secondary: [],
    subjectEn: 'You are invited to join Studio Nour on Maw3ed',
  },
  {
    name: 'verify',
    render: (locale, names = { business: 'Studio Nour', client: 'Rana' }) =>
      accountEmail({
        kind: 'VERIFY',
        locale,
        businessName: names.business,
        url: 'https://app.test/verify-email?token=tok123',
      }),
    cta: 'https://app.test/verify-email?token=tok123',
    secondary: [],
    subjectEn: '',
  },
  {
    name: 'reset',
    render: (locale, names = { business: 'Studio Nour', client: 'Rana' }) =>
      accountEmail({
        kind: 'RESET',
        locale,
        businessName: names.business,
        url: 'https://app.test/reset-password?token=tok456',
      }),
    cta: 'https://app.test/reset-password?token=tok456',
    secondary: [],
    subjectEn: '',
  },
  {
    // F68: booked 24 h or more ahead, the booking email carries the Cancel link only (appended last: the
    // tests below index KINDS by position).
    name: 'booking (cancel only)',
    render: (locale, names) =>
      reminder('BOOKING', { links: 'cancel', reminderPromise: true })(locale, names),
    cta: 'https://app.test/l/cancel.sig',
    secondary: [],
    subjectEn: 'Your slot is booked: Haircut on Wednesday 4 November 2026',
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;');
const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

describe('branded email layout (all kinds)', () => {
  for (const k of KINDS) {
    for (const locale of ['en', 'ar'] as const) {
      describe(`${k.name} (${locale})`, () => {
        const out = k.render(locale);
        const rtl = locale === 'ar';

        it('uses the shared layout and brand colours', () => {
          expect(out.html).toContain('<meta name="color-scheme" content="light">');
          expect(out.html).toContain('<meta name="supported-color-schemes" content="light">');
          for (const c of [
            EMAIL_COLORS.canvas,
            EMAIL_COLORS.card,
            EMAIL_COLORS.line,
            EMAIL_COLORS.ink,
            EMAIL_COLORS.muted,
            EMAIL_COLORS.brand,
            EMAIL_COLORS.navy,
          ]) {
            expect(out.html).toContain(c);
          }
          expect(out.html).toContain('max-width:600px');
          expect(out.html).toContain('border-radius:16px');
          expect(out.html).toContain('padding:14px 28px');
          // F69-C: the ONLY image is the logo in the navy band (see the header test below).
          expect(out.html.match(/<img\b/gi)).toHaveLength(1);
          expect(out.html).not.toMatch(/@import|<link\b|url\(|data:image/i);
          // The gold wordmark underline is gone everywhere.
          expect(out.html).not.toMatch(/e8b86d|border-bottom:3px/i);
          // The old neutral palette is gone.
          expect(out.html).not.toMatch(/#f6f5f1|#0E7C66|#5a5a5a|#1b1b1b|#174c4f|#f7f5f0/i);
        });

        it('has the navy logo band: absolute reverse logo, width/height, alt, display:block, readable alt colours', () => {
          const img = /<img\b[^>]*>/.exec(out.html)![0];
          expect(img).toContain(`src="http://localhost:3000${EMAIL_LOGO_PATH}"`);
          expect(img).toContain('src="http://localhost:3000/brand/maw3ed-email-logo-reverse-320w.png"');
          expect(img).toContain('width="160"');
          expect(img).toContain(`height="${EMAIL_LOGO_HEIGHT}"`);
          expect(img).toContain('alt="Maw3ed"');
          expect(img).toMatch(/style="[^"]*display:block/);
          expect(img).toMatch(/style="[^"]*border:0/);
          expect(img).toMatch(/style="[^"]*color:#ffffff/);
          // The band is a navy cell (bgcolor for Outlook) holding the logo, ahead of the white card.
          const band = /<td [^>]*bgcolor="#0b1938"[^>]*>(?:(?!<\/td>).)*<img\b/.exec(out.html)?.[0];
          expect(band).toBeDefined();
          expect(out.html.indexOf('<img')).toBeLessThan(out.html.indexOf('<h1'));
          // The plain-text part carries no image and no markup.
          expect(out.text).not.toMatch(/<img|brand\/maw3ed/);
        });

        it('keeps the CTA href exactly and shows the same URL as visible text', () => {
          expect(hrefs(out.html)[0]).toBe(esc(k.cta));
          expect(out.html).toContain(`>${esc(k.cta)}</span>`);
          expect(out.html).toContain(getEmailMessages(locale).fallback);
          expect(hrefs(out.html).slice(1)).toEqual(k.secondary.map(esc));
          expect(out.text).toContain(k.cta);
        });

        it('has a preheader, lang and dir, and no undefined/null', () => {
          expect(out.html).toMatch(/<div style="display:none;[^"]*">[^<]+<\/div>/);
          expect(out.html).toContain(`<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">`);
          expect(out.html).toContain(`<td align="center" bgcolor="${EMAIL_COLORS.brand}"`);
          expect(out.html).not.toMatch(/undefined|null|\{\w+\}/);
          expect(out.html).not.toMatch(
            /(?:margin|padding)-(?:left|right)|text-align:(?:left|right)/,
          );
          if (rtl) {
            expect(out.html).toContain('Tahoma');
            expect(out.html).toContain('<bdi>');
          } else {
            expect(out.html).not.toContain('<bdi>');
          }
        });

        it('escapes hostile business and client names', () => {
          const hostile = k.render(locale, {
            business: '<script>alert(1)</script>"x\'',
            client: '<img src=x onerror=1>"y\'',
          });
          expect(hostile.html).not.toContain('<script>');
          // Still only our own logo: the hostile client name never becomes a tag.
          expect(hostile.html.match(/<img\b/gi)).toHaveLength(1);
          expect(hostile.html).not.toContain('<img src=x');
          expect(hostile.html).not.toContain('onerror=1>');
          // The password reset email never names the business.
          if (k.name !== 'reset') expect(hostile.html).toContain('&lt;script&gt;');
        });
      });
    }
  }

  it('English subjects are unchanged', () => {
    for (const k of KINDS.filter((x) => x.subjectEn)) {
      expect(k.render('en').subject).toBe(k.subjectEn);
    }
    expect(KINDS[2]!.render('en').subject).toBe('Reminder: Haircut today at 09:00');
    expect(KINDS[3]!.render('en').subject).toBe(
      getEmailMessages('en').offer.subject.replace(/\{\w+\}/g, (m) => {
        const map: Record<string, string> = {
          service: 'Haircut',
          date: 'Wednesday 4 November 2026',
          time: '09:00',
          business: 'Studio Nour',
        };
        return map[m.slice(1, -1)] ?? m;
      }),
    );
  });

  it('the secondary link comes after the primary button in the markup, and Arabic mirrors via dir=rtl', () => {
    const ar = KINDS[1]!.render('ar').html;
    const en = KINDS[1]!.render('en').html;
    for (const html of [ar, en]) {
      expect(html.indexOf('/l/confirm.sig')).toBeLessThan(html.indexOf('/l/cancel.sig'));
    }
    // Direction comes from dir on html, body, the container table and the content cell (no hard-coded sides).
    expect(ar.match(/dir="rtl"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(en.match(/dir="ltr"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(ar).toContain('text-align:start');
  });
});
