import { clockNow, ORIGIN } from './helpers/clock';
import {
  ALL,
  beirut,
  biz,
  chooseArea,
  chooseCategory,
  fade,
  mockExplore,
  withFilters,
} from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { pickDate, pickerText, selectOption } from './helpers/pickers';
import { expect, test } from './helpers/test';

// The Explore page (/directory). Self-contained: both public data requests are answered by page.route, on the frozen clock.

const API = '/api/public/directory';
const TODAY = () => clockNow().toFormat('yyyy-MM-dd');
const TOMORROW = () => clockNow().plus({ days: 1 }).toFormat('yyyy-MM-dd');
const card = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });

test.describe('explore: results and cards', () => {
  test('opens from a home link: filters prefilled, one request with the fixed param order', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory?category=barbers&area=sidon&search=Abu');
    await expect(page.getByRole('heading', { level: 1, name: 'Explore businesses' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Abu Karam Barbershop' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Service or business' })).toHaveValue('Abu');
    expect(seen.requests).toEqual([`${API}?search=Abu&area=sidon&category=barbers&include=nextFree%2Cservices&limit=12`]);
    // Phone: the filters sit in the sheet.
    await withFilters(page, async () => {
      expect(await pickerText(page, 'Area')).toBe('Sidon');
      expect(await pickerText(page, 'Category')).toBe('Barbers');
    });
  });

  test('a card shows initials, Category · Area, address, price, service chips, free times and View & book', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory');
    const c = card(page, 'Abu Karam Barbershop');
    await expect(c).toContainText('AK');
    await expect(c).toContainText('Barbers · Sidon');
    await expect(c).toContainText('Riad El Solh St');
    await expect(c).toContainText(/from \u2066?8 USD/);
    const chips = c.getByTestId('card-services').getByRole('listitem');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(1)).toContainText('Beard trim');
    await expect(chips.nth(1)).toContainText('12.50 USD');
    await expect(c).toContainText('Free today');
    await expect(c).toContainText(/for ⁨?Haircut/);
    // HH:mm in the business zone, up to four, linking to the booking page.
    const times = c.getByRole('link', { name: /^\d\d:\d\d at / });
    await expect(times).toHaveText(['15:30', '16:00', '17:30', '18:00']);
    await expect(times.first()).toHaveAttribute('href', '/b/abu-karam');
    const book = c.getByRole('link', { name: 'View & book at Abu Karam Barbershop' });
    await expect(book).toHaveAttribute('href', '/b/abu-karam');
    expect((await book.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Tomorrow's day label and a business with no free times (quiet wording, never "fully booked").
    await expect(card(page, 'Fade Lab')).toContainText('Free tomorrow');
    const none = card(page, 'Studio Nour');
    await expect(none).toContainText('No free times soon');
    await expect(page.locator('body')).not.toContainText(/fully booked|no availability|sold out/i);
  });

  test('the times use the business zone, not the visitor zone', async ({ page }) => {
    await mockExplore(page, {
      all: [biz({ slug: 'ny', name: 'NY Cuts', timezone: 'America/New_York', freeTimes: [beirut(0, 10, 30, 'America/New_York')], nextFree: { startAt: beirut(0, 10, 30, 'America/New_York'), service: { id: 'x', name: 'Cut', durationMin: 20 } } })],
    });
    await page.goto('/directory');
    await expect(card(page, 'NY Cuts').getByRole('link', { name: /^\d\d:\d\d at / })).toHaveText(['10:30']);
  });

  test('the list is a list, the count is shown and announced politely', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByTestId('explore-count')).toHaveText('Showing 3 places');
    await expect(page.getByTestId('explore-live')).toHaveText('3 places found');
    await expect(page.getByTestId('explore-live')).toHaveAttribute('role', 'status');
    await expect(page.getByRole('list', { name: 'Showing 3 places' }).getByRole('listitem').first()).toBeVisible();
    await expect(page.getByTestId('explore-end')).toHaveText('No more places.');
    await expect(page.getByText('Times are shown in each business’s local time.')).toBeVisible();
    await expect(page.getByText('Beirut time')).toHaveCount(0);
  });

  test('has one h1 and noindex only when filters are in the URL', async ({ page, request }) => {
    await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle(/Explore businesses/);
    const plain = await (await request.get(`${ORIGIN}/directory`)).text();
    expect(plain).not.toMatch(/<meta name="robots" content="noindex/);
    const filtered = await (await request.get(`${ORIGIN}/directory?area=beirut`)).text();
    expect(filtered).toMatch(/<meta name="robots" content="noindex/);
  });
});

