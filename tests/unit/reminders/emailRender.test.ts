import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatLocal,
  interpolate,
  renderReminderEmail,
  renderWhatsappMessage,
  type EmailContext,
} from '@/server/i18n/emailRender';
import { getEmailMessages } from '@/server/i18n/messages';

const base: EmailContext = {
  kind: 'H24',
  locale: 'en',
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  // 07:00Z = 09:00 in Beirut (UTC+2) in early November
  startAt: new Date('2026-11-04T07:00:00Z'),
  confirmUrl: 'https://app.test/l/confirm.sig',
  cancelUrl: 'https://app.test/l/cancel.sig',
};

describe('formatLocal', () => {
  it('formats in the business timezone, not UTC', () => {
    expect(formatLocal(base.startAt, 'Asia/Beirut', 'en')).toEqual({
      date: 'Wednesday 4 November 2026',
      time: '09:00',
      when: 'Wednesday 4 November 2026, 09:00',
    });
    expect(formatLocal(base.startAt, 'America/New_York', 'en').time).toBe('02:00');
  });
  it('follows DST: Beirut is UTC+3 in summer', () => {
    expect(formatLocal(new Date('2026-07-01T07:00:00Z'), 'Asia/Beirut', 'en').time).toBe('10:00');
  });
  it('uses latn digits in Arabic', () => {
    const f = formatLocal(base.startAt, 'Asia/Beirut', 'ar');
    expect(f.time).toBe('09:00');
    expect(f.date).toMatch(/4/);
    expect(f.date).toMatch(/2026/);
    expect(f.date).not.toMatch(/[٠-٩]/);
    expect(f.date).toMatch(/[؀-ۿ]/);
  });
});

describe('interpolate / escapeHtml', () => {
  it('replaces placeholders and leaves unknown ones untouched', () => {
    expect(interpolate('Hi {name} {x}', { name: 'A' })).toBe('Hi A {x}');
  });
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('message catalogue', () => {
  it('loads en and ar and falls back to en for unknown locales', () => {
    expect(getEmailMessages('en').h24.heading).toBeTruthy();
    expect(getEmailMessages('ar').h24.heading).not.toBe(getEmailMessages('en').h24.heading);
    expect(getEmailMessages('fr')).toBe(getEmailMessages('en'));
  });
});

describe('renderReminderEmail', () => {
  it('includes service, staff, local time, business and both links in text and html', () => {
    const out = renderReminderEmail(base);
    for (const body of [out.text, out.html]) {
      expect(body).toContain('Haircut');
      expect(body).toContain('Maya');
      expect(body).toContain('Studio Nour');
      expect(body).toContain('09:00');
      expect(body).toContain('Wednesday 4 November 2026');
      expect(body).toContain('https://app.test/l/confirm.sig');
      expect(body).toContain('https://app.test/l/cancel.sig');
    }
    expect(out.subject).toBe('Reminder: Haircut tomorrow at 09:00');
    expect(out.html).toContain('dir="ltr"');
    expect(out.html).toContain('lang="en"');
    expect(out.text).toContain('Hi Rana,');
  });

  it('h2 and booking use their own copy', () => {
    expect(renderReminderEmail({ ...base, kind: 'H2' }).subject).toBe(
      'Reminder: Haircut today at 09:00',
    );
    expect(renderReminderEmail({ ...base, kind: 'BOOKING' }).subject).toBe(
      'Your slot is booked: Haircut on Wednesday 4 November 2026',
    );
  });

  it('only the booking confirmation mentions the attached calendar file', () => {
    const b = renderReminderEmail({ ...base, kind: 'BOOKING' });
    expect(b.text).toContain(getEmailMessages('en').calendar);
    expect(renderReminderEmail(base).text).not.toContain(getEmailMessages('en').calendar);
  });

  it('renders Arabic right-to-left with Arabic copy', () => {
    const out = renderReminderEmail({ ...base, locale: 'ar' });
    expect(out.html).toContain('dir="rtl"');
    expect(out.html).toContain('lang="ar"');
    expect(out.html).toContain(getEmailMessages('ar').h24.heading);
    expect(out.subject).toContain('09:00');
    expect(out.html).toContain('https://app.test/l/cancel.sig');
  });

  it('HTML-escapes every dynamic value in the html body and keeps plain text raw', () => {
    const evil = `<script>alert(1)</script>"&'`;
    const out = renderReminderEmail({
      ...base,
      clientName: evil,
      serviceName: evil,
      staffName: evil,
      businessName: evil,
      confirmUrl: 'https://app.test/l/a"b<c',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;');
    expect(out.html).not.toContain('a"b<c');
    expect(out.text).toContain(evil);
  });

  it('strips line breaks from the subject (no header injection)', () => {
    const out = renderReminderEmail({ ...base, serviceName: 'Cut\r\nBcc: evil@example.test' });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe('renderWhatsappMessage', () => {
  it('contains service, local time, business and both links, in the business locale', () => {
    const en = renderWhatsappMessage({ ...base, kind: 'H24' });
    expect(en).toContain('Studio Nour');
    expect(en).toContain('Haircut');
    expect(en).toContain('09:00');
    expect(en).toContain(base.confirmUrl);
    expect(en).toContain(base.cancelUrl);
    const ar = renderWhatsappMessage({ ...base, kind: 'H2', locale: 'ar' });
    expect(ar).toContain('موعد');
    expect(ar).toContain(base.cancelUrl);
  });
});
