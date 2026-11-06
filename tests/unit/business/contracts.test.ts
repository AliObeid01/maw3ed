import { describe, expect, it } from 'vitest';
import { DirectoryQuery } from '@/server/contracts/directory';
import { UpdateBusinessBody } from '@/server/contracts/setup';

describe('UpdateBusinessBody: category, area, address (PR-1)', () => {
  it('accepts listed keys, null and a trimmed address', () => {
    const parsed = UpdateBusinessBody.parse({
      category: 'hair-salons',
      area: 'sidon',
      address: '  Riad El Solh St  ',
    });
    expect(parsed).toEqual({ category: 'hair-salons', area: 'sidon', address: 'Riad El Solh St' });
    expect(UpdateBusinessBody.parse({ category: null, area: null, address: null })).toEqual({
      category: null,
      area: null,
      address: null,
    });
    expect(UpdateBusinessBody.parse({ address: '   ' })).toEqual({ address: null });
  });

  it.each([
    ['free-text category', { category: 'Salon' }],
    ['upper-case key', { category: 'Barbers' }],
    ['unknown area', { area: 'atlantis' }],
    ['upper-case area', { area: 'Sidon' }],
    ['empty area', { area: '' }],
    ['address over 120', { address: 'x'.repeat(121) }],
    ['address with NUL', { address: 'a\u0000b' }],
    ['unknown key', { region: 'sidon' }],
  ])('rejects %s', (_name, body) => {
    expect(UpdateBusinessBody.safeParse(body).success).toBe(false);
  });
});

describe('DirectoryQuery: area (PR-1)', () => {
  it('accepts a listed key and treats an empty string as unset', () => {
    expect(DirectoryQuery.parse({ area: 'tyre' }).area).toBe('tyre');
    expect(DirectoryQuery.parse({ area: '' }).area).toBeUndefined();
    expect(DirectoryQuery.parse({}).area).toBeUndefined();
  });

  it('rejects an unknown, mis-cased or NUL area', () => {
    for (const area of ['atlantis', 'Tyre', 'tyre\u0000'])
      expect(DirectoryQuery.safeParse({ area }).success, area).toBe(false);
  });

  it('keeps category as free text so legacy values still filter', () => {
    expect(DirectoryQuery.parse({ category: 'Salon' }).category).toBe('Salon');
  });
});
