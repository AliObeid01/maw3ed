import type { Page } from '@playwright/test';
import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { readStored, saved, savedPast, seedBookings, seedRaw } from './helpers/myBookings';
import { mockLinkApi } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-11 Part I: a muted "Completed" chip on previous visits, from GET /api/links/{token}/outcome (view tokens only,
// valid for 90 days after the start). The server says true only for an attended visit and an identical false for every
// other state, so nothing but "Completed" can ever be shown. All answers are mocked with page.route.

const pastCard = (page: Page, service: string) => page.getByTestId('past-card').filter({ hasText: service });
type Stored = { token: string; completed?: true; outcomeCheckedAt?: string };
const stored = async (page: Page) => (JSON.parse((await readStored(page))!).entries as Stored[]);

test('attended: the chip appears, is cached for good, and the endpoint is not asked again', async ({ page }) => {
  await seedBookings(page, [
    savedPast({ token: 'tok-done-1', serviceName: 'Beard trim' }),
    savedPast({ token: 'tok-open-1', reference: 'OPN111', serviceName: 'Colour' }, 12),
  ]);
  const api = await mockLinkApi(page, { act: 'view', outcome: { 'tok-done-1': true, 'tok-open-1': false } });
  await page.goto('/my-bookings');
  await expect(pastCard(page, 'Beard trim').getByTestId('completed-chip')).toHaveText('Completed'); // text, not colour alone
  await expect(pastCard(page, 'Colour').getByTestId('completed-chip')).toHaveCount(0);
  await expect(pastCard(page, 'Colour')).not.toContainText(/no-show|late|excused|attended/i);
  await expect.poll(() => [...api.outcomeCalls].sort()).toEqual(['tok-done-1', 'tok-open-1']);
  await expect.poll(async () => (await stored(page)).every((e) => typeof e.outcomeCheckedAt === 'string')).toBe(true);
  const entries = await stored(page);
  expect(entries.find((e) => e.token === 'tok-done-1')!.completed).toBe(true);
  expect(entries.find((e) => e.token === 'tok-open-1')!.completed).toBeUndefined();
  // Only the two outcome fields were added: still no client name, phone or email.
  const keys = Object.keys(entries[0]!);
  expect(keys.filter((k) => /phone|email|client|customer/i.test(k))).toEqual([]);

  // Reload: the chip is there at once from storage and NO request is made (true is permanent; false waits 6 hours).
  api.outcomeCalls.length = 0;
  await page.reload();
  await expect(pastCard(page, 'Beard trim').getByTestId('completed-chip')).toBeVisible();
  await page.waitForTimeout(500);
  expect(api.outcomeCalls).toEqual([]);
});

test('false, 404, 429 and 500 show nothing and no error, and are not retried within the cooldown', async ({ page }) => {
  await seedBookings(page, [
    savedPast({ token: 'tok-no-1', serviceName: 'Cut A' }),
    savedPast({ token: 'tok-404-1', reference: 'FOF404', serviceName: 'Cut B' }, 11),
    savedPast({ token: 'tok-429-1', reference: 'LIM429', serviceName: 'Cut C' }, 12),
    savedPast({ token: 'tok-500-1', reference: 'ERR500', serviceName: 'Cut D' }, 13),
  ]);
  const api = await mockLinkApi(page, {
    act: 'view',
    outcome: { 'tok-no-1': false, 'tok-404-1': 404, 'tok-429-1': 429, 'tok-500-1': 500 },
  });
  await page.goto('/my-bookings');
  await expect(page.getByTestId('past-card')).toHaveCount(4);
  await expect.poll(() => api.outcomeCalls.length).toBe(4);
  await expect(page.getByTestId('completed-chip')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveCount(0);
  await expect(page.getByText(/Could not refresh|something went wrong/i)).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).every((e) => e.outcomeCheckedAt && !e.completed)).toBe(true);
  api.outcomeCalls.length = 0;
  await page.reload();
  await expect(page.getByTestId('past-card')).toHaveCount(4);
  await page.waitForTimeout(500);
  expect(api.outcomeCalls).toEqual([]); // 6 hour cooldown, even after errors
});

test('a "not completed" answer is asked again after 6 hours, and then the chip can appear (attended is marked later)', async ({ page }) => {
  const checkedLongAgo = new Date(Date.now() - 7 * 3_600_000).toISOString();
  await seedRaw(
    page,
    JSON.stringify({
      v: 1,
      entries: [{ ...savedPast({ token: 'tok-late-1', serviceName: 'Beard trim' }), outcomeCheckedAt: checkedLongAgo }],
    }),
  );
  const api = await mockLinkApi(page, { act: 'view', outcome: { 'tok-late-1': true } });
  await page.goto('/my-bookings');
  await expect(pastCard(page, 'Beard trim').getByTestId('completed-chip')).toBeVisible();
  expect(api.outcomeCalls).toEqual(['tok-late-1']);
});

test('never asked for upcoming, cancelled or 90-day-old entries; at most 3 at a time; each of 17 entries once', async ({ page }) => {
  const entries = [
    saved({ token: 'tok-upcoming-9', reference: 'UPC999' }),
    savedPast({ token: 'tok-cancelled-9', reference: 'CAN999', ended: 'cancelled' }, 5),
    savedPast({ token: 'tok-ancient-9', reference: 'OLD999' }, 91),
    ...Array.from({ length: 17 }, (_, i) =>
      savedPast({ token: `tok-bulk-${String(i).padStart(2, '0')}`, reference: `BLK${String(i).padStart(3, '0')}` }, 2 + i),
    ),
  ];
  await seedBookings(page, entries);
  const api = await mockLinkApi(page, { act: 'view' });
  let inflight = 0;
  let peak = 0;
  await page.route('**/api/links/*/outcome', async (route) => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 120));
    inflight -= 1;
    await route.fallback();
  });
  await page.goto('/my-bookings');
  await expect.poll(() => api.outcomeCalls.length, { timeout: 20_000 }).toBe(17);
  await page.waitForTimeout(600);
  expect(api.outcomeCalls.length).toBe(17);
  expect(new Set(api.outcomeCalls).size).toBe(17);
  expect(api.outcomeCalls.some((t) => /upcoming|cancelled|ancient/.test(t))).toBe(false);
  expect(peak).toBeLessThanOrEqual(3);
  expect(peak).toBeGreaterThan(1);
});

test('hostile stored values: a fake completed flag is ignored and the page still works', async ({ page }) => {
  await seedRaw(
    page,
    JSON.stringify({
      v: 1,
      entries: [{ ...savedPast({ serviceName: 'Beard trim' }), completed: 'yes', outcomeCheckedAt: 'not a date' }],
    }),
  );
  const api = await mockLinkApi(page, { act: 'view' });
  await page.goto('/my-bookings');
  await expect(pastCard(page, 'Beard trim')).toBeVisible();
  await expect(page.getByTestId('completed-chip')).toHaveCount(0);
  await expect.poll(() => api.outcomeCalls.length).toBe(1); // sanitised: treated as an unchecked visit
});

test('the chip in Arabic at 360 and 1440: text, no overflow, Latin digits', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await seedBookings(page, [savedPast({ token: 'tok-done-1' })]);
  await mockLinkApi(page, { act: 'view', outcome: { 'tok-done-1': true } });
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('completed-chip')).toHaveText('مكتمل');
    await expect(page.locator('main')).not.toContainText(/[٠-٩]/);
    await expectNoPageOverflow(page);
  }
});
