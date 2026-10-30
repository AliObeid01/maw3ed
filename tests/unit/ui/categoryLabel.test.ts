import { describe, expect, it } from 'vitest';
import { categoryKey, categoryKeys, categoryText } from '@/components/public/categoryLabel';

const known = new Set(['salon', 'barber', 'barbershop', 'clinic']);
const has = (key: string) => known.has(key);
const label = (key: string) => `label:${key}`;

describe('categoryKeys', () => {
  it('tries the whole text first, then each word', () => {
    expect(categoryKeys('Hair Salon')).toEqual(['hairsalon', 'hair', 'salon']);
    expect(categoryKeys('Barber Shop')).toEqual(['barbershop', 'barber', 'shop']);
  });

  it('trims, lowercases and drops duplicates', () => {
    expect(categoryKeys('salon ')).toEqual(['salon']);
    expect(categoryKeys('  CLINIC')).toEqual(['clinic']);
  });

  it('gives nothing for empty or non-Latin text', () => {
    expect(categoryKeys(null)).toEqual([]);
    expect(categoryKeys('   ')).toEqual([]);
    expect(categoryKeys('صالون')).toEqual([]);
  });
});

describe('categoryKey and categoryText', () => {
  it('finds a known key from one word of free text', () => {
    expect(categoryKey('Hair Salon', has)).toBe('salon');
    expect(categoryKey('Barber Shop', has)).toBe('barbershop');
    expect(categoryKey('salon ', has)).toBe('salon');
  });

  it('translates when a key matches', () => {
    expect(categoryText('Hair Salon', has, label)).toBe('label:salon');
    expect(categoryText('Barber Shop', has, label)).toBe('label:barbershop');
  });

  it('shows an unknown category as typed (trimmed)', () => {
    expect(categoryText('  Tattoo Studio ', has, label)).toBe('Tattoo Studio');
    expect(categoryText('صالون', has, label)).toBe('صالون');
  });

  it('is null for nothing', () => {
    expect(categoryText(undefined, has, label)).toBeNull();
    expect(categoryText('  ', has, label)).toBeNull();
  });
});
