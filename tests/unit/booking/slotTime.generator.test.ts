import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '../ui/helpers';
import { SlotGrid } from '@/components/booking/SlotGrid';
import { findSlotByLocalTime, localTime, slotTime } from '@/lib/booking/slots';
import { generateSlots } from '@/server/domain/slots';

// F19, primary proof: feed the REAL slot generator a Beirut day and map its output through the URL time token.
const ZONE = 'Asia/Beirut';

function tokensFor(date: string, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6, startLocal: string, endLocal: string) {
  const slots = generateSlots({
    staff: [{ id: 'a', weeklyHours: [{ weekday, startLocal, endLocal }], timeOff: [], busy: [] }],
    service: { durationMin: 30, bufferMin: 0 },
    slotStepMin: 30,
    minNoticeMin: 0,
    bookingWindowDays: 3650,
    timezone: ZONE,
    now: new Date('2026-01-01T00:00:00Z'),
    range: { from: date, to: date },
  });
  const api = slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() }));
  return { api, tokens: api.map((s) => slotTime(s.startAt, ZONE)), walls: api.map((s) => localTime(s.startAt, ZONE)) };
}

describe('slotTime on real generateSlots output (Asia/Beirut)', () => {
  it.each([
    ['24 Oct 2026', '2026-10-24', 6],
    ['30 Oct 2027 (day before the last Sunday of October 2027)', '2027-10-30', 6],
  ] as const)('fall-back night %s: the repeated 23:xx hour gets distinct tokens (+03:00 then +02:00)', (_n, date, weekday) => {
    const { api, tokens, walls } = tokensFor(date, weekday, '22:00', '24:00');
    // The wall clock repeats ...
    expect(walls.filter((w) => w === '23:00')).toHaveLength(2);
    expect(walls.filter((w) => w === '23:30')).toHaveLength(2);
    // ... but every token is distinct, in order, with the offset changing from +03:00 to +02:00.
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toEqual(
      expect.arrayContaining(['23:00+03:00', '23:30+03:00', '23:00+02:00', '23:30+02:00']),
    );
    // Each token resolves back to exactly its own slot; a plain HH:mm link picks the first occurrence.
    api.forEach((s, i) => expect(findSlotByLocalTime(api, ZONE, tokens[i]!)).toBe(s));
    const firstPlain = findSlotByLocalTime(api, ZONE, '23:30')!;
    expect(slotTime(firstPlain.startAt, ZONE)).toBe('23:30+03:00');
  });

  it('spring-forward day (29 Mar 2026): no 00:xx slot, tokens before and after the gap carry the right offsets', () => {
    const { tokens, walls } = tokensFor('2026-03-29', 0, '00:00', '03:00');
    expect(walls.some((w) => w.startsWith('00:'))).toBe(false);
    expect(tokens[0]).toBe('01:00+03:00');
    expect(tokens).toEqual(['01:00+03:00', '01:30+03:00', '02:00+03:00', '02:30+03:00']);
  });

  it('a day before the gap still reads +02:00', () => {
    const { tokens } = tokensFor('2026-03-28', 6, '23:00', '24:00');
    expect(tokens).toEqual(['23:00+02:00', '23:30+02:00']);
  });
});

describe('SlotGrid selection (F19)', () => {
  const { api } = tokensFor('2026-10-24', 6, '22:00', '24:00');
  const html = (selectedTime: string) =>
    render(
      createElement(SlotGrid, {
        slots: api,
        timezone: ZONE,
        selectedTime,
        onSelect: () => undefined,
        labelId: 'x',
      }),
    );
  const checkedCount = (markup: string) => (markup.match(/aria-checked="true"/g) ?? []).length;

  it('a plain HH:mm token from an old link checks only the first slot at that wall time', () => {
    expect(checkedCount(html('23:30'))).toBe(1);
  });

  it('an offset token checks exactly the slot it names', () => {
    expect(checkedCount(html('23:30+02:00'))).toBe(1);
    expect(checkedCount(html('23:30+03:00'))).toBe(1);
    expect(html('23:30+02:00')).not.toBe(html('23:30+03:00'));
  });
});
