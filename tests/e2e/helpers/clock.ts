import type { Page } from '@playwright/test';
import { DateTime } from 'luxon';

/**
 * The virtual clock every mocked e2e spec runs on, so no spec depends on the real time of day, midnight in
 * Beirut or CI running in UTC.
 *
 * - The suite STARTS at FIXED_NOW (default Wednesday 4 Nov 2026, 10:00 in Beirut: UTC+2, no DST change near).
 *   Override for the stability matrix: `E2E_NOW=2026-11-04T23:55:00+02:00 pnpm exec playwright test ...`.
 * - From there the clock ticks at normal speed, so a suite is consistent however long it takes.
 * - The browser clock is set to it with `freezeClock(page)` (every mock installer calls it), the dashboard dev
 *   server's Date is shifted by the same constant offset (playwright.config.ts + serverClock.cjs, so
 *   server-rendered text matches the browser and React does not hit a hydration mismatch), and every mock
 *   slot / date / appointment derives from `clockNow()` / `nowMs()`. Never call Date.now() or DateTime.now()
 *   in a spec or mock.
 */
export const DEFAULT_NOW = '2026-11-04T10:00:00+02:00';

const parsed = DateTime.fromISO(process.env.E2E_NOW || DEFAULT_NOW, { setZone: true });
if (!parsed.isValid) throw new Error(`E2E_NOW is not an ISO date-time: ${process.env.E2E_NOW}`);

export const FIXED_NOW: Date = parsed.toJSDate();

// The real instant the suite started, shared with workers and the web servers through the environment.
process.env.E2E_REAL_T0 ??= String(Date.now());

/** Constant shift from the real clock to the virtual clock. */
export const CLOCK_OFFSET_MS: number = FIXED_NOW.getTime() - Number(process.env.E2E_REAL_T0);

/** Virtual "now" in epoch milliseconds (use instead of Date.now()). */
export const nowMs = (): number => Date.now() + CLOCK_OFFSET_MS;

/** Virtual "now" as a Luxon DateTime (use instead of DateTime.now()); chain `.setZone(tz)` as needed. */
export const clockNow = (): DateTime => DateTime.fromMillis(nowMs());

/** Virtual "now" as a Date (use instead of new Date()). */
export const nowDate = (): Date => new Date(nowMs());

const frozen = new WeakSet<Page>();

/**
 * Set the browser clock to the virtual now (+ `offsetMs` to simulate a skewed device clock). Must run before
 * the first navigation. Idempotent per page: the first call wins. Timers keep running, so debounces and
 * polling work.
 */
export async function freezeClock(page: Page, offsetMs = 0): Promise<void> {
  if (frozen.has(page)) return;
  frozen.add(page);
  await page.clock.install({ time: new Date(nowMs() + offsetMs) });
}

/** Origin of the public app under test (the port can differ locally when 3000 is busy). */
export const ORIGIN = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
