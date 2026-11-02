import { describe, expect, it } from 'vitest';
import { effectiveEmail, normaliseContactEmail } from '@/server/domain/contactEmail';

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
