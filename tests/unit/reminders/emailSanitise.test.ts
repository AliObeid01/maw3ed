import { describe, expect, it } from 'vitest';
import {
  oneLine,
  renderReminderEmail,
  renderWhatsappMessage,
  type EmailContext,
} from '@/server/i18n/emailRender';

const base: EmailContext = {
  kind: 'H24',
  locale: 'en',
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Rana',
  serviceName: 'Haircut',
  staffName: 'Maya',
  startAt: new Date('2026-11-04T07:00:00Z'),
  confirmUrl: 'https://app.test/l/confirm.sig',
  cancelUrl: 'https://app.test/l/cancel.sig',
};

const CONTROL = new RegExp(String.raw`[\r \u0007]`);
const evil = ['Rana', '\r\n', 'Bcc: evil@example.test', ' ', '\u0007', '  \tX'].join('');
const ctx: EmailContext = {
  ...base,
  clientName: evil,
  serviceName: evil,
  staffName: evil,
  businessName: evil,
};

describe('one-line sanitiser (text body, subject, WhatsApp)', () => {
  it('oneLine strips control characters and collapses whitespace', () => {
    expect(oneLine(evil)).toBe('Rana Bcc: evil@example.test X');
    expect(oneLine('  a \n\n b ')).toBe('a b');
  });

  it('a name with CR/LF cannot add a line to the plain text or the subject', () => {
    for (const kind of ['BOOKING', 'H24', 'H2'] as const) {
      const out = renderReminderEmail({ ...ctx, kind });
      expect(out.subject).not.toMatch(/[\r\n]/);
      expect(out.text.split('\n').some((l) => l.startsWith('Bcc:'))).toBe(false);
      expect(CONTROL.test(out.text)).toBe(false);
    }
  });

  it('the WhatsApp message keeps a fixed number of lines whatever the names contain', () => {
    const clean = renderWhatsappMessage({ ...base, kind: 'H24' });
    const dirty = renderWhatsappMessage({ ...ctx, kind: 'H24' });
    expect(dirty.split('\n')).toHaveLength(clean.split('\n').length);
    expect(CONTROL.test(dirty)).toBe(false);
  });

  it('wraps dynamic values in <bdi> in Arabic html only', () => {
    const ar = renderReminderEmail({ ...base, locale: 'ar' });
    expect(ar.html).toContain('<bdi>Rana</bdi>');
    expect(ar.html).toContain('<bdi>Haircut</bdi>');
    expect(ar.html).toContain('<bdi>Studio Nour</bdi>');
    expect(renderReminderEmail(base).html).not.toContain('<bdi>');
    const escaped = renderReminderEmail({ ...base, locale: 'ar', clientName: '<b>x</b>' });
    expect(escaped.html).toContain('<bdi>&lt;b&gt;x&lt;/b&gt;</bdi>');
  });
});
