import { describe, expect, it } from 'vitest';
import { monogram } from '@/components/public/monogram';

describe('monogram', () => {
  it('returns an empty string for empty or whitespace input', () => {
    expect(monogram('')).toBe('');
    expect(monogram('   ')).toBe('');
  });

  it('uses the first two letters of a single word', () => {
    expect(monogram('nour')).toBe('NO');
    expect(monogram('X')).toBe('X');
  });

  it('uses the first letter of the first two words', () => {
    expect(monogram('Studio Nour')).toBe('SN');
    expect(monogram('  Studio   Nour   Beirut ')).toBe('SN');
  });

  it('handles Arabic names', () => {
    expect(monogram('ستوديو نور')).toBe('سن');
    expect(monogram('نور')).toBe('نو');
  });

  it('never splits an emoji or a ZWJ sequence', () => {
    const family = '👨‍👩‍👧';
    expect(monogram(family)).toBe(family);
    expect(monogram(`${family} Salon`)).toBe(`${family}S`);
    expect(monogram('🇱🇧')).toBe('🇱🇧');
    expect(() => monogram('💇‍♀️💇‍♀️💇‍♀️')).not.toThrow();
    expect(monogram('💇‍♀️💇‍♀️💇‍♀️')).toBe('💇‍♀️💇‍♀️');
  });

  it('keeps combining marks with their base letter', () => {
    expect(monogram('école')).toBe('ÉC');
  });
});
