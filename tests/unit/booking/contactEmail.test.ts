import { describe, expect, it } from 'vitest';
import { effectiveEmail, greetingName, mailGreetingName, normaliseContactEmail } from '@/server/domain/contactEmail';
import { renderReminderEmail } from '@/server/i18n/emailRender';
import { renderOfferEmail } from '@/server/i18n/offerEmail';

describe('effectiveEmail (F16): the appointment address wins, the client record is the fallback', () => {
  it('uses the appointment contact email when set', () => {
    expect(effectiveEmail('new@x.test', 'old@x.test')).toBe('new@x.test');
  });
  it('falls back to the client email when the appointment has none (pre-F16 rows)', () => {
    expect(effectiveEmail(null, 'old@x.test')).toBe('old@x.test');
    expect(effectiveEmail(undefined, 'old@x.test')).toBe('old@x.test');
    expect(effectiveEmail('   ', 'old@x.test')).toBe('old@x.test');
  });
  it('is null when neither has an address', () => {
    expect(effectiveEmail(null, null)).toBeNull();
    expect(effectiveEmail('', ' ')).toBeNull();
    expect(effectiveEmail(undefined, undefined)).toBeNull();
  });
});

describe('normaliseContactEmail', () => {
  it('trims and lowercases, empty becomes undefined', () => {
    expect(normaliseContactEmail('  Rana.New@Gmail.COM ')).toBe('rana.new@gmail.com');
    expect(normaliseContactEmail('')).toBeUndefined();
    expect(normaliseContactEmail('   ')).toBeUndefined();
    expect(normaliseContactEmail(undefined)).toBeUndefined();
    expect(normaliseContactEmail(null)).toBeUndefined();
  });
});

describe('effectiveEmail (F16 review): a malformed stored value is no address', () => {
  it.each([
    'nope',
    'a@@b.test',
    'a@b@c.test',
    'a b@x.test',
    'a@b.test\nBcc: x@y.test',
    '@',
    `${'x'.repeat(260)}@x.test`,
  ])('rejects %j', (bad) => {
    expect(effectiveEmail(bad, 'rec@x.test')).toBeNull();
  });
  it('accepts a normal address and trims', () => {
    expect(effectiveEmail(' a@b.test ', null)).toBe('a@b.test');
  });
});

describe('greetingName: the record name only reaches the record email', () => {
  it('returns the name when the recipient IS the record email (case-insensitive)', () => {
    expect(greetingName('RANA@x.test', 'rana@x.test', 'Rana')).toBe('Rana');
    expect(greetingName('rana@x.test', ' rana@x.test ', 'Rana')).toBe('Rana');
  });
  it('is null for a different recipient, a record without email, or no recipient', () => {
    expect(greetingName('evil@x.test', 'rana@x.test', 'Rana')).toBeNull();
    expect(greetingName('evil@x.test', null, 'Rana')).toBeNull();
    expect(greetingName(null, 'rana@x.test', 'Rana')).toBeNull();
  });
});

describe('mailGreetingName: the typed name wins, the record name needs the record email', () => {
  const rec = { recordEmail: 'rana@x.test', recordName: 'Rana' };
  it('uses the name typed for the booking', () => {
    expect(mailGreetingName({ contactName: ' Mallory ', recipient: 'evil@x.test', ...rec })).toBe('Mallory');
  });
  it('falls back to the record name only for the record email', () => {
    expect(mailGreetingName({ contactName: null, recipient: 'rana@x.test', ...rec })).toBe('Rana');
    expect(mailGreetingName({ contactName: '  ', recipient: 'evil@x.test', ...rec })).toBeNull();
  });
});

describe('emails with no name use a generic greeting', () => {
  const base = {
    kind: 'BOOKING' as const,
    timezone: 'Asia/Beirut',
    businessName: 'Studio',
    serviceName: 'Cut',
    staffName: 'Sami',
    startAt: new Date('2026-11-10T08:00:00Z'),
    confirmUrl: 'http://x/l/a',
    cancelUrl: 'http://x/l/b',
  };
  it.each([
    ['en', 'Hello,'],
    ['ar', 'مرحبا،'],
  ])('reminder (%s)', (locale, hello) => {
    const r = renderReminderEmail({ ...base, locale, clientName: null });
    expect(r.text.startsWith(hello)).toBe(true);
    expect(r.html).toContain(hello);
  });
  it.each([
    ['en', 'Hello,'],
    ['ar', 'مرحبا،'],
  ])('offer (%s)', (locale, hello) => {
    const r = renderOfferEmail({
      ...base,
      locale,
      clientName: null,
      expiresAt: new Date('2026-11-09T08:00:00Z'),
      claimUrl: 'http://x/o/a',
      leaveUrl: 'http://x/o/b',
    });
    expect(r.text.startsWith(hello)).toBe(true);
    expect(r.html).toContain(hello);
  });
  it('with a name it still greets by name', () => {
    expect(renderReminderEmail({ ...base, locale: 'en', clientName: 'Rana' }).text).toMatch(/^Hi Rana,/);
  });
});
