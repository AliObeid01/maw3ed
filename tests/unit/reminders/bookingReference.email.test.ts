import { describe, expect, it } from 'vitest';
import { renderReminderEmail, type ReminderEmailContext } from '@/server/i18n/emailRender';

const base: ReminderEmailContext = {
  kind: 'BOOKING',
  locale: 'en',
  timezone: 'Asia/Beirut',
  businessName: 'Studio Nour',
  clientName: 'Lina',
  serviceName: 'Haircut',
  staffName: 'Sara',
  startAt: new Date('2026-11-10T08:00:00Z'),
  confirmUrl: 'https://app.example.test/l/confirm',
  cancelUrl: 'https://app.example.test/l/cancel',
  reference: 'K7M2QX',
};

describe('booking email shows the reference', () => {
  it('english: a Reference line in text and html', () => {
    const out = renderReminderEmail(base);
    expect(out.text).toContain('Reference: K7M2QX');
    expect(out.html).toContain('Reference');
    expect(out.html).toContain('K7M2QX');
  });

  it('arabic: the Arabic label with the Latin code, isolated for right-to-left', () => {
    const out = renderReminderEmail({ ...base, locale: 'ar' });
    expect(out.text).toContain('المرجع: K7M2QX');
    expect(out.html).toContain('المرجع');
    expect(out.html).toContain('K7M2QX');
  });

  it('is deterministic: a retry renders byte-identical mail', () => {
    expect(renderReminderEmail(base)).toEqual(renderReminderEmail({ ...base }));
  });

  it('has no line for a booking without a reference (rows before PR-6) and none in reminders', () => {
    expect(renderReminderEmail({ ...base, reference: null }).text).not.toContain('Reference');
    expect(renderReminderEmail({ ...base, reference: undefined }).text).not.toContain('Reference');
    expect(renderReminderEmail({ ...base, kind: 'H24' }).text).not.toContain('K7M2QX');
    expect(renderReminderEmail({ ...base, kind: 'H2' }).html).not.toContain('K7M2QX');
  });
});
