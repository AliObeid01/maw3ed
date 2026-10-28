import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, slugProblem } from '@/server/contracts/slug';
import {
  isReservedSlug,
  isValidSlugFormat,
  normalizeSlugInput,
  suggestSlug,
} from '@/lib/auth/slug';

const alphabet = 'ab1-';

function* candidates(): Generator<string> {
  yield* [
    'abc',
    'a-b',
    'studio-nour',
    'a1b2',
    'x'.repeat(40),
    'x'.repeat(41),
    'ab',
    '-ab',
    'ab-',
    'a--b',
  ];
  // every string up to length 5 over a small alphabet, plus names run through the suggester
  const walk = function* (prefix: string, depth: number): Generator<string> {
    if (prefix) yield prefix;
    if (depth === 0) return;
    for (const c of alphabet) yield* walk(prefix + c, depth - 1);
  };
  yield* walk('', 5);
  for (const name of ['Café Léa', 'Studio Nour', "Nour's Salon & Spa", 'A', 'مرحبا', '  --x--  ']) {
    yield suggestSlug(name);
    yield normalizeSlugInput(name);
  }
}

describe('client slug rules never accept what the server rejects', () => {
  it('every client-valid, non-reserved slug passes the server slugProblem', () => {
    let checked = 0;
    for (const slug of candidates()) {
      if (isValidSlugFormat(slug) && !isReservedSlug(slug)) {
        expect(slugProblem(slug), slug).toBeUndefined();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('a client-valid slug that the client calls reserved is reserved for the server too', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(isReservedSlug(slug)).toBe(true);
      if (isValidSlugFormat(slug)) expect(slugProblem(slug)).toBe('reserved');
    }
  });

  it('mirrors the server reserved list exactly (drift fails here)', () => {
    expect([...RESERVED_SLUGS].every(isReservedSlug)).toBe(true);
    expect(isReservedSlug('studio-nour')).toBe(false);
  });
});
