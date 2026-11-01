import { nowMs } from './clock';

export type MockReminders = { h24: boolean; h2: boolean; email: boolean };

const HOUR = 3_600_000;

/**
 * What the mocked server answers in `reminders`. The real server decides this from the stored reminder rows
 * (src/server/domain/reminderWindows.ts: booked at least 24 h ahead: H24; at least 2 h: H2) and the client's
 * email (no address: nothing is promised); the mock only needs the same answer for the slot it serves. The
 * pages under test never compute it.
 */
export function mockReminders(startAtIso: string, hasEmail: boolean, atMs: number = nowMs()): MockReminders {
  const lead = Date.parse(startAtIso) - atMs;
  return { h24: hasEmail && lead >= 24 * HOUR, h2: hasEmail && lead >= 2 * HOUR, email: hasEmail };
}
