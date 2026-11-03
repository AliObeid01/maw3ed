import { describe, expect, it } from 'vitest';
import { firstNameOf, maskPhone } from '@/server/domain/waitlistPrivacy';

describe('maskPhone', () => {
  it('shows only the last 3 digits of an E.164 number, in a fixed shape', () => {
    expect(maskPhone('+96171123456')).toBe('•••• ••• 456');
    expect(maskPhone('+14155552671')).toBe('•••• ••• 671');
  });

  it('has the same shape whatever the length, so the length is not revealed', () => {
    expect(maskPhone('+4915112345678')).toBe('•••• ••• 678');
    expect(maskPhone('+9617112345')).toBe('•••• ••• 345');
  });

  it('never leaks the full number', () => {
    const out = maskPhone('+96171123456');
    expect(out).not.toContain('96171');
    expect(out).not.toContain('+');
    expect(out.match(/\d/g)).toHaveLength(3);
  });

  it('shows no digit at all for a number too short to hide anything', () => {
    expect(maskPhone('+12345')).toBe('•••• ••• •••');
    expect(maskPhone('')).toBe('•••• ••• •••');
    expect(maskPhone('abc')).toBe('•••• ••• •••');
  });

  it('reads Arabic-Indic digits as digits, and the output uses Latin digits only', () => {
    expect(maskPhone('+٩٦١٧١١٢٣٤٥٦')).toBe('•••• ••• 456');
  });

  it('ignores spaces and separators', () => {
    expect(maskPhone('+961 71 123 456')).toBe('•••• ••• 456');
  });
});

describe('firstNameOf', () => {
  it('takes the first word', () => {
    expect(firstNameOf('Rami Haddad')).toBe('Rami');
    expect(firstNameOf('  Lina   Nour  ')).toBe('Lina');
  });
  it('keeps a single name and Arabic names whole', () => {
    expect(firstNameOf('Rami')).toBe('Rami');
    expect(firstNameOf('ليلى حداد')).toBe('ليلى');
  });
  it('returns an empty string for an empty name', () => {
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf('   ')).toBe('');
  });
});
