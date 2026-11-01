import { type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { trackIntlErrors } from '../helpers/intlErrors';
import { setRole } from '../helpers/mockApi';
import { client, fromNow, mockOutcomesApi, type MockClient } from '../helpers/outcomesMock';

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

const NADINE = client('clnadine', 'Nadine Aoun', '+96176418902', {
  attended: 7,
  noShows: 2,
  lateCancels: 1,
  lastVisitAt: fromNow(-60 * 24 * 3),
});
const MAYA = client('clmaya', 'Maya Khoury', '+96171234567', { attended: 4, lastVisitAt: fromNow(-30) });
const OMAR = client('clomar', 'Omar Daher', '+96170555218', { attended: 6, noShows: 1, lastVisitAt: fromNow(-60 * 24 * 10) });
const LEA = client('clea', 'Lea Saab', '+9613512774', { attended: 11 });

const few = () => [{ ...NADINE }, { ...MAYA }, { ...OMAR }, { ...LEA }];
/** 60 generated clients named "Client 00".."Client 59", plus nothing else, to exercise paging at 25 per page. */
const many = (): MockClient[] =>
  Array.from({ length: 60 }, (_, i) =>
    client(`cl${String(i).padStart(2, '0')}`, `Client ${String(i).padStart(2, '0')}`, `+96170${String(100000 + i)}`),
  );

const rows = (page: Page) => page.getByRole('list').filter({ has: page.getByRole('link', { name: /^Open the history of/ }) }).first().getByRole('listitem');
const clientCalls = (calls: { path: string; search: string }[]) =>
  calls.filter((c) => c.path === '/api/clients').map((c) => Object.fromEntries(new URLSearchParams(c.search)));

test('lists clients by name with counts, the repeat no-show badge and a link to the history', async ({ page }) => {
  await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clients');
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0)).toContainText('Lea Saab');
  const nadine = rows(page).filter({ hasText: 'Nadine Aoun' });
  await expect(nadine).toContainText('+961 76 418 902');
  await expect(nadine.getByRole('link')).toHaveAttribute('href', '/app/clients/clnadine');
  // The red "N no-shows" pill (white, danger outline) is only on repeat no-showers.
  const badge = '.border-danger-line';
  await expect(nadine.locator(badge)).toHaveText('2 no-shows');
  await expect(rows(page).filter({ hasText: 'Maya Khoury' }).locator(badge)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Omar Daher' }).locator(badge)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '4 clients shown' })).toBeAttached();
  await nadine.getByRole('link').click();
  await expect(page).toHaveURL(/\/app\/clients\/clnadine$/);
});

test('search waits for a pause in typing, matches names and phone digits, and says when nothing matches', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(4);
  const before = clientCalls(calls).length;
  const box = page.getByRole('searchbox', { name: 'Search clients by name or phone' });
  await box.pressSequentially('maya', { delay: 40 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Maya Khoury');
  // Four keystrokes made exactly one search request, not four.
  const searches = clientCalls(calls).slice(before);
  expect(searches).toHaveLength(1);
  expect(searches[0]).toMatchObject({ search: 'maya', sort: 'name' });

  await box.fill('555');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Omar Daher');

  await box.fill('zzz');
  await expect(page.getByRole('heading', { name: 'No clients match “zzz”' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await expect(box).toHaveValue('');
  await expect(rows(page)).toHaveCount(4);
});

test('a slow answer to an older search never replaces the newer results', async ({ page }) => {
  await mockOutcomesApi(page, { clients: few(), clientDelays: { ma: 1200 } });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(4);
  const box = page.getByRole('searchbox', { name: 'Search clients by name or phone' });
  await box.fill('ma');
  await page.waitForTimeout(450); // past the debounce: the slow "ma" request is now in flight
  await box.fill('maya');
  await expect(rows(page)).toHaveCount(1);
  await page.waitForTimeout(1300); // the slow "ma" answer (Maya and Omar) has arrived by now
  await expect(rows(page)).toHaveCount(1);
  await expect(box).toHaveValue('maya');
});

test('sort: No-shows puts repeat no-showers first, Recent the latest visit first; the API gets the sort', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('radio', { name: 'No-shows' }).click();
  await expect(rows(page).nth(0)).toContainText('Nadine Aoun');
  await expect(rows(page).nth(1)).toContainText('Omar Daher');
  await expect(page.getByRole('radio', { name: 'No-shows' })).toBeChecked();
  expect(clientCalls(calls).at(-1)).toMatchObject({ sort: 'noShows' });

  await page.getByRole('radio', { name: 'Recent' }).click();
  await expect(rows(page).nth(0)).toContainText('Maya Khoury');
  expect(clientCalls(calls).at(-1)).toMatchObject({ sort: 'recent' });
});

test('Load more appends the next page with the cursor until there is none', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, { clients: many() });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).nth(25)).toContainText('Client 25');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(60);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  // `next dev` runs the first-page effect twice (Strict Mode); the cursor requests are what matter.
  const asked = clientCalls(calls);
  expect(asked.filter((c) => c.cursor).map((c) => c.cursor)).toEqual(['o25', 'o50']);
  expect(new Set(asked.map((c) => c.limit))).toEqual(new Set(['25']));
});

test('the search box is capped at 80 characters (the API limit)', async ({ page }) => {
  await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  const box = page.getByRole('searchbox', { name: 'Search clients by name or phone' });
  await expect(box).toHaveAttribute('maxlength', '80');
  await box.fill('x'.repeat(120));
  await expect(box).toHaveValue('x'.repeat(80));
});

test('an anonymised client in the list shows the localized name and a dash, never the tombstone', async ({ page }) => {
  const gone = client('cldeleted', 'Deleted client', 'deleted:cldeleted9x8y7z6w5v4u', { attended: 2 });
  await mockOutcomesApi(page, { clients: [...few(), gone] });
  await page.goto('/app/clients');
  const row = rows(page).filter({ hasText: 'Deleted client' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('bdi[dir="ltr"]').first()).toHaveText('—');
  expect(await page.locator('body').innerText()).not.toContain('deleted:');
});

test('shows the empty state when the business has no clients', async ({ page }) => {
  await mockOutcomesApi(page, { clients: [] });
  await page.goto('/app/clients');
  await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
});

test('a failed load offers a retry that works', async ({ page }) => {
  await mockOutcomesApi(page, { clients: few() });
  let failing = true;
  await page.route('**/api/clients**', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) })
      : route.fallback(),
  );
  await page.goto('/app/clients');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load this' })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(4);
});

test('a receptionist can view and search clients', async ({ page }) => {
  await setRole(page, 'STAFF', DASHBOARD);
  await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('searchbox').fill('nadine');
  await expect(rows(page)).toHaveCount(1);
});

test('phones show one summary line per client and no horizontal scroll; tablets and desktops show the table', async ({
  page,
}) => {
  await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(rows(page)).toHaveCount(4);
  const width = page.viewportSize()!.width;
  const nadine = rows(page).filter({ hasText: 'Nadine Aoun' });
  if (width < 768) {
    await expect(nadine).toContainText('7 visits · 2 no-shows · 1 late cancel');
    await expect(page.getByText('Late cancels', { exact: true })).toBeHidden();
  } else {
    await expect(page.getByText('Late cancels', { exact: true })).toBeVisible();
    await expect(nadine).toContainText('Last:');
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('RTL: Arabic clients list, phone stays left-to-right, no horizontal scroll', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, { clients: few() });
  await page.goto('/app/clients');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('searchbox', { name: 'ابحث عن العملاء بالاسم أو الهاتف' })).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]', { hasText: '+961 76 418 902' }).first()).toBeAttached();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
