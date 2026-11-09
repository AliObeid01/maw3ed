import { describe, expect, it } from 'vitest';
import { defaultAssistantDeps, guardProjectedLoad, PROJECTED_DAY_LIMIT } from '@/server/services/assistant';

// PR-15b guard edge fix: the H24 email is due at start-24h and the H2 email at start-2h. For a start between
// 00:00 and 02:00 UTC both land on the SAME (previous) UTC day, which therefore needs +2, not +1.
const NOW = new Date('2026-11-02T08:00:00Z');
const deps = (load: Record<string, number>) => ({
  ...defaultAssistantDeps,
  now: () => NOW,
  emailLoadOnDay: async (d: Date) => load[d.toISOString().slice(0, 10)] ?? 0,
});
const refused = (load: Record<string, number>, start: string) =>
  guardProjectedLoad(deps(load), new Date(start)).then(
    () => false,
    (e: { code?: string }) => {
      expect(e.code).toBe('CHAT_BOOKING_UNAVAILABLE');
      return true;
    },
  );

describe('guardProjectedLoad day arithmetic', () => {
  it('limit is 70', () => expect(PROJECTED_DAY_LIMIT).toBe(70));

  it('start 01:00Z: H24 and H2 both fall on the previous day, so 68 refuses (68+2) and 67 allows', async () => {
    expect(await refused({ '2026-11-03': 68 }, '2026-11-04T01:00:00Z')).toBe(true);
    expect(await refused({ '2026-11-03': 67 }, '2026-11-04T01:00:00Z')).toBe(false);
    // the start day itself carries no email of this booking
    expect(await refused({ '2026-11-04': 99 }, '2026-11-04T01:00:00Z')).toBe(false);
  });

  it('start 12:00Z: two different days, +1 each (69 refuses, 68 allows)', async () => {
    expect(await refused({ '2026-11-03': 69 }, '2026-11-04T12:00:00Z')).toBe(true);
    expect(await refused({ '2026-11-04': 69 }, '2026-11-04T12:00:00Z')).toBe(true);
    expect(await refused({ '2026-11-03': 68, '2026-11-04': 68 }, '2026-11-04T12:00:00Z')).toBe(false);
  });

  it('start 23:30Z: H24 on the previous day, H2 (21:30) on the start day, +1 each', async () => {
    expect(await refused({ '2026-11-03': 69 }, '2026-11-04T23:30:00Z')).toBe(true);
    expect(await refused({ '2026-11-04': 69 }, '2026-11-04T23:30:00Z')).toBe(true);
    expect(await refused({ '2026-11-03': 68, '2026-11-04': 68 }, '2026-11-04T23:30:00Z')).toBe(false);
  });

  it('start 02:00Z exactly: H2 is 00:00 of the start day, a different day from H24', async () => {
    expect(await refused({ '2026-11-03': 68 }, '2026-11-04T02:00:00Z')).toBe(false);
    expect(await refused({ '2026-11-04': 69 }, '2026-11-04T02:00:00Z')).toBe(true);
  });
});
