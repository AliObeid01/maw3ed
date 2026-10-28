import { describe, expect, it } from 'vitest';
import { isValidSlugFormat, normalizeSlugInput, previewHost, suggestSlug } from '@/lib/auth/slug';

describe('suggestSlug', () => {
  it('lowercases and hyphenates words', () => {
    expect(suggestSlug('Studio Nour')).toBe('studio-nour');
  });

  it('strips accents instead of dropping the letter', () => {
    expect(suggestSlug('Café Léa')).toBe('cafe-lea');
  });

  it('collapses punctuation and trims hyphens at both ends', () => {
    expect(suggestSlug("  --Nour's  Salon & Spa!! ")).toBe('nour-s-salon-spa');
  });

  it('returns an empty string when there are no Latin letters or digits', () => {
    expect(suggestSlug('استوديو نور')).toBe('');
  });

  it('caps the length and never ends on a hyphen', () => {
    const slug = suggestSlug(`${'a'.repeat(39)} bbbb`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('normalizeSlugInput', () => {
  it('turns spaces into hyphens, lowercases and drops other characters', () => {
    expect(normalizeSlugInput('My Salon_2!')).toBe('my-salon2');
  });
});

describe('isValidSlugFormat', () => {
  it.each(['studio-nour', 'abc', 'a1-b2'])('accepts %s', (s) => {
    expect(isValidSlugFormat(s)).toBe(true);
  });
  it.each(['ab', '-abc', 'abc-', 'a--b', 'ABC', 'a b c', 'x'.repeat(41), ''])('rejects %j', (s) => {
    expect(isValidSlugFormat(s)).toBe(false);
  });
});

describe('previewHost', () => {
  it('prefers the configured app URL', () => {
    expect(previewHost('https://maw3ed.app/', 'localhost:3000')).toBe('maw3ed.app');
  });
  it('falls back to the page host, then to the brand host', () => {
    expect(previewHost(undefined, 'localhost:3000')).toBe('localhost:3000');
    expect(previewHost('not a url', 'localhost:3000')).toBe('localhost:3000');
    expect(previewHost(undefined)).toBe('maw3ed.app');
  });
});
