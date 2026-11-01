import { nowMs } from './clock';

export type MockReminders = { h24: boolean; h2: boolean };

const HOUR = 3_600_000;

/**
 * What the mocked server answers in `reminders`. The real server decides this in src/server/domain/
 * reminderWindows.ts (booked at least 24 h ahead: H24; at least 2 h: H2); the mock only needs the same
 * answer for the lead time of the slot it serves. The pages under test never compute it.
 */
export function mockReminders(startAtIso: string, atMs: number = nowMs()): MockReminders {
  const lead = Date.parse(startAtIso) - atMs;
  return { h24: lead >= 24 * HOUR, h2: lead >= 2 * HOUR };
}