test.describe('explore: filters and the request rules', () => {
  test('each filter updates the URL and the request', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    const last = () => seen.requests.at(-1)!;

    await chooseArea(page, 'Beirut');
    await expect(page).toHaveURL(/[?&]area=beirut/);
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
    await expect.poll(last).toBe(`${API}?area=beirut&include=nextFree%2Cservices&limit=12`);

    await chooseCategory(page, 'Barbers');
    await expect(page).toHaveURL(/area=beirut&category=barbers/);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await expect.poll(last).toBe(`${API}?area=beirut&category=barbers&include=nextFree%2Cservices&limit=12`);

    await withFilters(page, () => page.getByRole('button', { name: 'Tomorrow' }).click());
    await expect(page).toHaveURL(new RegExp(`category=barbers&when=${TOMORROW()}`));
    await expect.poll(last).toBe(`${API}?area=beirut&category=barbers&when=${TOMORROW()}&include=nextFree%2Cservices&limit=12`);

  });

  test('service chips come from the category and filter by the service name', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory?category=barbers');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await withFilters(page, async () => {
      await page.getByRole('button', { name: 'Beard trim' }).click();
    });
    await expect(page).toHaveURL(/service=Beard\+trim&category=barbers/);
    await expect.poll(() => seen.requests.at(-1)).toBe(`${API}?service=Beard+trim&category=barbers&include=nextFree%2Cservices&limit=12`);
    // Popular services were fetched once for this area (cached for the sheet and the bar).
    expect(seen.categories.length).toBe(1);
    // Changing the category drops the service.
    await chooseCategory(page, 'Hair salons');
    await expect(page).not.toHaveURL(/service=/);
  });

  test('a free-text service from a shared link shows as a removable chip', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory?service=Fade');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await withFilters(page, () => page.getByRole('button', { name: 'Remove the service filter: Fade' }).click());
    await expect(page).not.toHaveURL(/service=/);
  });

  test('"When": Today, Tomorrow, a picked day, Any day; the hint explains the limits', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await withFilters(page, async () => {
      await expect(page.getByText('Only days a business can take bookings.')).toBeVisible();
      await page.getByRole('button', { name: 'Today' }).click();
    });
    await expect(page).toHaveURL(new RegExp(`when=${TODAY()}`));
    const day = clockNow().plus({ days: 5 }).toFormat('yyyy-MM-dd');
    await withFilters(page, () => pickDate(page, 'Pick a specific day', day));
    await expect(page).toHaveURL(new RegExp(`when=${day}`));
    await expect.poll(() => seen.requests.at(-1)).toContain(`when=${day}`);
    await withFilters(page, () => page.getByRole('button', { name: 'Any day' }).click());
    await expect(page).not.toHaveURL(/when=/);
  });

  test('a past or too-far day in the URL is dropped before any request', async ({ page }) => {
    const seen = await mockExplore(page);
    const yesterday = clockNow().minus({ days: 1 }).toFormat('yyyy-MM-dd');
    await page.goto(`/directory?when=${yesterday}`);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    expect(seen.requests.every((r) => !r.includes('when='))).toBe(true);
    const far = clockNow().plus({ days: 60 }).toFormat('yyyy-MM-dd');
    await page.goto(`/directory?when=${far}`);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    expect(seen.requests.every((r) => !r.includes('when='))).toBe(true);
  });

  test('the text applies only on submit, never per keystroke', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    const before = seen.requests.length;
    const box = page.getByRole('searchbox', { name: 'Service or business' });
    await box.pressSequentially('fade', { delay: 60 });
    await page.waitForTimeout(900);
    expect(seen.requests.length).toBe(before);
    await expect(page).not.toHaveURL(/search=/);
    await box.press('Enter');
    await expect(page).toHaveURL(/search=fade/);
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
    expect(seen.requests.length).toBe(before + 1);
    expect(seen.requests.at(-1)).toBe(`${API}?search=fade&include=nextFree%2Cservices&limit=12`);
    // The Search button submits too.
    await box.fill('abu');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/search=abu/);
  });

  test('quick changes are debounced to one request and the previous one is aborted', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'phone filters are a draft until Apply: nothing to debounce');
    const seen = await mockExplore(page);
    const aborted: string[] = [];
    page.on('requestfailed', (r) => {
      if (r.url().includes(API)) aborted.push(r.url());
    });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    const before = seen.requests.length;
    await page.getByRole('button', { name: 'Today' }).click();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await page.getByRole('button', { name: 'Any day' }).click();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await expect(page).toHaveURL(new RegExp(`when=${TOMORROW()}`));
    // Four clicks, one request (the last state), and no storm. Poll the request count instead of sleeping: the
    // debounce is 400 ms, so the request is out as soon as the count reaches 1 (no fixed wait on a loaded runner).
    await expect.poll(() => seen.requests.length - before, { timeout: 10_000 }).toBe(1);
    expect(seen.requests.slice(before).every((r) => r.includes(`when=${TOMORROW()}`))).toBe(true);
    expect(seen.requests.at(-1)).toContain(`when=${TOMORROW()}`);
    expect(aborted).toEqual([]);
  });

  test('a slow request is aborted by the next change and never overwrites it', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'phone filters are a draft until Apply');
    await mockExplore(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/public/directory**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('area') === 'sidon') {
        await gate;
        return route
          .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ businesses: [ALL[0]], nextCursor: null }) })
          .catch(() => undefined);
      }
      return route.fallback();
    });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await selectOption(page, 'Area', 'Sidon');
    await page.waitForTimeout(600); // the slow request is out
    await selectOption(page, 'Area', 'Beirut');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
    release();
    await page.waitForTimeout(400);
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });

  test('the same filters send the same request URL, whatever order the page URL had', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory?category=barbers&area=sidon');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await page.goto('/directory?area=sidon&category=barbers');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    expect(seen.requests).toHaveLength(2);
    expect(seen.requests[0]).toBe(seen.requests[1]);
  });

  test('Clear filters resets the URL and the controls', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory?category=barbers&area=sidon&search=abu');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(`${ORIGIN}/directory`);
    await expect(page.getByRole('searchbox', { name: 'Service or business' })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });
});

