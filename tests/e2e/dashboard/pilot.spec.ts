import { type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { clockNow } from '../helpers/clock';
import { DateTime } from 'luxon';
import { trackIntlErrors } from '../helpers/intlErrors';
import { setRole } from '../helpers/mockApi';
import { appt, client, mockOutcomesApi, pilotHistory, TZ, type Baseline } from '../helpers/outcomesMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

let intl: string[] = [];
test.beforeEach(async ({ page }) => {
  intl = trackIntlErrors(page);
  await setRole(page, 'OWNER', DASHBOARD);
});
test.afterEach(() => {
  expect(intl).toEqual([]);
});

const MAYA = client('clmaya', 'Maya Khoury', '+96171234567');
const today = () => clockNow().setZone(TZ);
const ymd = (dt: DateTime) => dt.toISODate()!;
const BASELINE: Baseline = {
  fromDate: ymd(today().minus({ days: 40 })),
  toDate: ymd(today().minus({ days: 27 })),
  appointments: 78,
  noShows: 14,
  lateCancels: 3,
};
/** 69 attended + 7 no-shows = 9.2% in the last 12 days against a 17.9% baseline (14 of 78). */
const withHistory = (over: Parameters<typeof mockOutcomesApi>[1] = {}) => ({
  clients: [{ ...MAYA }],
  appointments: pilotHistory('clmaya', { attended: 69, noShows: 7, lateCancels: 4 }),
  baseline: BASELINE,
  ...over,
});

const hero = (page: Page) => page.getByRole('region', { name: /No-show rate/ });
const form = (page: Page) => page.getByRole('complementary', { name: 'Baseline from your book' });

test('headline compares the pilot with the baseline, always with the raw counts and the rate definition', async ({
  page,
}) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilot report');
  const h = hero(page);
  await expect(h).toContainText('9.2%');
  await expect(h).toContainText('With Maw3ed · 9.2%');
  await expect(h).toContainText('7 no-shows of 76 held or missed');
  await expect(h).toContainText('Your book before · 17.9%');
  await expect(h).toContainText('14 no-shows of 78 held or missed');
  await expect(h).toContainText('8.7 points · 49% lower');
  await expect(h).toContainText('No-shows divided by (attended + no-shows)');
  // The sample-size note: a direction, never a claim of significance.
  await expect(page.getByText(/one no-show moves the rate by several points/)).toBeVisible();
  await expect(page.getByText(/significan/i)).toHaveCount(0);
});

test('supporting signals show the numbers; missing data shows a dash, never 0 or NaN', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const signals = page.getByRole('region', { name: 'Supporting numbers' });
  await expect(signals).toContainText('64%');
  await expect(signals).toContainText('9');
  await expect(signals).toContainText('Cancelled by link');
  await expect(signals).toContainText('5 of 7');
  await expect(signals).toContainText('from the waitlist · 71.4%');
});

test('with no outcomes, no baseline and no signals every number is a dash and the metric band comes before the form on phones', async ({
  page,
}) => {
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA }],
    appointments: [],
    baseline: null,
    signals: { confirmRate: null, cancellationsViaLink: 0, waitlistSlotsOffered: 0, waitlistRefills: 0, waitlistRefillRate: null },
  });
  await page.goto('/app/pilot');
  const h = hero(page);
  await expect(h).toContainText('—');
  await expect(h).toContainText('No outcomes marked in this period yet');
  await expect(h).toContainText('Enter your numbers from before the pilot to compare.');
  await expect(h).not.toContainText('NaN');
  await expect(h).not.toContainText('lower');
  const signals = page.getByRole('region', { name: 'Supporting numbers' });
  await expect(signals).toContainText('No reminders sent yet');
  await expect(signals).toContainText('No freed slots offered yet');
  await expect(signals).not.toContainText('NaN');
  await expect(page.getByText('No marked outcomes in these weeks yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Baseline from your book' })).toBeVisible();
  if (page.viewportSize()!.width < 1024) {
    const f = (await form(page).boundingBox())!;
    const hb = (await h.boundingBox())!;
    expect(f.y).toBeGreaterThan(hb.y); // the metric band leads, the baseline form follows
  }
});

