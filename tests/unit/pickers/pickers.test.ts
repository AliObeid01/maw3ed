import { describe, expect, it } from 'vitest';
import {
  addMonthsYmd,
  clampYmd,
  isDisabledYmd,
  isYmd,
  monthHasAllowedDay,
  monthMatrix,
  navigateYmd,
  weekdayOrder,
} from '@/lib/pickers/monthGrid';
import {
  displayHm,
  hourOptions,
  minuteOptions,
  parseHm,
  withHour,
  withMinute,
} from '@/lib/pickers/timeOptions';
import { filterOptions, typeaheadIndex } from '@/lib/pickers/typeahead';
import { placePopover } from '@/lib/pickers/position';

describe('monthMatrix', () => {
  it('starts weeks on Monday and pads with the neighbouring months', () => {
    // 1 Nov 2026 is a Sunday: six leading days from October, 30 days, so 6 rows.
    const rows = monthMatrix(2026, 11);
    expect(rows).toHaveLength(6);
    expect(rows[0]![0]!.ymd).toBe('2026-10-26');
    expect(rows[0]![6]!.ymd).toBe('2026-11-01');
    expect(rows[0]![6]!.inMonth).toBe(true);
    expect(rows[0]![0]!.inMonth).toBe(false);
    expect(rows[5]![6]!.ymd).toBe('2026-12-06');
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });

  it('can start on Sunday', () => {
    const rows = monthMatrix(2026, 11, { weekStart: 7 });
    expect(rows[0]![0]!.ymd).toBe('2026-11-01');
    expect(rows).toHaveLength(5);
  });

  it('gives a 4-row February when it starts on the first weekday of a week', () => {
    // 1 Feb 2021 is a Monday and the month has 28 days.
    const rows = monthMatrix(2021, 2);
    expect(rows).toHaveLength(4);
    expect(rows[3]![6]!.ymd).toBe('2021-02-28');
    expect(rows.flat().every((c) => c.inMonth)).toBe(true);
  });

  it('knows leap years', () => {
    const feb2028 = monthMatrix(2028, 2).flat().filter((c) => c.inMonth);
    expect(feb2028).toHaveLength(29);
    expect(monthMatrix(2100, 2).flat().filter((c) => c.inMonth)).toHaveLength(28);
    expect(monthMatrix(2000, 2).flat().filter((c) => c.inMonth)).toHaveLength(29);
  });

  it('handles a December that runs into January', () => {
    const rows = monthMatrix(2026, 12);
    expect(rows.at(-1)!.at(-1)!.ymd.startsWith('2027-01')).toBe(true);
  });

  it('marks days outside min and max as disabled (both ends inclusive)', () => {
    const cells = monthMatrix(2026, 11, { min: '2026-11-10', max: '2026-11-20' }).flat();
    const byYmd = (y: string) => cells.find((c) => c.ymd === y)!;
    expect(byYmd('2026-11-09').disabled).toBe(true);
    expect(byYmd('2026-11-10').disabled).toBe(false);
    expect(byYmd('2026-11-20').disabled).toBe(false);
    expect(byYmd('2026-11-21').disabled).toBe(true);
  });

  it('orders the weekday header to match the week start', () => {
    expect(weekdayOrder()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdayOrder(7)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });
});

describe('date helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-1-1')).toBe(false);
    expect(isYmd('')).toBe(false);
  });

  it('clamps a month move to the last day', () => {
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYmd('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('clamps into min and max', () => {
    expect(clampYmd('2026-01-01', '2026-02-01', '2026-03-01')).toBe('2026-02-01');
    expect(clampYmd('2026-05-01', '2026-02-01', '2026-03-01')).toBe('2026-03-01');
    expect(clampYmd('2026-02-15', '2026-02-01', '2026-03-01')).toBe('2026-02-15');
    expect(isDisabledYmd('2026-02-15')).toBe(false);
  });

  it('knows whether a month has any allowed day (previous / next arrows)', () => {
    expect(monthHasAllowedDay('2026-10-15', '2026-11-04', undefined)).toBe(false);
    expect(monthHasAllowedDay('2026-11-15', '2026-11-04', undefined)).toBe(true);
    expect(monthHasAllowedDay('2026-12-15', undefined, '2026-11-30')).toBe(false);
    expect(monthHasAllowedDay('2026-11-15', undefined, '2026-11-30')).toBe(true);
  });
});

