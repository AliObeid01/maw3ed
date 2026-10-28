import { describe, expect, it } from 'vitest';
import { reminderPlan, sendDecision } from '@/server/domain/reminderWindows';

const H = 3_600_000;
const M = 60_000;
const start = new Date('2026-06-10T12:00:00Z');
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

describe('reminderPlan', () => {
  it('creates both jobs when booked well ahead, with due times', () => {
    const plan = reminderPlan(start, at(-3 * 24 * H));
    expect(plan).toEqual([
      { kind: 'H24', dueAt: at(-24 * H) },
      { kind: 'H2', dueAt: at(-2 * H) },
    ]);
  });
  it('H24 boundary: exactly 24h ahead yes, 1 ms less no', () => {
    expect(reminderPlan(start, at(-24 * H)).map((p) => p.kind)).toEqual(['H24', 'H2']);
    expect(reminderPlan(start, at(-24 * H + 1)).map((p) => p.kind)).toEqual(['H2']);
  });
  it('H2 boundary: exactly 2h ahead yes, 1 ms less no', () => {
    expect(reminderPlan(start, at(-2 * H)).map((p) => p.kind)).toEqual(['H2']);
    expect(reminderPlan(start, at(-2 * H + 1))).toEqual([]);
  });
  it('nothing for last-minute bookings', () => {
    expect(reminderPlan(start, at(-10 * M))).toEqual([]);
  });
});

describe('sendDecision', () => {
  it('skips inactive appointments', () => {
    expect(sendDecision('H24', start, at(-23 * H), false)).toBe('SKIP');
    expect(sendDecision('H2', start, at(-2 * H), false)).toBe('SKIP');
  });
  it('H24: sends before start-2h, skips from start-2h on', () => {
    expect(sendDecision('H24', start, at(-24 * H), true)).toBe('SEND');
    expect(sendDecision('H24', start, at(-2 * H - 1), true)).toBe('SEND');
    expect(sendDecision('H24', start, at(-2 * H), true)).toBe('SKIP');
    expect(sendDecision('H24', start, at(-1 * H), true)).toBe('SKIP');
  });
  it('H2: sends up to start-15min inclusive, skips after', () => {
    expect(sendDecision('H2', start, at(-2 * H), true)).toBe('SEND');
    expect(sendDecision('H2', start, at(-15 * M), true)).toBe('SEND');
    expect(sendDecision('H2', start, at(-15 * M + 1), true)).toBe('SKIP');
    expect(sendDecision('H2', start, at(5 * M), true)).toBe('SKIP');
  });
});