test('the weekly chart has a text alternative: a labelled figure and a table with every number', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const figure = page.getByRole('img', { name: /Bar chart of the no-show rate for 4 weeks\. Baseline: 17\.9%/ });
  await expect(figure).toBeVisible();
  await expect(page.getByText('Baseline 17.9%')).toBeVisible();
  await page.getByText('Show as a table').click();
  const table = page.getByRole('table', { name: /Weekly no-show rate/ });
  await expect(table.getByRole('columnheader')).toHaveText(['Week of', 'No-shows', 'Held or missed', 'Rate']);
  await expect(table.getByRole('row')).toHaveCount(5); // header + 4 weeks
  expect(await table.innerText()).toMatch(/\d+%/);

  // Period selector: 8 and 12 weeks reach the API and grow the table.
  await page.getByRole('radio', { name: '8 weeks' }).click();
  await expect(page.getByRole('radio', { name: '8 weeks' })).toBeChecked();
  await expect(table.getByRole('row')).toHaveCount(9);
  await page.getByRole('radio', { name: '12 weeks' }).click();
  await expect(table.getByRole('row')).toHaveCount(13);
  const weeks = calls.filter((c) => c.path === '/api/pilot/report').map((c) => new URLSearchParams(c.search).get('weeks'));
  expect(weeks).toContain('8');
  expect(weeks).toContain('12');
});

test('the baseline form says "held or missed" and prefills the saved numbers', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const f = form(page);
  await expect(f.getByLabel('Held or missed')).toHaveValue('78');
  await expect(f.getByLabel('No-shows')).toHaveValue('14');
  await expect(f.getByLabel('Late cancels')).toHaveValue('3');
  await expect(f.getByLabel('From')).toHaveValue(BASELINE.fromDate);
  await expect(f.getByLabel('To')).toHaveValue(BASELINE.toDate);
  await expect(f).toContainText('Baseline appointments are those held or missed');
  await expect(f).toContainText('excluding cancellations and late cancels');
  await expect(f.getByRole('button', { name: 'Update baseline' })).toBeVisible();
});

test('baseline form validates before sending: required, no-shows above appointments, future end date, over 31 days', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, withHistory({ baseline: null }));
  await page.goto('/app/pilot');
  const f = form(page);
  await f.getByRole('button', { name: 'Save baseline' }).click();
  await expect(f.getByText('Choose a date.')).toHaveCount(2);
  await expect(f.getByText('Enter a number (0 is fine).')).toHaveCount(3);
  await expect(f.getByLabel('From')).toBeFocused();
  await expect(f.getByLabel('From')).toHaveAttribute('aria-invalid', 'true');

  await f.getByLabel('From').fill(ymd(today().minus({ days: 20 })));
  await f.getByLabel('To').fill(ymd(today().plus({ days: 1 })));
  await f.getByLabel('Held or missed').fill('10');
  await f.getByLabel('No-shows').fill('11');
  await f.getByLabel('Late cancels').fill('0');
  await f.getByRole('button', { name: 'Save baseline' }).click();
  await expect(f.getByText('The period cannot end in the future.')).toBeVisible();
  await expect(f.getByText('No-shows cannot be more than the appointments.')).toBeVisible();

  await f.getByLabel('To').fill(ymd(today().minus({ days: 1 })));
  await f.getByLabel('From').fill(ymd(today().minus({ days: 40 })));
  await f.getByLabel('No-shows').fill('2');
  await f.getByRole('button', { name: 'Save baseline' }).click();
  await expect(f.getByText('The period can be at most 31 days.')).toBeVisible();
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});

test('a valid baseline is saved with numbers, confirmed with a toast, and the comparison appears', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, withHistory({ baseline: null }));
  await page.goto('/app/pilot');
  const f = form(page);
  const from = ymd(today().minus({ days: 20 }));
  const to = ymd(today().minus({ days: 7 }));
  await f.getByLabel('From').fill(from);
  await f.getByLabel('To').fill(to);
  // The native date input is locale-bound (mm/dd/yyyy in a US browser): the chosen days are also written out in the app's format.
  const written = (d: string) =>
    new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
  await expect(f.getByText(written(from), { exact: true })).toBeVisible();
  await expect(f.getByText(written(to), { exact: true })).toBeVisible();
  await f.getByLabel('Held or missed').fill('78');
  await f.getByLabel('No-shows').fill('14');
  await f.getByLabel('Late cancels').fill('3');
  await f.getByRole('button', { name: 'Save baseline' }).dblclick();
  await expect(page.getByRole('status').filter({ hasText: 'Baseline saved' })).toBeVisible();
  await expect(hero(page)).toContainText('Your book before · 17.9%');
  await expect(hero(page)).toContainText('14 no-shows of 78 held or missed');
  await expect(f.getByRole('button', { name: 'Update baseline' })).toBeVisible();
  const puts = calls.filter((c) => c.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(puts[0]!.body).toEqual({ fromDate: from, toDate: to, appointments: 78, noShows: 14, lateCancels: 3 });
});

