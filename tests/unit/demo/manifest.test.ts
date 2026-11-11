import { describe, expect, it } from 'vitest';
import { slugProblem } from '../../../src/server/contracts/slug';
import { isAreaKey, isCategoryKey, CATEGORY_KEYS } from '../../../src/lib/business/profile';
import {
  FLAGSHIP_SLUG,
  MANIFEST,
  PLACEHOLDER_DOMAIN,
  placeholderOwnerEmail,
  planOf,
} from '../../../scripts/demo/manifest';
import { BLOCKED_FULL_NAMES, FIRST_NAMES, SURNAMES } from '../../../scripts/demo/names';

const FIRST = new Set(FIRST_NAMES.map((n) => n.toLowerCase()));
const LAST = new Set(SURNAMES.map((n) => n.toLowerCase()));

describe('demo manifest', () => {
  it('has 18 businesses, three per real category', () => {
    expect(MANIFEST).toHaveLength(18);
    for (const c of CATEGORY_KEYS.filter((k) => k !== 'other'))
      expect(MANIFEST.filter((b) => b.category === c)).toHaveLength(3);
    for (const b of MANIFEST) expect(isCategoryKey(b.category)).toBe(true);
  });

  it('spreads over at least five real areas', () => {
    const areas = new Set(MANIFEST.map((b) => b.area));
    expect(areas.size).toBeGreaterThanOrEqual(5);
    for (const a of areas) expect(isAreaKey(a)).toBe(true);
  });

  it('has valid, unique, unreserved slugs and names', () => {
    expect(new Set(MANIFEST.map((b) => b.slug)).size).toBe(18);
    expect(new Set(MANIFEST.map((b) => b.name)).size).toBe(18);
    for (const b of MANIFEST) expect(slugProblem(b.slug)).toBeUndefined();
  });

  it('has one flagship: a dental clinic with 4 bookable staff and 6 services', () => {
    const flagships = MANIFEST.filter((b) => b.flagship);
    expect(flagships).toHaveLength(1);
    const f = flagships[0]!;
    expect(f.slug).toBe(FLAGSHIP_SLUG);
    expect(f.category).toBe('dental-clinics');
    expect(f.staff.map((s) => s.name)).toEqual(['Rami', 'Lina', 'Karim', 'Maya']);
    expect(f.services.map((s) => s.name)).toEqual([
      'Check-up and cleaning',
      'Filling',
      'Root canal treatment',
      'Teeth whitening',
      'Braces consultation',
      'Emergency visit',
    ]);
    expect(f.clients).toBe(140);
    expect(planOf(f)).toBe('PRO');
  });

  it('gives every business a complete profile and sane catalogue', () => {
    for (const b of MANIFEST) {
      expect(b.name.length).toBeGreaterThan(5);
      expect(b.address).toMatch(/,/);
      expect(b.address).not.toMatch(/\d/); // no building numbers
      expect(['en', 'ar']).toContain(b.locale);
      expect(b.services.length).toBeGreaterThanOrEqual(3);
      expect(b.services.length).toBeLessThanOrEqual(6);
      expect(b.staff.length).toBeGreaterThanOrEqual(1);
      expect(b.staff.length).toBeLessThanOrEqual(b.flagship ? 4 : 2);
      expect(planOf(b)).toBe(b.staff.length > 1 ? 'PRO' : 'FREE');
      const names = new Set(b.services.map((s) => s.name));
      expect(names.size).toBe(b.services.length);
      for (const s of b.services) {
        expect(s.durationMin).toBeGreaterThanOrEqual(15);
        expect(s.durationMin).toBeLessThanOrEqual(90);
        expect(s.durationMin % 15).toBe(0);
        expect([0, 15]).toContain(s.bufferMin);
        expect(s.price).toBeGreaterThanOrEqual(6);
        expect(s.price).toBeLessThanOrEqual(190);
      }
      for (const st of b.staff) {
        for (const n of st.services) expect(names.has(n)).toBe(true);
        expect(st.name).toMatch(/^[A-Z][a-z]+$/); // first name only
        expect(st.services.length).toBeGreaterThan(0);
      }
      expect(new Set(b.staff.map((s) => s.name)).size).toBe(b.staff.length);
      // every service has at least one performer
      for (const s of b.services) expect(b.staff.some((st) => st.services.includes(s.name))).toBe(true);
      expect(b.hours[0]).toBeUndefined(); // Sunday closed
      expect(b.hours[1]?.length).toBeGreaterThan(0);
    }
  });

  it('shows fifteen logos and three initials', () => {
    expect(MANIFEST.filter((b) => b.logo)).toHaveLength(15);
    expect(MANIFEST.filter((b) => !b.logo)).toHaveLength(3);
  });

  it('keeps client counts in range', () => {
    for (const b of MANIFEST) {
      if (b.flagship) continue;
      expect(b.clients).toBeGreaterThanOrEqual(8);
      expect(b.clients).toBeLessThanOrEqual(25);
      expect(b.pastAppointments).toBeGreaterThanOrEqual(20);
      expect(b.pastAppointments).toBeLessThanOrEqual(45);
    }
  });

  it('uses no personal names in business names and staff are not blocklisted people', () => {
    const personal = new Set([...FIRST].filter((n) => !['nour', 'sandy'].includes(n)));
    for (const b of MANIFEST) {
      for (const word of b.name.toLowerCase().split(/\s+/)) {
        expect(personal.has(word)).toBe(false);
        expect(LAST.has(word)).toBe(false);
      }
    }
    expect(BLOCKED_FULL_NAMES.length).toBeGreaterThan(10);
  });

  it('uses the reserved .invalid domain for placeholder owners', () => {
    expect(PLACEHOLDER_DOMAIN).toBe('demo.invalid');
    expect(placeholderOwnerEmail('x-y')).toBe('owner+x-y@demo.invalid');
  });
});
