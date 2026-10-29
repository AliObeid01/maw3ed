import { describe, expect, it } from 'vitest';
import {
  OFFER_BATCH_SIZE,
  OFFER_TTL_MIN,
  offerExpiryFor,
  matchEntries,
  type Candidate,
} from '@/server/domain/waitlistMatch';

const TZ = 'Asia/Beirut';
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  entryId: id,
  clientId: `c-${id}`,
  staffId: null,
  fromDate: '2026-11-01',
  toDate: '2026-11-30',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  ...over,
});
const slot = (startAt: string, staffId = 's1') => ({
  staffId,
  startAt: new Date(startAt),
  timezone: TZ,
});
const base = {
  now: new Date('2026-11-02T08:00:00Z'),
  excludeClientIds: new Set<string>(),
  busyClientIds: new Set<string>(),
  alreadyOfferedEntryIds: new Set<string>(),
};
const ids = (r: Candidate[]) => r.map((c) => c.entryId);
const match = (
  startAt: string,
  candidates: Candidate[],
  over: Partial<Parameters<typeof matchEntries>[0]> = {},
) => ids(matchEntries({ ...base, slot: slot(startAt), candidates, ...over }));

describe('matchEntries', () => {
  it('orders first come first served and caps at the batch size', () => {
    const candidates = [
      cand('d', { createdAt: new Date('2026-10-04T00:00:00Z') }),
      cand('b', { createdAt: new Date('2026-10-02T00:00:00Z') }),
      cand('a', { createdAt: new Date('2026-10-01T00:00:00Z') }),
      cand('c', { createdAt: new Date('2026-10-03T00:00:00Z') }),
    ];
    expect(OFFER_BATCH_SIZE).toBe(3);
    expect(match('2026-11-05T09:00:00Z', candidates)).toEqual(['a', 'b', 'c']);
  });

  it('gives one client at most one place, keeping the earliest entry', () => {
    const candidates = [
      cand('late', { clientId: 'same', createdAt: new Date('2026-10-05T00:00:00Z') }),
      cand('early', { clientId: 'same', createdAt: new Date('2026-10-01T00:00:00Z') }),
      cand('b', { createdAt: new Date('2026-10-02T00:00:00Z') }),
      cand('c', { createdAt: new Date('2026-10-03T00:00:00Z') }),
      cand('d', { createdAt: new Date('2026-10-04T00:00:00Z') }),
    ];
    expect(match('2026-11-05T09:00:00Z', candidates)).toEqual(['early', 'b', 'c']);
  });

  it('breaks createdAt ties by entry id', () => {
    expect(match('2026-11-05T09:00:00Z', [cand('z'), cand('m')])).toEqual(['m', 'z']);
  });

  it('respects the staff preference', () => {
    expect(
      match('2026-11-05T09:00:00Z', [
        cand('any'),
        cand('mine', { staffId: 's1' }),
        cand('other', { staffId: 's2' }),
      ]),
    ).toEqual(['any', 'mine']);
  });

  it('applies exclusions: cancelling client, busy clients, already offered', () => {
    expect(
      match('2026-11-05T09:00:00Z', [cand('a'), cand('b'), cand('c'), cand('d')], {
        excludeClientIds: new Set(['c-a']),
        busyClientIds: new Set(['c-b']),
        alreadyOfferedEntryIds: new Set(['c']),
      }),
    ).toEqual(['d']);
  });

  it('range is inclusive on both local days', () => {
    const cs = [cand('x', { fromDate: '2026-11-05', toDate: '2026-11-05' })];
    expect(match('2026-11-05T09:00:00Z', cs)).toEqual(['x']);
    expect(match('2026-11-04T09:00:00Z', cs)).toEqual([]);
    expect(match('2026-11-06T09:00:00Z', cs)).toEqual([]);
  });

  it('uses the LOCAL date: 23:30 UTC on the 4th is the 5th in Beirut (UTC+2)', () => {
    const cs = [cand('x', { fromDate: '2026-11-05', toDate: '2026-11-05' })];
    expect(match('2026-11-04T23:30:00Z', cs)).toEqual(['x']);
  });

  it('handles the DST switch days (spring forward 2026-03-27/28, fall back 2026-10-25)', () => {
    // Beirut: DST starts last Sunday of March at 00:00 (-> 01:00); ends last Sunday of October at 00:00.
    // The local day 2026-03-29 therefore starts at 22:00Z on the 28th... derive instead of assuming:
    const now = new Date('2026-03-01T00:00:00Z');
    const spring = [cand('s', { fromDate: '2026-03-29', toDate: '2026-03-29' })];
    // 2026-03-29 local day: starts when Beirut local midnight occurs. Before the jump UTC+2: the day
    // 03-29 begins at 03-28T22:00Z, but local 00:00 on 03-29 does not exist as the DST jump is at 00:00.
    expect(match('2026-03-28T21:59:00Z', spring, { now })).toEqual([]);
    expect(match('2026-03-28T22:30:00Z', spring, { now })).toEqual(['s']);
    expect(match('2026-03-29T20:59:00Z', spring, { now })).toEqual(['s']);
    expect(match('2026-03-29T21:00:00Z', spring, { now })).toEqual([]);

    const now2 = new Date('2026-10-01T00:00:00Z');
    const fall = [cand('f', { fromDate: '2026-10-25', toDate: '2026-10-25' })];
    // Clocks go back at local 00:00 on the 25th (to 23:00 on the 24th), so the 24th lasts 25 h; the 25th
    // starts at 22:00Z on the 24th (UTC+2) and ends at 22:00Z on the 25th.
    expect(match('2026-10-24T21:59:00Z', fall, { now: now2 })).toEqual([]);
    expect(match('2026-10-24T22:00:00Z', fall, { now: now2 })).toEqual(['f']);
    expect(match('2026-10-25T21:59:00Z', fall, { now: now2 })).toEqual(['f']);
    expect(match('2026-10-25T22:00:00Z', fall, { now: now2 })).toEqual([]);
  });

  it('drops entries whose range has already ended (local today)', () => {
    expect(
      match('2026-11-05T09:00:00Z', [cand('old', { toDate: '2026-11-09' }), cand('ok')], {
        now: new Date('2026-11-10T08:00:00Z'),
      }),
    ).toEqual(['ok']);
  });
});

describe('offerExpiryFor', () => {
  const now = new Date('2026-11-02T08:00:00Z');
  it('is now + 30 min when the slot is far away', () => {
    const e = offerExpiryFor(now, new Date('2026-11-05T09:00:00Z'), 60);
    expect(OFFER_TTL_MIN).toBe(30);
    expect(e?.toISOString()).toBe('2026-11-02T08:30:00.000Z');
  });
  it('is capped at slotStart - minNotice', () => {
    const e = offerExpiryFor(now, new Date('2026-11-02T09:00:00Z'), 45);
    expect(e?.toISOString()).toBe('2026-11-02T08:15:00.000Z');
  });
  it('is null when the slot is inside the minimum notice, exactly at it, or in the past', () => {
    expect(offerExpiryFor(now, new Date('2026-11-02T08:50:00Z'), 60)).toBeNull();
    expect(offerExpiryFor(now, new Date('2026-11-02T09:00:00Z'), 60)).toBeNull();
    expect(offerExpiryFor(now, new Date('2026-11-01T09:00:00Z'), 0)).toBeNull();
  });
});
