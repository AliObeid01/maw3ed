import { type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import {
  blockStorage,
  readStored,
  saved,
  savedPast,
  seedBookings,
  seedRaw,
  STORAGE_KEY,
} from './helpers/myBookings';
import { linkBody, mockLinkApi, mockPublicApi, SLUG } from './helpers/publicMock';
import { freezeClock } from './helpers/clock';

// "My bookings on this device" (/my-bookings, the header, tab bar and footer entries, the per-business strip).
// Self-contained: the booking and link endpoints are answered by page.route on the frozen clock; localStorage is
// seeded with fake entries. Set MB_SHOTS=<dir> to write screenshots.

const SHOTS = process.env.MB_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const cardFor = (page: Page, name: string) =>
  page.getByTestId('upcoming-card').filter({ hasText: name });
const upcomingHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Upcoming' });
const pastHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Previous visits' });

test.describe('first-time visitor', () => {
  test('sees no My bookings entry anywhere, and an honest empty page', async ({ page, isMobile }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My bookings' })).toHaveCount(0);
    if (isMobile) await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(3);

    await page.goto('/my-bookings');
    await expect(page.getByRole('heading', { level: 1, name: 'My bookings' })).toBeVisible();
    await expect(page.getByText('Bookings made on this device. No account needed.')).toBeVisible();
    const empty = page.getByTestId('my-bookings-empty');
    await expect(empty.getByRole('heading', { name: 'Your bookings will appear here.' })).toBeVisible();
    await expect(empty.getByRole('link', { name: 'Explore businesses' })).toHaveAttribute('href', '/directory');
    await expect(page.getByRole('button', { name: 'Forget my bookings on this device' })).toHaveCount(0);
    // The page itself is not indexable.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await shot(page, 'empty');
  });

  test('home FAQ answers "Can I see my bookings later?" honestly', async ({ page }) => {
    await page.goto('/');
    const faq = page.getByTestId('faq');
    await expect(faq.getByText('Can I see my bookings later?')).toBeAttached();
    await faq.getByText('Can I see my bookings later?').click();
    await expect(
      faq.getByText('Yes, on the same device and browser: open My bookings. Bookings are saved on this device only.'),
    ).toBeVisible();
  });
});

test.describe('saving after a booking', () => {
  test('a booking made in this browser is listed, with no name, phone or email stored', async ({
    page,
    isMobile,
  }) => {
    await mockPublicApi(page);
    await mockLinkApi(page, { act: 'view' });
    await page.goto(`/b/${SLUG}`);
    await page.getByRole('button', { name: /Haircut/ }).click();
    await page.getByRole('button', { name: /Anyone available/ }).click();
    const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
    await slot.click();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Before booking nothing is saved and nothing is shown.
    expect(await readStored(page)).toBeNull();
    await page.getByLabel('Full name').fill('Maya Haddad');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByLabel('Email', { exact: true }).fill('maya@example.test');
    await page.getByRole('button', { name: 'Confirm booking' }).last().click();

    await expect(page.getByTestId('saved-hint')).toContainText('Saved on this device');
    const stored = (await readStored(page))!;
    expect(stored).toContain('mock-manage-token');
    expect(stored).toContain('K7M2QX');
    for (const secret of ['Maya', 'Haddad', '71 234 567', '234567', 'maya@example.test', '@']) {
      expect(stored, `stored value must not contain ${secret}`).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(stored).entries[0]).sort()).toEqual(
      [
        'businessName', 'endAt', 'reference', 'savedAt', 'serviceName', 'slug', 'staffName', 'startAt', 'timezone', 'token',
      ].sort(),
    );

    // The entry points appear now (after the booking), not before.
    await page.goto('/');
    if (isMobile) {
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My bookings' })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'My bookings' })).toBeVisible();
    }
    await expect(page.locator('footer').getByRole('link', { name: 'My bookings' })).toBeAttached();

    await page.goto('/my-bookings');
    const card = cardFor(page, 'Studio Nour');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Haircut.? with/);
    await expect(card).toContainText(/Reference .?K7M2QX/);
    await expect(card.getByRole('link', { name: 'View booking page' })).toHaveAttribute('href', `/b/${SLUG}`);
    await expect(card.getByTestId('status-chip')).toHaveText('Booked');
  });

  test('the booking page shows a "Your bookings here" strip only for a business with saved bookings', async ({
    page,
  }) => {
    await mockPublicApi(page);
    await seedBookings(page, [saved({ slug: 'some-other-place', token: 'tok-x', reference: 'OTH111' })]);
    await page.goto(`/b/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    await expect(page.getByTestId('your-bookings-strip')).toHaveCount(0);

    const here = await page.context().newPage();
    await mockPublicApi(here);
    await here.addInitScript(
      ([key, value]) => localStorage.setItem(key!, value!),
      [STORAGE_KEY, JSON.stringify({ v: 1, entries: [saved({ slug: SLUG })] })],
    );
    await here.goto(`/b/${SLUG}`);
    const strip = here.getByTestId('your-bookings-strip');
    await expect(strip).toContainText('Your bookings here');
    await expect(strip).toContainText('1 booking on this device');
    await expect(strip).toHaveAttribute('href', '/my-bookings');
    expect((await strip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('upcoming bookings (live)', () => {
  test('Confirm then Cancel through the link endpoints; a cancelled booking is previous on the next visit', async ({
    page,
  }) => {
    await seedBookings(page, [saved()]);
    const { calls } = await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    const card = cardFor(page, 'Studio Nour');
    await expect(card.getByTestId('status-chip')).toHaveText('Booked');
    // Opening the page never changes anything: only GETs.
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(calls[0]!.token).toBe('tok-upcoming-1');
    // Wed 4 Nov + 2 days, 10:30 Beirut, 24 h, Latin digits.
    await expect(card).toContainText(/Fri 6 Nov · .?10:30 – 11:00/);

    await card.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(card.getByTestId('status-chip')).toHaveText('Confirmed');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', token: 'tok-upcoming-1', body: { action: 'confirm' } },
    ]);
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);

    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this appointment?' });
    await expect(dialog).toContainText('Free cancellation until');
    await shot(page, 'cancel-sheet');
    await dialog.getByRole('button', { name: 'Yes, cancel appointment' }).click();
    await expect(card.getByTestId('status-chip')).toHaveText('Cancelled');
    await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Book again' })).toBeVisible();
    // It stays where the visitor saw it for this page view ...
    await expect(upcomingHeading(page)).toBeVisible();
    await expect(pastHeading(page)).toHaveCount(0);

    // ... and is under "Previous visits" from the next visit on.
    await page.reload();
    await expect(pastHeading(page)).toBeVisible();
    await expect(page.getByTestId('past-card')).toContainText('Studio Nour');
    await expect(page.getByTestId('past-card')).toContainText('Cancelled');
    await expect(page.getByText('Nothing coming up.')).toBeVisible();
  });

  test('the cancel sheet warns about a late cancellation (what the API says)', async ({ page }) => {
    await seedBookings(page, [saved()]);
    await mockLinkApi(page, { act: 'view', pastCutoff: true });
    await page.goto('/my-bookings');
    const card = cardFor(page, 'Studio Nour');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this appointment?' });
    await expect(dialog).toContainText('This is a late cancellation.');
    await expect(dialog).toContainText('Studio Nour may charge a fee.');
    await dialog.getByRole('button', { name: 'Keep my appointment' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByTestId('status-chip')).toHaveText('Booked');
  });

  test('offers only what the API allows (a confirmed booking has no Confirm)', async ({ page }) => {
    await seedBookings(page, [saved()]);
    await mockLinkApi(page, { act: 'view', status: 'CONFIRMED' });
    await page.goto('/my-bookings');
    const card = cardFor(page, 'Studio Nour');
    await expect(card.getByTestId('status-chip')).toHaveText('Confirmed');
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  });

  test('an expired or rejected link moves the booking to Previous visits quietly', async ({ page }) => {
    await seedBookings(page, [
      saved(),
      saved({ token: 'tok-404', reference: 'GON404', serviceName: 'Colour' }, 3),
    ]);
    await mockLinkApi(page, { act: 'view', gone: { 'tok-upcoming-1': 410, 'tok-404': 404 } });
    await page.goto('/my-bookings');
    await expect(pastHeading(page)).toBeVisible();
    await expect(page.getByTestId('past-card')).toHaveCount(2);
    await expect(page.getByText('Nothing coming up.')).toBeVisible();
    // Never an error: no banner, no "could not refresh", no status chip on a previous visit.
    await expect(page.getByText('Could not refresh')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveCount(0);
    await expect(page.getByTestId('past-card').first().getByTestId('status-chip')).toHaveCount(0);
    expect(JSON.parse((await readStored(page))!).entries.map((e: { ended?: string }) => e.ended)).toEqual([
      'closed',
      'closed',
    ]);
    // Previous visits come from the local summary only and offer Book again.
    await expect(page.getByTestId('past-card').first().getByRole('link', { name: 'Book again' })).toHaveAttribute(
      'href',
      `/b/${SLUG}`,
    );
  });

  test('a network error keeps the saved summary, says Could not refresh, and Retry recovers', async ({ page }) => {
    await seedBookings(page, [saved()]);
    await mockLinkApi(page, { act: 'view' });
    let down = true;
    await page.route('**/api/links/tok-upcoming-1', (route) =>
      down ? route.abort('connectionreset') : route.fallback(),
    );
    await page.goto('/my-bookings');
    const card = cardFor(page, 'Studio Nour');
    await expect(card.getByText('Could not refresh')).toBeVisible();
    await expect(card).toContainText(/Haircut.? with/);
    await expect(card).toContainText(/Fri 6 Nov · .?10:30 – 11:00/);
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    const retry = card.getByRole('button', { name: 'Retry' });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, 'could-not-refresh');
    down = false;
    await retry.click();
    await expect(card.getByTestId('status-chip')).toHaveText('Booked');
    await expect(card.getByText('Could not refresh')).toHaveCount(0);
  });

  test('reads at most 3 links at a time', async ({ page }) => {
    await freezeClock(page);
    await seedBookings(
      page,
      Array.from({ length: 7 }, (_, i) =>
        saved({ token: `tok-${i}`, reference: `REF00${i}`, serviceName: `Service ${i}` }, 2 + i),
      ),
    );
    let running = 0;
    let peak = 0;
    let total = 0;
    await page.route('**/api/links/**', async (route) => {
      running += 1;
      total += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 120));
      running -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(linkBody({ act: 'view' })),
      });
    });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('status-chip')).toHaveCount(7);
    expect(total).toBe(7);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

test.describe('Forget, blocked and corrupted storage', () => {
  test('Forget clears everything, hides the entry points and the list', async ({ page, isMobile }) => {
    await seedBookings(page, [saved(), savedPast()]);
    await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('past-card')).toHaveCount(1);
    const nav = isMobile
      ? page.getByRole('navigation', { name: 'Main' })
      : page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: 'My bookings' })).toBeVisible();
    // What is saved, said plainly.
    await expect(
      page.getByText('Only booking details, never your name, phone or email. Anyone using this browser can see this list.'),
    ).toBeVisible();
    await expect(page.getByText('On a shared computer, forget your bookings when you are done.')).toBeVisible();

    await page.getByRole('button', { name: 'Forget my bookings on this device' }).click();
    const sheet = page.getByRole('dialog', { name: 'Forget your bookings on this device?' });
    await shot(page, 'forget-sheet');
    await sheet.getByRole('button', { name: 'Keep them' }).click();
    expect(await readStored(page)).not.toBeNull();
    await page.getByRole('button', { name: 'Forget my bookings on this device' }).click();
    await sheet.getByRole('button', { name: 'Forget bookings' }).click();

    await expect(page.getByTestId('my-bookings-empty')).toBeVisible();
    await expect(page.getByTestId('upcoming-card')).toHaveCount(0);
    await expect(page.getByTestId('past-card')).toHaveCount(0);
    expect(await readStored(page)).toBeNull();
    await expect(nav.getByRole('link', { name: 'My bookings' })).toHaveCount(0);
    await expect(page.locator('footer').getByRole('link', { name: 'My bookings' })).toHaveCount(0);
  });

  test('blocked storage: the page works and says so', async ({ page }) => {
    await blockStorage(page);
    await page.goto('/my-bookings');
    const notice = page.getByTestId('storage-blocked');
    await expect(notice).toContainText('Your browser is blocking saved bookings');
    await expect(page.getByTestId('my-bookings-empty')).toBeVisible();
    await shot(page, 'blocked');
    // Booking is not affected by it.
    await mockPublicApi(page);
    await page.goto(`/b/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    await expect(page.getByTestId('your-bookings-strip')).toHaveCount(0);
  });

  test('corrupted storage does not break the page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedRaw(page, '{"v":1,"entries":[{"token":1},null,');
    await page.goto('/my-bookings');
    await expect(page.getByTestId('my-bookings-empty')).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'My bookings' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('good entries survive next to bad ones', async ({ page }) => {
    await mockLinkApi(page, { act: 'view' });
    await seedRaw(page, JSON.stringify({ v: 1, entries: [{ nope: true }, saved(), 'x'] }));
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card')).toHaveCount(1);
  });
});

test.describe('entry points and layout', () => {
  test('the phone tab bar goes from 3 to 4 tabs without moving the page (and across tabs)', async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the tab bar is a phone control');
    await page.goto('/');
    const bar = page.getByRole('navigation', { name: 'Main' });
    await expect(bar.getByRole('link')).toHaveCount(3);
    const h1 = page.getByRole('heading', { level: 1 });
    const before = {
      bar: await bar.boundingBox(),
      h1: await h1.boundingBox(),
      main: await page.locator('main').boundingBox(),
    };

    // Another tab of the same browser saves a booking: the `storage` event updates this tab live.
    const other = await context.newPage();
    await other.goto('/privacy');
    await other.evaluate(
      ([key, value]) => localStorage.setItem(key!, value!),
      [STORAGE_KEY, JSON.stringify({ v: 1, entries: [saved()] })],
    );
    await expect(bar.getByRole('link')).toHaveCount(4);
    await shot(page, 'home-tabbar-4');

    const after = {
      bar: await bar.boundingBox(),
      h1: await h1.boundingBox(),
      main: await page.locator('main').boundingBox(),
    };
    expect(after.bar).toEqual(before.bar); // same box: only the tabs inside change width
    expect(after.h1).toEqual(before.h1);
    // Everything above the footer stays where it was (the footer gains one Support link, below the fold).
    expect(after.main).toEqual(before.main);
    const boxes = await bar.getByRole('link').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, left: r.left, right: r.right };
      }),
    );
    for (const b of boxes) {
      expect(b.h).toBeGreaterThanOrEqual(44);
      expect(b.w).toBeGreaterThanOrEqual(44);
    }
    expect(Math.min(...boxes.map((b) => b.left))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

    // And back to 3 when the other tab forgets.
    await other.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await expect(bar.getByRole('link')).toHaveCount(3);
  });

  test('on /my-bookings the tab is the current page', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the tab bar is a phone control');
    await seedBookings(page, [savedPast()]);
    await page.goto('/my-bookings');
    const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My bookings' });
    await expect(link).toHaveAttribute('aria-current', 'page');
  });

  for (const [width, height] of [
    [360, 800],
    [1440, 900],
  ] as const) {
    test(`no page overflow with entries, empty and the sheet open at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await seedBookings(page, [
        saved({ businessName: 'A very long business name that keeps going and going for the wrap' }),
        saved({ token: 'tok-b', reference: 'BBB222', serviceName: 'Hydrafacial deep cleansing', staffName: 'Maryam' }, 3),
        savedPast(),
      ]);
      await mockLinkApi(page, { act: 'view' });
      await page.goto('/my-bookings');
      await expect(page.getByTestId('status-chip')).toHaveCount(2);
      await expectNoPageOverflow(page);
      for (const b of await page.getByTestId('upcoming-card').getByRole('button').all()) {
        expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      for (const l of await page.getByTestId('upcoming-card').getByRole('link').all()) {
        expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await shot(page, `list-${width}`);
      await page.getByRole('button', { name: 'Forget my bookings on this device' }).click();
      await expectNoPageOverflow(page);
    });
  }
});

test.describe('Arabic', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  });

  test('right to left, Arabic copy, Latin digits, no overflow at 360', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedBookings(page, [saved(), savedPast()]);
    await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'حجوزاتي' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'القادمة' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'زيارات سابقة' })).toBeVisible();
    const card = page.getByTestId('upcoming-card');
    await expect(card).toContainText('10:30 – 11:00');
    await expect(card).toContainText('ABC234');
    await expect(card.getByRole('button', { name: 'تأكيد', exact: true })).toBeVisible();
    await expect(card.getByTestId('status-chip')).toHaveText('محجوز');
    expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩]/);
    await expectNoPageOverflow(page);
    await shot(page, 'ar-list-360');
  });

  test('empty, blocked and the Forget sheet in Arabic at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await blockStorage(page);
    await page.goto('/my-bookings');
    await expect(page.getByTestId('storage-blocked')).toContainText('متصفحك يمنع حفظ الحجوزات');
    await expect(page.getByRole('heading', { name: 'ستظهر حجوزاتك هنا.' })).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, 'ar-blocked-1440');
  });

  test('the Arabic list at 1440 and the Forget sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBookings(page, [saved(), savedPast()]);
    await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card')).toBeVisible();
    await page.getByRole('button', { name: 'حذف حجوزاتي من هذا الجهاز' }).click();
    await expect(page.getByRole('dialog', { name: 'حذف حجوزاتك من هذا الجهاز؟' })).toBeVisible();
    await shot(page, 'ar-forget-1440');
  });
});