describe('navigateYmd', () => {
  it('moves by day and by week', () => {
    expect(navigateYmd('2026-11-04', 'ArrowRight')).toBe('2026-11-05');
    expect(navigateYmd('2026-11-01', 'ArrowLeft')).toBe('2026-10-31');
    expect(navigateYmd('2026-11-04', 'ArrowDown')).toBe('2026-11-11');
    expect(navigateYmd('2026-11-04', 'ArrowUp')).toBe('2026-10-28');
  });

  it('Home and End go to the week edges', () => {
    // Wed 4 Nov 2026
    expect(navigateYmd('2026-11-04', 'Home')).toBe('2026-11-02');
    expect(navigateYmd('2026-11-04', 'End')).toBe('2026-11-08');
    expect(navigateYmd('2026-11-04', 'Home', { weekStart: 7 })).toBe('2026-11-01');
    expect(navigateYmd('2026-11-01', 'End', { weekStart: 1 })).toBe('2026-11-01');
  });

  it('Home and End stay inside the month shown (the neighbouring days are not drawn)', () => {
    // 1 Nov 2026 is a Sunday: its Monday-first week starts on 26 Oct.
    expect(navigateYmd('2026-11-01', 'Home')).toBe('2026-11-01');
    // 30 Nov 2026 is a Monday: its week ends on 6 Dec.
    expect(navigateYmd('2026-11-30', 'End')).toBe('2026-11-30');
    expect(navigateYmd('2026-11-03', 'Home')).toBe('2026-11-02');
    expect(navigateYmd('2026-12-02', 'End')).toBe('2026-12-06');
    expect(navigateYmd('2026-12-31', 'End')).toBe('2026-12-31');
  });

  it('PageUp and PageDown move a month, with shift a year', () => {
    expect(navigateYmd('2026-03-31', 'PageUp')).toBe('2026-02-28');
    expect(navigateYmd('2026-11-04', 'PageDown')).toBe('2026-12-04');
    expect(navigateYmd('2028-02-29', 'PageDown', { shift: true })).toBe('2029-02-28');
  });

  it('never leaves min and max', () => {
    expect(navigateYmd('2026-11-04', 'ArrowLeft', { min: '2026-11-04' })).toBe('2026-11-04');
    expect(navigateYmd('2026-11-04', 'PageDown', { max: '2026-11-20' })).toBe('2026-11-20');
  });
});

describe('time options', () => {
  it('lists 00-23 for an opening time and 01-24 for a closing time', () => {
    expect(hourOptions('09')[0]).toBe('00');
    expect(hourOptions('09')).toHaveLength(24);
    const end = hourOptions('09', true);
    expect(end[0]).toBe('01');
    expect(end.at(-1)).toBe('24');
    expect(end).not.toContain('00');
  });

  it('keeps an imported hour that is not on the list', () => {
    expect(hourOptions('00', true)).toContain('00');
    expect(hourOptions('00', true)[0]).toBe('00');
  });

  it('offers the 5-minute grid, plus an off-grid current minute', () => {
    const m = minuteOptions('', '09');
    expect(m).toHaveLength(12);
    expect(m[1]).toBe('05');
    expect(minuteOptions('07', '09')).toContain('07');
    expect(minuteOptions('07', '09')).toHaveLength(13);
  });

  it('locks minutes to 00 at 24 for a closing time only', () => {
    expect(minuteOptions('00', '24', true)).toEqual(['00']);
    expect(minuteOptions('00', '24', false)).toHaveLength(12);
  });

  it('builds the value for a chosen hour or minute', () => {
    expect(withHour('09', '30')).toBe('09:30');
    expect(withHour('09', '')).toBe('09:00');
    expect(withHour('24', '30', true)).toBe('24:00');
    expect(withMinute('09', '45')).toBe('09:45');
    expect(withMinute('', '45')).toBe('00:45');
  });

  it('parses and displays HH:mm in 24 hours', () => {
    expect(parseHm('09:05')).toEqual({ hour: '09', minute: '05' });
    expect(parseHm('24:00')).toEqual({ hour: '24', minute: '00' });
    expect(parseHm('24:30')).toBeNull();
    expect(parseHm('25:00')).toBeNull();
    expect(parseHm('9:00')).toBeNull();
    expect(parseHm('')).toBeNull();
    expect(displayHm('13:45')).toBe('13:45');
    expect(displayHm('garbage')).toBe('');
  });
});

