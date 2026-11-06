import { describe, expect, it } from 'vitest';
import {
  AREA_KEYS,
  CATEGORY_KEYS,
  categoryMessageKey,
  isAreaKey,
  isCategoryKey,
  legacyCategory,
  profileMissing,
} from '@/lib/business/profile';

describe('fixed lists', () => {
  it('has the agreed category and area keys, "other" last', () => {
    expect(CATEGORY_KEYS).toEqual([
      'barbers',
      'hair-salons',
      'dental-clinics',
      'beauty-clinics',
      'spa-massage',
      'physiotherapy',
      'other',
    ]);
    expect(AREA_KEYS).toEqual(['sidon', 'beirut', 'tripoli', 'jounieh', 'tyre', 'zahle', 'other']);
  });

  it('recognises only exact keys', () => {
    expect(isCategoryKey('hair-salons')).toBe(true);
    expect(isCategoryKey('Hair Salons')).toBe(false);
    expect(isCategoryKey('salon')).toBe(false);
    expect(isCategoryKey(null)).toBe(false);
    expect(isAreaKey('sidon')).toBe(true);
    expect(isAreaKey('Sidon')).toBe(false);
    expect(isAreaKey('')).toBe(false);
  });
});

describe('categoryMessageKey', () => {
  it('drops the hyphen so the key matches the public.category message keys', () => {
    expect(categoryMessageKey('hair-salons')).toBe('hairsalons');
    expect(categoryMessageKey('spa-massage')).toBe('spamassage');
    expect(categoryMessageKey('barbers')).toBe('barbers');
  });
});

describe('legacyCategory', () => {
  it('returns the stored free text when it is not a listed key', () => {
    expect(legacyCategory('Hair Salon')).toBe('Hair Salon');
    expect(legacyCategory('  Clinic ')).toBe('Clinic');
  });
  it('is null for keys, empty and missing values', () => {
    expect(legacyCategory('barbers')).toBeNull();
    expect(legacyCategory('')).toBeNull();
    expect(legacyCategory(null)).toBeNull();
    expect(legacyCategory(undefined)).toBeNull();
  });
});

describe('profileMissing', () => {
  it('lists the fields a listing needs and does not count a legacy category as missing', () => {
    expect(profileMissing({ category: null, area: null })).toEqual(['category', 'area']);
    expect(profileMissing({ category: 'barbers', area: null })).toEqual(['area']);
    expect(profileMissing({ category: 'Salon', area: 'sidon' })).toEqual([]);
    expect(profileMissing({ category: '  ', area: 'beirut' })).toEqual(['category']);
  });
});
