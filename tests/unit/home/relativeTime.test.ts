import { describe, expect, it } from 'vitest';
import { bySoonest, relativeLabel } from '@/lib/home/relativeTime';

// 2026-11-11 08:00 in Beirut (UTC+2, winter time) is 06:00Z.
const NOW = new Date('2026-11-11T06:00:00Z');
const label = (iso: string, zone = 'Asia/Beirut') => relativeLabel(iso, zone, NOW, 'en');

describe('relativeLabel', () => {
  it('is "now" for the present and the past', () => {
    expect(label('2026-11-11T06:00:00Z')).toEqual({ kind: 'now' });
    expect(label('2026-11-11T05:30:00Z')).toEqual({ kind: 'now' });
  });
  it('counts minutes under an hour, rounding a started minute up', () => {
    expect(label('2026-11-11T06:15:00Z')).toEqual({ kind: 'minutes', count: 15 });
    expect(label('2026-11-11T06:00:30Z')).toEqual({ kind: 'minutes', count: 1 });
    expect(label('2026-11-11T06:59:00Z')).toEqual({ kind: 'minutes', count: 59 });
  });
  it('counts hours from 60 minutes up to 6 hours', () => {
    expect(label('2026-11-11T07:00:00Z')).toEqual({ kind: 'hours', count: 1 });
    expect(label('2026-11-11T08:40:00Z')).toEqual({ kind: 'hours', count: 3 });
    expect(label('2026-11-11T11:59:00Z')).toEqual({ kind: 'hours', count: 6 });
  });
  it('then says today, tomorrow or the weekday and date by the business calendar', () => {
    expect(label('2026-11-11T12:00:00Z')).toEqual({ kind: 'today' }); // 14:00 Beirut
    expect(label('2026-11-12T07:00:00Z')).toEqual({ kind: 'tomorrow' });
    expect(label('2026-11-14T07:00:00Z')).toEqual({ kind: 'date', text: 'Sat 14 Nov' });
  });
  it('uses the business zone for the calendar day, not the viewer', () => {
    // 22:30Z on the 11th is already the 12th in Beirut but still the 11th in New York.
    expect(label('2026-11-11T22:30:00Z')).toEqual({ kind: 'tomorrow' });
    expect(relativeLabel('2026-11-11T22:30:00Z', 'America/New_York', NOW, 'en')).toEqual({ kind: 'today' });
  });
});

describe('bySoonest', () => {
  it('orders by start, keeps ties in the given order and puts rows without a time last', () => {
    const rows = [
      { n: 'c', at: '2026-11-12T07:00:00Z' },
      { n: 'a', at: '2026-11-11T07:00:00Z' },
      { n: 'x', at: undefined },
      { n: 'b', at: '2026-11-11T07:00:00Z' },
    ];
    expect(bySoonest(rows, (r) => r.at).map((r) => r.n)).toEqual(['a', 'b', 'c', 'x']);
  });
});