test.describe('explore: phone filters sheet', () => {
  test('Filters opens a sheet with a count badge, Apply writes the URL, Clear resets', async ({ page }) => {
    test.skip(!(await page.viewportSize()) || (await page.viewportSize())!.width >= 768, 'phone layout only');
    const seen = await mockExplore(page);
    await page.goto('/directory?area=beirut');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    const button = page.getByRole('button', { name: /^Filters/ });
    await expect(button).toContainText('1 filter applied');
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    // Edits are a draft: nothing is requested until Apply.
    const before = seen.requests.length;
    await selectOption(page, 'Category', 'Barbers');
    await sheet.getByRole('button', { name: 'Tomorrow' }).click();
    expect(seen.requests.length).toBe(before);
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`area=beirut&category=barbers&when=${TOMORROW()}`));
    await expect(button).toContainText('3 filters applied');
    await button.click();
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/directory`);
    await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0);
  });

  test('the pickers inside the sheet work with the keyboard', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 768, 'phone layout only');
    await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    const area = sheet.getByRole('combobox', { name: 'Area' });
    await area.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown'); // All areas -> Sidon... move to an area
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(area).not.toHaveText('All areas');
    // Focus came back to the field inside the sheet; Escape closes only the picker, then the sheet.
    await expect(area).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(page).not.toHaveURL(/area=/); // Escape discards the draft
  });
});

test.describe('explore: pagination', () => {
  test('a short page with a cursor keeps Show more; no auto loop; ends with "No more places."', async ({ page }) => {
    const seen = await mockExplore(page, {
      mode: {
        pages: {
          '': { businesses: [biz()], nextCursor: 'c1' },
          c1: { businesses: [], nextCursor: 'c2' },
          c2: { businesses: [fade], nextCursor: null },
        },
      },
    });
    await page.goto(`/directory?when=${TOMORROW()}`);
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await expect(page.getByTestId('explore-count')).toHaveText('Showing 1 place');
    await expect(page.getByText(/Places with free times on/)).toBeVisible();
    await page.waitForTimeout(800);
    expect(seen.requests).toHaveLength(1); // never auto-loops
    const more = page.getByRole('button', { name: 'Show more' });
    await more.click();
    // An empty short page: the button stays because a cursor exists.
    await expect(more).toBeEnabled();
    await expect(page.getByTestId('explore-end')).toHaveCount(0);
    expect(seen.requests).toHaveLength(2);
    expect(seen.requests[1]).toBe(`${API}?when=${TOMORROW()}&include=nextFree%2Cservices&limit=12&cursor=c1`);
    await more.click();
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    await expect(page.getByTestId('explore-count')).toHaveText('Showing 2 places');
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(page.getByTestId('explore-end')).toHaveText('No more places.');
    expect(seen.requests).toHaveLength(3);
  });

  test('changing filters while Show more is in flight never mixes the pages', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'inline bar (desktop) only');
    await mockExplore(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/public/directory**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cursor') === 'c1') {
        await gate;
        return route
          .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ businesses: [biz({ slug: 'late', name: 'Late Arrival' })], nextCursor: null }) })
          .catch(() => undefined);
      }
      if (!url.searchParams.get('area'))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ businesses: [biz()], nextCursor: 'c1' }) });
      return route.fallback();
    });
    await page.goto('/directory');
    await page.getByRole('button', { name: 'Show more' }).click();
    await selectOption(page, 'Area', 'Beirut');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    release();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Late Arrival' })).toHaveCount(0); // the old page 2 never lands
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
  });
});

test.describe('explore: empty and error states', () => {
  test('nothing matches: the empty state, Clear filters', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory?category=physiotherapy');
    const empty = page.getByTestId('explore-empty');
    await expect(empty.getByRole('heading', { name: 'No places match' })).toBeVisible();
    await expect(empty).toContainText('Try another area, day or service.');
    await expect(page.getByTestId('explore-live')).toHaveText('No places found');
    await empty.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/directory`);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });

  test('nothing free that day: the empty state suggests another day, and unlisted days simply are not shown', async ({ page }) => {
    await mockExplore(page, { all: [{ ...fade, freeTimes: [], nextFree: null, slug: 'x', name: 'No Times' }] });
    await page.goto(`/directory?when=${TOMORROW()}`);
    const empty = page.getByTestId('explore-empty');
    await expect(empty).toContainText('Try another day, area or service.');
    await expect(page.locator('body')).not.toContainText(/fully booked|no availability|sold out/i);
  });

  test('no business is listed at all: the original empty state with the owner link', async ({ page }) => {
    await mockExplore(page, { all: [] });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'No businesses listed yet' })).toBeVisible();
    const own = page.getByRole('link', { name: 'Own a business? List yours' });
    await expect(own).toHaveAttribute('href', '/signup');
    expect((await own.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('429 keeps the previous results visible and says to wait; Retry recovers', async ({ page }) => {
    const seen = await mockExplore(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    seen.setMode({ status: 429 });
    await chooseArea(page, 'Beirut');
    const alert = page.getByTestId('explore-error');
    await expect(alert).toContainText('Too many searches. Please wait a minute.');
    await expect(alert).toContainText('Showing your previous results.');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible(); // still there
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    seen.setMode({});
    // After a 429 the button waits 10 s (with a countdown) before it can fire again.
    const retry = alert.getByRole('button');
    await expect(retry).toBeDisabled();
    await expect(retry).toHaveText(/^Try again in (10|9|8) s$/);
    const requestsBefore = seen.requests.length;
    await retry.click({ force: true }).catch(() => undefined);
    expect(seen.requests.length).toBe(requestsBefore); // a disabled button sends nothing
    // One second at a time: each tick re-renders and only then schedules the next one.
    for (let i = 0; i < 3; i += 1) await page.clock.runFor(1000);
    await expect(retry).toHaveText(/^Try again in [4-7] s$/); // the countdown moves
    await expect(async () => {
      await page.clock.runFor(1000);
      await expect(retry).toBeEnabled({ timeout: 300 });
    }).toPass({ timeout: 15_000 });
    await expect(retry).toHaveText('Try again');
    await retry.click();
    await expect(page.getByTestId('explore-error')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });

  test('a server error (not a 429) can be retried at once', async ({ page }) => {
    const seen = await mockExplore(page, { mode: { status: 500 } });
    await page.goto('/directory');
    const retry = page.getByTestId('explore-error').getByRole('button');
    await expect(retry).toHaveText('Try again');
    await expect(retry).toBeEnabled();
    seen.setMode({});
    await retry.click();
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });

  test('a stale error banner does not return when the filters come back to a failed URL (A, B, A)', async ({
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the inline bar applies filters at once');
    const seen = await mockExplore(page, { mode: { status: 500 } });
    await page.goto('/directory?area=sidon'); // A fails
    await expect(page.getByTestId('explore-error')).toBeVisible();
    seen.setMode({});
    await chooseArea(page, 'Beirut'); // B works
    await expect(page.getByTestId('explore-error')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    // Back to A: its request hangs, so the old failure must not be shown while it runs.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let hits = 0;
    await page.route('**/api/public/directory**area=sidon**', async (route) => {
      hits += 1;
      await gate;
      await route.fallback().catch(() => undefined);
    });
    seen.setMode({ status: 500 }); // when it finally answers, it fails again
    await chooseArea(page, 'Sidon');
    await expect.poll(() => hits).toBe(1);
    await expect(page.getByTestId('explore-error')).toHaveCount(0);
    release();
    await expect(page.getByTestId('explore-error')).toBeVisible(); // the NEW failure does show
  });

  test('a server error on the first load shows the error with Retry', async ({ page }) => {
    const seen = await mockExplore(page, { mode: { status: 500 } });
    await page.goto('/directory');
    const alert = page.getByTestId('explore-error');
    await expect(alert).toContainText('We could not load places');
    await expect(page.getByTestId('directory-skeleton')).toHaveCount(0);
    seen.setMode({});
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
  });

  test('a failed Show more keeps the list and offers another try', async ({ page }) => {
    await mockExplore(page, {
      mode: { pages: { '': { businesses: [biz()], nextCursor: 'c1' } } },
    });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await page.route('**/api/public/directory**cursor=c1**', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x' } }) }),
    );
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Too many searches' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more' })).toBeEnabled();
  });
});

test.describe('explore: layout', () => {
  for (const [width, height] of [
    [360, 800],
    [768, 900],
    [1440, 900],
  ] as const) {
    test(`no page overflow and 44 px targets at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockExplore(page);
      await page.goto('/directory?category=barbers');
      await expect(page.getByRole('heading', { name: 'Abu Karam Barbershop' })).toBeVisible();
      await expectNoPageOverflow(page);
      for (const name of ['Search', 'View & book at Abu Karam Barbershop']) {
        const el = page.getByRole(name === 'Search' ? 'button' : 'link', { name, exact: name === 'Search' });
        expect((await el.first().boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
      }
      if (width < 768) {
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
        await expectNoPageOverflow(page);
        for (const name of ['Area', 'Category']) {
          expect((await page.getByRole('combobox', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

  test('the skeleton reserves space: the first result does not move the heading', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory');
    const h1 = page.getByRole('heading', { level: 1 });
    const top = (await h1.boundingBox())!.y;
    await expect(page.getByRole('heading', { name: 'Fade Lab' })).toBeVisible();
    expect((await h1.boundingBox())!.y).toBe(top);
  });
});

test.describe('explore: Arabic', () => {
  test('RTL, translated, Latin digits, mirrored, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockExplore(page);
    await page.goto('/directory?category=barbers');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'استكشف الأنشطة التجارية' })).toBeVisible();
    const c = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Abu Karam Barbershop' }) });
    await expect(c).toContainText('الحلاقون · صيدا');
    await expect(c).toContainText('متاح اليوم');
    await expect(c.getByRole('link', { name: /15:30/ })).toBeVisible();
    await expect(c.getByRole('link', { name: /^عرض واحجز لدى/ })).toBeVisible();
    await expect(page.getByTestId('explore-count')).toHaveText(/^عرض /);
    // Digits stay Latin everywhere on the cards.
    expect(await page.getByRole('main').innerText()).not.toMatch(/[٠-٩]/);
    await expect(page.getByText('تُعرض الأوقات بالتوقيت المحلي لكل نشاط.')).toBeVisible();
    const phoneButton = page.getByRole('button', { name: /^الفلاتر/ });
    if (await phoneButton.isVisible()) await phoneButton.click();
    expect(await pickerText(page, 'المنطقة')).toBe('كل المناطق');
    expect(await pickerText(page, 'الفئة')).toBe('الحلاقون');
    if (await phoneButton.isVisible()) await page.keyboard.press('Escape');
    await expectNoPageOverflow(page);
  });

  test('Arabic names and mixed text are isolated and the avatar has initials', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockExplore(page, { all: [biz({ slug: 'ar', name: 'صالون نور', address: 'شارع الحمرا 12' })] });
    await page.goto('/directory');
    const c = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'صالون نور' }) });
    await expect(c).toBeVisible();
    await expect(c).toContainText('صن');
    await expectNoPageOverflow(page);
  });
});

test.describe('explore: follow-ups from the PR #83 review', () => {
  test('a service link from the home page highlights its chip', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/directory?category=barbers&service=Beard+trim');
    if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole('button', { name: /^Filters/ }).click();
    const group = page.getByRole('group', { name: 'Service' });
    await expect(group.getByRole('button', { name: 'Beard trim' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'Haircut' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('two services with the same name on one card both render', async ({ page }) => {
    await mockExplore(page, {
      all: [
        biz({
          services: [
            { name: 'Haircut', durationMin: 30, price: 8 },
            { name: 'Haircut', durationMin: 45, price: 12 },
          ],
        }),
      ],
    });
    await page.goto('/directory');
    await expect(page.getByTestId('card-services').getByRole('listitem')).toHaveCount(2);
  });

  test('Today and Tomorrow are Beirut days even when the device calendar is a day behind', async ({ browser }) => {
    // 4 Nov 10:00 in Beirut is 21:00 on 3 Nov in Pago Pago (UTC-11): the device says yesterday.
    const context = await browser.newContext({ timezoneId: 'Pacific/Pago_Pago' });
    const page = await context.newPage();
    await mockExplore(page);
    await page.goto('/directory');
    await withFilters(page, () => page.getByRole('button', { name: 'Today', exact: true }).click());
    expect(clockNow().setZone('Asia/Beirut').toFormat('yyyy-MM-dd')).toBe('2026-11-04');
    await expect(page).toHaveURL(/when=2026-11-04/);
    await withFilters(page, () => page.getByRole('button', { name: 'Tomorrow', exact: true }).click());
    await expect(page).toHaveURL(/when=2026-11-05/);
    await context.close();
  });

  test('"Today" moves to the new day when the tab stays open past midnight in Beirut', async ({ page }) => {
    await mockExplore(page);
    await page.clock.setSystemTime(new Date('2026-11-04T21:59:30Z')); // 23:59:30 in Beirut
    await page.goto('/directory');
    await withFilters(page, () => page.getByRole('button', { name: 'Today', exact: true }).click());
    await expect(page).toHaveURL(/when=2026-11-04/);
    await page.clock.runFor(60_000); // past midnight
    // Yesterday is no longer a choice: the filter is dropped, and "Today" now means the new day.
    await withFilters(page, () => page.getByRole('button', { name: 'Today', exact: true }).click());
    await expect(page).toHaveURL(/when=2026-11-05/);
  });
});
