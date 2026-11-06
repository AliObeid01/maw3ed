import { describe, expect, it } from 'vitest';
import { DirectoryQuery } from '@/server/contracts/directory';
import {
  cleanCategoryParam,
  cleanSearchParam,
  DIRECTORY_CATEGORY_MAX,
  DIRECTORY_SEARCH_MAX,
} from '@/lib/directory/params';

const NUL = String.fromCharCode(0);

describe('directory URL parameters', () => {
  it('limits match the API schema', () => {
    const ok = DirectoryQuery.safeParse({
      search: 'a'.repeat(DIRECTORY_SEARCH_MAX),
      category: 'b'.repeat(DIRECTORY_CATEGORY_MAX),
    });
    expect(ok.success).toBe(true);
    expect(DirectoryQuery.safeParse({ search: 'a'.repeat(DIRECTORY_SEARCH_MAX + 1) }).success).toBe(false);
    expect(DirectoryQuery.safeParse({ category: 'b'.repeat(DIRECTORY_CATEGORY_MAX + 1) }).success).toBe(false);
  });

  it('a category over 40 characters is dropped, a normal one is kept', () => {
    expect(cleanCategoryParam('x'.repeat(41))).toBe('');
    expect(cleanCategoryParam('x'.repeat(40))).toBe('x'.repeat(40));
    expect(cleanCategoryParam('  hair-salons ')).toBe('hair-salons');
    expect(cleanCategoryParam(null)).toBe('');
  });

  it('a search over 80 characters is cut to the limit and still validates', () => {
    const cut = cleanSearchParam('s'.repeat(300));
    expect(cut).toHaveLength(DIRECTORY_SEARCH_MAX);
    expect(DirectoryQuery.safeParse({ search: cut }).success).toBe(true);
  });

  it('does not cut an emoji in half', () => {
    const cut = cleanSearchParam('a'.repeat(DIRECTORY_SEARCH_MAX - 1) + '😀😀');
    expect(cut).toBe('a'.repeat(DIRECTORY_SEARCH_MAX - 1));
  });

  it('NUL and other control characters are removed, so the API never gets a 400 for them', () => {
    expect(cleanSearchParam(`sal${NUL}on`)).toBe('salon');
    expect(cleanCategoryParam(`bar${NUL}bers\u0007`)).toBe('barbers');
    expect(cleanCategoryParam(NUL)).toBe('');
    for (const v of [`a${NUL}b`, 'x'.repeat(500)]) {
      expect(
        DirectoryQuery.safeParse({
          search: cleanSearchParam(v) || undefined,
          category: cleanCategoryParam(v) || undefined,
        }).success,
      ).toBe(true);
    }
  });
});