test('Export CSV downloads through the authenticated endpoint for the pilot dates', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(hero(page)).toContainText('9.2%');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^maw3ed-pilot-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = calls.filter((c) => c.path === '/api/pilot/export.csv');
  expect(csv).toHaveLength(1);
  const q = new URLSearchParams(csv[0]!.search);
  expect(q.get('to')).toBe(ymd(today()));
  expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('status').filter({ hasText: 'CSV downloaded' })).toBeVisible();
});

test('a receptionist sees the friendly owner-only state and no pilot request is made', async ({ page }) => {
  await setRole(page, 'STAFF', DASHBOARD);
  const { calls } = await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(page.getByRole('heading', { name: 'Only the owner can change this' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  expect(calls.filter((c) => c.path.startsWith('/api/pilot'))).toHaveLength(0);
});

test('a server 403 (role changed while the page was open) shows the owner-only state too', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.route('**/api/pilot/report**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'x' } }) }),
  );
  await page.goto('/app/pilot');
  await expect(page.getByRole('heading', { name: 'Only the owner can change this' })).toBeVisible();
});

test('a failed report offers a retry', async ({ page }) => {
  await mockOutcomesApi(page, withHistory({ reportStatus: 500 }));
  await page.goto('/app/pilot');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load this' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('no horizontal scroll and the chart fits at this width', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await page.getByRole('radio', { name: '12 weeks' }).click();
  await expect(page.getByRole('img', { name: /for 12 weeks/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// ---- review fixes ---------------------------------------------------------------------------------------

const DAY = 24 * 60;
const longDay = (ymdStr: string) =>
  new Date(`${ymdStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

test('the chart is labelled with the weeks it shows (first Monday to the end of the last week) and the control says "Weeks shown"', async ({
  page,
}) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const monday = today().startOf('week');
  const from = ymd(monday.minus({ weeks: 3 }));
  const to = ymd(monday.plus({ days: 6 }));
  await expect(page.getByText(`Last 4 weeks: ${longDay(from)} to ${longDay(to)}`)).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Weeks shown' })).toBeVisible();
  await page.getByRole('radio', { name: '12 weeks' }).click();
  await expect(
    page.getByText(`Last 12 weeks: ${longDay(ymd(monday.minus({ weeks: 11 })))} to ${longDay(to)}`),
  ).toBeVisible();
  // The hero is the whole pilot, whatever period the chart shows.
  await expect(page.getByRole('region', { name: /No-show rate · since/ })).toContainText('9.2%');
});

test('weeks without marked outcomes get a "no data" marker and a legend entry at every period length, never a 0% bar', async ({
  page,
}) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await page.getByText('Show as a table').click();
  for (const n of [4, 8, 12]) {
    await page.getByRole('radio', { name: `${n} weeks` }).click();
    await expect(page.getByRole('img', { name: new RegExp(`for ${n} weeks`) })).toBeVisible();
    const table = page.getByRole('table', { name: /Weekly no-show rate/ });
    await expect(table.getByRole('row')).toHaveCount(n + 1);
    const dashes = await table.getByRole('cell', { name: '—' }).count();
    await expect(page.getByTestId('no-data-week')).toHaveCount(dashes);
    if (n === 12) expect(dashes).toBeGreaterThan(5);
    if (dashes > 0) await expect(page.getByText('No marked outcomes', { exact: true })).toBeVisible();
  }
});

test('appointments that started but have no outcome are called out with a link to Mark outcome', async ({ page }) => {
  await mockOutcomesApi(
    page,
    withHistory({
      appointments: [
        ...pilotHistory('clmaya', { attended: 69, noShows: 7, lateCancels: 4 }),
        appt('unmarked1', 'clmaya', -3 * 60, 30),
        appt('unmarked2', 'clmaya', -5 * 60, 30),
      ],
    }),
  );
  await page.goto('/app/pilot');
  const link = hero(page).getByRole('link', { name: '2 appointments still need an outcome' });
  await expect(link).toHaveAttribute('href', '/app/outcomes');
  await expect(hero(page)).toContainText('of 76 held or missed');
});

test('nothing unmarked: no call-out', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(hero(page)).toContainText('9.2%');
  await expect(page.getByText(/still needs? an outcome/)).toHaveCount(0);
});

test('a failed period switch keeps the control, the chart label and a note on the period that is shown, and retries', async ({
  page,
}) => {
  await mockOutcomesApi(page, withHistory());
  let failing = true;
  await page.route('**/api/pilot/report?weeks=8', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) })
      : route.fallback(),
  );
  await page.goto('/app/pilot');
  await expect(page.getByText(/Last 4 weeks:/)).toBeVisible();
  await page.getByRole('radio', { name: '8 weeks' }).click();
  await expect(page.getByText('Could not load that period. Showing the last 4 weeks.')).toBeVisible();
  await expect(page.getByRole('radio', { name: '4 weeks' })).toBeChecked();
  await expect(page.getByText(/Last 4 weeks:/)).toBeVisible();
  failing = false;
  await page.getByRole('radio', { name: '8 weeks' }).click();
  await expect(page.getByText(/Last 8 weeks:/)).toBeVisible();
  await expect(page.getByRole('radio', { name: '8 weeks' })).toBeChecked();
});

test('Export clamps a pilot longer than 366 days and says so', async ({ page }) => {
  const { calls } = await mockOutcomesApi(
    page,
    withHistory({
      appointments: [
        ...pilotHistory('clmaya', { attended: 69, noShows: 7, lateCancels: 4 }),
        appt('old', 'clmaya', -400 * DAY, 30, { status: 'ATTENDED' }),
      ],
    }),
  );
  await page.goto('/app/pilot');
  await expect(page.getByText('Exports the latest 366 days, the most the server allows.')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await download;
  const q = new URLSearchParams(calls.find((c) => c.path === '/api/pilot/export.csv')!.search);
  expect(q.get('to')).toBe(ymd(today()));
  expect(q.get('from')).toBe(ymd(today().minus({ days: 365 })));
});

test('a short pilot is exported whole, without a clamp note', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(hero(page)).toContainText('9.2%');
  await expect(page.getByText(/the most the server allows/)).toHaveCount(0);
});

test('the baseline date inputs cannot pick a day after today', async ({ page }) => {
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const f = form(page);
  await expect(f.getByLabel('From')).toHaveAttribute('max', ymd(today()));
  await expect(f.getByLabel('To')).toHaveAttribute('max', ymd(today()));
});

test('Arabic: only the numbers are left-to-right islands; the sentences keep the page direction', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Change chip: "8.7 نقطة · أقل بنسبة 49%"
  const chip = page.locator('span', { hasText: 'نقطة' }).filter({ has: page.locator('bdi') }).last();
  await expect(chip.locator('bdi[dir="ltr"]')).toHaveText(['8.7', '49%']);
  const chipText = (await chip.innerText()).replace(/\s+/g, ' ');
  expect(chipText).toContain('نقطة');
  expect(chipText).toContain('أقل بنسبة');
  // The words are outside any LTR island and the nearest dir attribute is the page's rtl.
  expect(await chip.evaluate((el) => el.closest('[dir]')?.getAttribute('dir'))).toBe('rtl');
  expect(await chip.evaluate((el) => el.querySelectorAll('bdi').length)).toBe(2);

  // Signals: "5 من 7" keeps "من" between two isolated numbers, in a right-to-left sentence.
  const tile = page.getByRole('region', { name: 'أرقام داعمة' }).locator('div', { hasText: 'أُعيد ملؤها' }).last();
  const value = tile.locator('span').first();
  await expect(value.locator('bdi[dir="ltr"]')).toHaveText(['5', '7']);
  expect((await value.innerText()).replace(/\s+/g, ' ').trim()).toMatch(/^5 من 7$/);
  expect(await value.evaluate((el) => el.closest('[dir]')?.getAttribute('dir'))).toBe('rtl');

  // The counts line: numbers isolated, words not.
  const counts = page.locator('section[aria-labelledby="pilot-hero"]').getByText(/تم أو فات/).first();
  await expect(counts.locator('bdi[dir="ltr"]')).toHaveText(['7', '76']);
  expect(await counts.evaluate((el) => el.closest('[dir]')?.getAttribute('dir'))).toBe('rtl');
});

test('Arabic week labels use the plural forms: 12 weeks reads "12 أسبوعًا"', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  const group = page.getByRole('radiogroup', { name: 'الأسابيع المعروضة' });
  await expect(group.getByRole('radio')).toHaveText(['4 أسابيع', '8 أسابيع', '12 أسبوعًا']);
});

test('RTL: Arabic pilot report, percentages and dates stay left-to-right, no horizontal scroll', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, withHistory());
  await page.goto('/app/pilot');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('region', { name: 'أرقام داعمة' })).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]', { hasText: '9.2%' }).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'الأسابيع المعروضة' })).toHaveCount(0); // a radiogroup, not a group
  await expect(page.getByRole('radiogroup', { name: 'الأسابيع المعروضة' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
