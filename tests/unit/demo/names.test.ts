import { isValidPhoneNumber } from 'libphonenumber-js';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../scripts/demo/rng';
import {
  BLOCKED_FULL_NAMES,
  FIRST_NAMES,
  SURNAMES,
  generateClientIdentities,
} from '../../../scripts/demo/names';

const BAD_WORDS = /lorem|ipsum|test|example|placeholder|dummy|foo|bar\b|john|jane|\d/i;

describe('demo client identities', () => {
  it('has large pools', () => {
    expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(SURNAMES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
    expect(new Set(SURNAMES).size).toBe(SURNAMES.length);
  });

  it('is deterministic for the same seed', () => {
    const a = generateClientIdentities(makeRng(5), 60, new Set());
    const b = generateClientIdentities(makeRng(5), 60, new Set());
    expect(a).toEqual(b);
    expect(generateClientIdentities(makeRng(6), 60, new Set())).not.toEqual(a);
  });

  it('gives valid, unique Lebanese mobile numbers and never an email', () => {
    const ids = generateClientIdentities(makeRng(1), 300, new Set());
    expect(ids).toHaveLength(300);
    expect(new Set(ids.map((i) => i.phone)).size).toBe(300);
    for (const i of ids) {
      expect(i.phone).toMatch(/^\+961\d{7,8}$/);
      expect(isValidPhoneNumber(i.phone, 'LB')).toBe(true);
      expect(Object.keys(i)).not.toContain('email');
    }
  });

  it('uses the mobile prefixes 03, 70, 71, 76, 78, 79 and 81', () => {
    const ids = generateClientIdentities(makeRng(2), 400, new Set());
    const prefixes = new Set(
      ids.map((i) => {
        const national = i.phone.slice(4);
        return national.startsWith('3') ? '03' : national.slice(0, 2);
      }),
    );
    expect([...prefixes].sort()).toEqual(['03', '70', '71', '76', '78', '79', '81']);
  });

  it('builds distinct first + last names within the length limit, with no filler or blocked names', () => {
    const ids = generateClientIdentities(makeRng(3), 400, new Set());
    expect(new Set(ids.map((i) => i.name.toLowerCase())).size).toBe(400);
    const blocked = new Set(BLOCKED_FULL_NAMES.map((n) => n.toLowerCase()));
    for (const i of ids) {
      expect(i.name.length).toBeLessThanOrEqual(80);
      expect(i.name.split(' ')).toHaveLength(2);
      expect(i.name).not.toMatch(BAD_WORDS);
      expect(blocked.has(i.name.toLowerCase())).toBe(false);
    }
  });

  it('never produces a blocklisted public figure, even when asked for nearly every combination', () => {
    expect(BLOCKED_FULL_NAMES).toContain('Elie Saab');
    const ids = generateClientIdentities(makeRng(4), 2000, new Set());
    const names = new Set(ids.map((i) => i.name));
    for (const b of BLOCKED_FULL_NAMES) expect(names.has(b)).toBe(false);
  });

  it('keeps phones unique across calls through the shared used set', () => {
    const used = new Set<string>();
    const a = generateClientIdentities(makeRng(1), 100, used);
    const b = generateClientIdentities(makeRng(1), 100, used);
    expect(new Set([...a, ...b].map((i) => i.phone)).size).toBe(200);
  });
});
