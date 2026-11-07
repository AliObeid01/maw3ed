import { describe, expect, it } from 'vitest';
import { buildDirectoryUrl, categoryServiceUrl, POPULAR_SEARCHES } from '@/lib/home/search';

describe('buildDirectoryUrl', () => {
  it('goes to the directory with search and area', () => {
    expect(buildDirectoryUrl({ search: 'haircut', area: 'sidon' })).toBe('/directory?search=haircut&area=sidon');
  });
  it('trims and omits empty values', () => {
    expect(buildDirectoryUrl({ search: '  ', area: '' })).toBe('/directory');
    expect(buildDirectoryUrl({ search: ' massage ', area: '' })).toBe('/directory?search=massage');
    expect(buildDirectoryUrl({ search: '', area: 'tyre' })).toBe('/directory?area=tyre');
  });
  it('drops an unknown area and encodes text', () => {
    expect(buildDirectoryUrl({ search: 'a&b c', area: 'mars' })).toBe('/directory?search=a%26b+c');
  });
  it('strips control characters and cuts to the API limit', () => {
    expect(buildDirectoryUrl({ search: 'a\u0000b' })).toBe('/directory?search=ab');
    const long = 'x'.repeat(200);
    expect(buildDirectoryUrl({ search: long })).toBe(`/directory?search=${'x'.repeat(80)}`);
  });
});

describe('categoryServiceUrl', () => {
  it('puts category before search', () => {
    expect(categoryServiceUrl('barbers', 'Beard trim')).toBe('/directory?category=barbers&search=Beard+trim');
    expect(categoryServiceUrl('barbers')).toBe('/directory?category=barbers');
  });
});

describe('POPULAR_SEARCHES', () => {
  it('has the four chips of the design', () => {
    expect(POPULAR_SEARCHES).toEqual(['haircut', 'dental', 'massage', 'hydrafacial']);
  });
});
