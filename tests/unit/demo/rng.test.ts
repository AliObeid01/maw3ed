import { describe, expect, it } from 'vitest';
import { makeRng, makeIdFactory, seedFrom } from '../../../scripts/demo/rng';

describe('demo rng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });
  it('differs between seeds and stays in [0,1)', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('int is inclusive and pick/shuffle keep the elements', () => {
    const r = makeRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
  });
  it('seedFrom mixes strings stably', () => {
    expect(seedFrom(10, 'a')).toBe(seedFrom(10, 'a'));
    expect(seedFrom(10, 'a')).not.toBe(seedFrom(10, 'b'));
  });
  it('ids look like cuids, are unique and repeatable', () => {
    const f = makeIdFactory(makeRng(9));
    const ids = Array.from({ length: 500 }, () => f());
    expect(new Set(ids).size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^c[a-z0-9]{24}$/);
    const g = makeIdFactory(makeRng(9));
    expect(g()).toBe(ids[0]);
  });
});