describe('typeahead', () => {
  const opts = [
    { label: 'Apple' },
    { label: 'Avocado' },
    { label: 'Banana' },
    { label: 'Blueberry', disabled: true },
    { label: 'Cherry' },
  ];

  it('jumps to the next option starting with a single character, then cycles', () => {
    expect(typeaheadIndex(opts, 'a', -1)).toBe(0);
    expect(typeaheadIndex(opts, 'a', 0)).toBe(1);
    expect(typeaheadIndex(opts, 'a', 1)).toBe(0);
  });

  it('wraps around and ignores case', () => {
    expect(typeaheadIndex(opts, 'C', 4)).toBe(4); // only "Cherry" starts with c, found again after wrapping
    expect(typeaheadIndex(opts, 'a', 4)).toBe(0); // from the last option the search wraps to the start
  });

  it('matches a longer buffer by prefix from the current option', () => {
    expect(typeaheadIndex(opts, 'av', 0)).toBe(1);
    expect(typeaheadIndex(opts, 'ban', 0)).toBe(2);
  });

  it('treats a repeated character as cycling', () => {
    expect(typeaheadIndex(opts, 'aa', 0)).toBe(1);
  });

  it('skips disabled options and returns -1 when nothing matches', () => {
    expect(typeaheadIndex(opts, 'blu', 0)).toBe(-1);
    expect(typeaheadIndex(opts, 'z', 0)).toBe(-1);
    expect(typeaheadIndex(opts, '', 0)).toBe(-1);
    expect(typeaheadIndex([], 'a', 0)).toBe(-1);
  });

  it('matches digits in time columns', () => {
    const hours = ['00', '01', '09', '10', '11'].map((label) => ({ label }));
    expect(typeaheadIndex(hours, '1', 0)).toBe(3);
    expect(typeaheadIndex(hours, '11', 0)).toBe(4);
  });
});

describe('filterOptions', () => {
  const zones = [
    { label: 'Beirut (Lebanon)', searchText: 'Asia/Beirut' },
    { label: 'Berlin', searchText: 'Europe/Berlin' },
    { label: 'Amman', searchText: 'Asia/Amman' },
  ];

  it('returns everything for an empty query', () => {
    expect(filterOptions(zones, '  ')).toHaveLength(3);
  });

  it('filters by label or search text, ignoring case and accents', () => {
    expect(filterOptions(zones, 'BEI').map((z) => z.label)).toEqual(['Beirut (Lebanon)']);
    expect(filterOptions(zones, 'asia').map((z) => z.label)).toEqual(['Beirut (Lebanon)', 'Amman']);
    expect(filterOptions([{ label: 'Zürich' }], 'zurich')).toHaveLength(1);
  });

  it('needs every word to match and puts label-prefix matches first', () => {
    expect(filterOptions(zones, 'asia beirut')).toHaveLength(1);
    expect(filterOptions(zones, 'be').map((z) => z.label)).toEqual(['Beirut (Lebanon)', 'Berlin']);
    expect(filterOptions(zones, 'xyz')).toEqual([]);
  });
});

describe('placePopover', () => {
  const vp = { width: 1440, height: 900 };
  const anchor = { top: 200, bottom: 252, left: 400, right: 700, width: 300 };

  it('opens below, aligned to the start edge', () => {
    const p = placePopover(anchor, { width: 300, height: 300 }, vp, false);
    expect(p.side).toBe('below');
    expect(p.left).toBe(400);
    expect(p.top).toBe(258);
  });

  it('aligns to the right edge in RTL', () => {
    const p = placePopover(anchor, { width: 200, height: 100 }, vp, true);
    expect(p.left).toBe(500);
  });

  it('flips above when it does not fit below and there is more room above', () => {
    const low = { top: 700, bottom: 752, left: 400, right: 700, width: 300 };
    const p = placePopover(low, { width: 300, height: 400 }, vp, false);
    expect(p.side).toBe('above');
    expect(p.top).toBe(700 - 6 - 400);
  });

  it('stays below when it fits neither side but there is more room below; flips and caps when above is bigger', () => {
    const mid = { top: 300, bottom: 352, left: 400, right: 700, width: 300 };
    const below = placePopover(mid, { width: 300, height: 2000 }, vp, false);
    expect(below.side).toBe('below');
    expect(below.top).toBe(358);
    const low = { top: 600, bottom: 652, left: 400, right: 700, width: 300 };
    const above = placePopover(low, { width: 300, height: 2000 }, vp, false);
    expect(above.side).toBe('above');
    expect(above.maxHeight).toBe(600 - 6 - 8);
    // The popover ends 6 px above the field, so it never covers it.
    expect(above.top + Math.min(2000, above.maxHeight)).toBe(600 - 6);
  });

  it('caps the height to the room so the content scrolls inside', () => {
    const p = placePopover(anchor, { width: 300, height: 2000 }, vp, false);
    expect(p.maxHeight).toBe(900 - 252 - 6 - 8);
  });

  it('stays inside the viewport horizontally and never wider than it', () => {
    const edge = { top: 100, bottom: 150, left: 1300, right: 1430, width: 130 };
    expect(placePopover(edge, { width: 320, height: 200 }, vp, false).left).toBe(1440 - 8 - 320);
    const phone = placePopover(anchor, { width: 600, height: 200 }, { width: 360, height: 640 }, false);
    expect(phone.width).toBe(344);
    expect(phone.left).toBe(8);
  });
});
