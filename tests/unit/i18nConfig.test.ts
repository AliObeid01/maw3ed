import { describe, expect, it } from 'vitest';
import { defaultLocale, dirFor, isLocale, locales } from '@/i18n/config';

describe('isLocale', () => {
  it('accepts exactly the supported locales', () => {
    for (const l of locales) expect(isLocale(l)).toBe(true);
    expect(locales).toEqual(['en', 'ar']);
  });

  it('rejects everything else, including case variants and region tags', () => {
    for (const v of [undefined, '', 'fr', 'EN', 'Ar', 'en-US', 'ar-LB', ' en'])
      expect(isLocale(v)).toBe(false);
  });
});

describe('dirFor', () => {
  it('is rtl only for Arabic', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });

  it('the default locale is left to right', () => {
    expect(dirFor(defaultLocale)).toBe('ltr');
  });
});
