import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_ALPHABET,
  REFERENCE_LENGTH,
  generateReference,
  isReference,
} from '@/server/domain/reference';

describe('booking reference', () => {
  it('uses a 31-character alphabet without O, 0, I, 1 or L', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(31);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(31);
    for (const bad of 'O0I1L') expect(REFERENCE_ALPHABET).not.toContain(bad);
    expect(REFERENCE_ALPHABET).toBe(REFERENCE_ALPHABET.toUpperCase());
  });

  it('generates 6 characters from the alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const ref = generateReference(randomInt);
      expect(ref).toHaveLength(REFERENCE_LENGTH);
      expect(isReference(ref)).toBe(true);
      expect(ref).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    }
  });

  it('draws each character with randomInt(alphabet length), deterministically from the injected source', () => {
    const seen: number[] = [];
    const ref = generateReference((max) => {
      seen.push(max);
      return seen.length - 1;
    });
    expect(seen).toEqual(Array(6).fill(31));
    expect(ref).toBe(REFERENCE_ALPHABET.slice(0, 6));
  });

  it('is roughly uniform and rarely repeats (distribution sanity)', () => {
    const counts = new Map<string, number>();
    const refs = new Set<string>();
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const ref = generateReference(randomInt);
      refs.add(ref);
      for (const ch of ref) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(31);
    const expected = (n * 6) / 31;
    for (const c of counts.values()) expect(Math.abs(c - expected) / expected).toBeLessThan(0.1);
    // 31^6 is about 887 million codes, so 20k draws almost never collide.
    expect(refs.size).toBeGreaterThan(n - 10);
  });

  it('isReference rejects wrong length, lowercase and ambiguous characters', () => {
    for (const bad of ['', 'ABC23', 'ABC2345', 'abc234', 'ABC23O', 'ABC231', 'ABC23L', 'ABC 23'])
      expect(isReference(bad)).toBe(false);
    expect(isReference('ABC234')).toBe(true);
  });
});
