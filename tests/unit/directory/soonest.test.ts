import { describe, expect, it } from 'vitest';
import { rankSoonest, spreadByCategory, type SoonestItem } from '@/server/domain/soonest';

const item = (id: string, name: string, category: string | null, iso: string): SoonestItem => ({
  id,
  name,
  category,
  startAt: new Date(iso),
});
const ids = (xs: SoonestItem[]) => xs.map((x) => x.id);

describe('rankSoonest', () => {
  it('orders by start instant ascending, then name, then id, and does not mutate the input', () => {
    const input = [
      item('3', 'Zed', 'barbers', '2026-11-02T09:00:00Z'),
      item('2', 'Alpha', 'barbers', '2026-11-02T09:00:00Z'),
      item('1', 'Alpha', 'barbers', '2026-11-02T09:00:00Z'),
      item('4', 'Beta', 'spa-massage', '2026-11-02T08:30:00Z'),
    ];
    const copy = [...input];
    expect(ids(rankSoonest(input))).toEqual(['4', '1', '2', '3']);
    expect(input).toEqual(copy);
  });

  it('is deterministic whatever the input order', () => {
    const a = item('a', 'Same', 'x', '2026-11-02T09:00:00Z');
    const b = item('b', 'Same', 'x', '2026-11-02T09:00:00Z');
    expect(ids(rankSoonest([a, b]))).toEqual(ids(rankSoonest([b, a])));
  });
});

describe('spreadByCategory', () => {
  const ranked = rankSoonest([
    item('b1', 'B1', 'barbers', '2026-11-02T09:00:00Z'),
    item('b2', 'B2', 'barbers', '2026-11-02T09:30:00Z'),
    item('b3', 'B3', 'barbers', '2026-11-02T10:00:00Z'),
    item('s1', 'S1', 'spa-massage', '2026-11-02T09:15:00Z'),
    item('d1', 'D1', 'dental-clinics', '2026-11-02T09:20:00Z'),
    item('d2', 'D2', 'dental-clinics', '2026-11-02T09:40:00Z'),
  ]);

  it('takes the soonest of each category first (categories by their soonest time), then the next round', () => {
    expect(ids(spreadByCategory(ranked, 6))).toEqual(['b1', 's1', 'd1', 'b2', 'd2', 'b3']);
  });

  it('stops at the limit, in the middle of a round if needed', () => {
    expect(ids(spreadByCategory(ranked, 2))).toEqual(['b1', 's1']);
    expect(ids(spreadByCategory(ranked, 4))).toEqual(['b1', 's1', 'd1', 'b2']);
  });

  it('returns fewer when there are fewer; categories compare case-insensitively; null is its own group', () => {
    const list = rankSoonest([
      item('1', 'A', 'Barbers', '2026-11-02T09:00:00Z'),
      item('2', 'B', 'barbers', '2026-11-02T09:10:00Z'),
      item('3', 'C', null, '2026-11-02T09:20:00Z'),
    ]);
    expect(ids(spreadByCategory(list, 12))).toEqual(['1', '3', '2']);
    expect(spreadByCategory([], 5)).toEqual([]);
  });
});
