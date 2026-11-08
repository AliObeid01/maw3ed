import { describe, expect, it } from 'vitest';
import { HOME_CATEGORIES, nextFreeTile, priceLine, resolveSelected } from '@/lib/home/categories';

const entry = (category: string, places: number, fromPrice: number | null = null) => ({
  category,
  places,
  fromPrice,
  nextFree: null,
  popularServices: [],
});

describe('HOME_CATEGORIES', () => {
  it('lists the six categories, never other', () => {
    expect(HOME_CATEGORIES).toEqual([
      'barbers',
      'hair-salons',
      'dental-clinics',
      'beauty-clinics',
      'spa-massage',
      'physiotherapy',
    ]);
  });
});

describe('resolveSelected', () => {
  const list = [entry('barbers', 3), entry('other', 9), entry('physiotherapy', 2)];
  it('keeps a known selection', () => expect(resolveSelected(list, 'physiotherapy')).toBe('physiotherapy'));
  it('falls back to the first home category when the key is unknown or "other"', () => {
    expect(resolveSelected(list, 'other')).toBe('barbers');
    expect(resolveSelected(list, 'nope')).toBe('barbers');
    expect(resolveSelected(list, undefined)).toBe('barbers');
  });
  it('defaults to the first home category with no data', () => expect(resolveSelected([], null)).toBe('barbers'));
});

describe('nextFreeTile', () => {
  it('is null (tile hidden) without a next free time, never "no availability"', () => {
    expect(nextFreeTile(null)).toBeNull();
  });
  it('formats in the business zone', () => {
    const next = {
      startAt: '2026-11-05T08:30:00.000Z',
      service: { id: 'x', name: 'Cut', durationMin: 30 },
      business: { slug: 's', name: 'S', timezone: 'Asia/Beirut' },
    };
    expect(nextFreeTile(next)).toBe('10:30');
  });
});

describe('priceLine', () => {
  it('is null when no price', () => expect(priceLine(null)).toBeNull());
  it('formats whole and fractional USD', () => {
    expect(priceLine(8)).toBe('8 USD');
    expect(priceLine(12.5)).toBe('12.50 USD');
  });
});
