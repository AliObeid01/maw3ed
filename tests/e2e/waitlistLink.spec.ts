import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { businessToday, firstBookableDay, IDS, mockPublicApi, SLUG } from './helpers/publicMock';
import { mockJoinWaitlist } from './helpers/waitlistMock';

// F63: "Not the day or time you want? Join the waitlist" on the time step, and full days that can be chosen.
// Self-contained: /api/public (catalogue, slots) and the join POST are answered by page.route.

const BOOK = `/b/${SLUG}`;
const WL = `/b/${SLUG}/waitlist`;
const ALL_TIMES = ['09:00', '09:30', '10:30', '14:00', '15:30'];
const EN_LINK = 'Not the day or time you want? Join the waitlist';
const AR_LINK = 'ليس اليوم أو الوقت الذي تريده؟ انضم إلى قائمة الانتظار';

test.skip(({ isMobile }) => !isMobile, 'a phone flow');

async function toTimeStep(page: Page, staff: RegExp = /Anyone available|أي موظف متاح/) {
  await page.goto(BOOK);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: staff }).click();
}

const fullPills = (page: Page) => page.getByRole('radio', { name: /no free times|لا توجد أوقات فارغة/ });

test.describe('English', () => {
  test('shows one quiet waitlist link under the free times, with service and from', async ({ page }) => {
    await mockPublicApi(page);
    await toTimeStep(page);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();

    const link = page.getByRole('link', { name: EN_LINK });
    await expect(link).toHaveCount(1);
    // Below the times, never above them.
    const [slot, linkBox] = await Promise.all([
      page.getByRole('radio', { name: '09:00', exact: true }).first().boundingBox(),
      link.boundingBox(),
    ]);
    expect(linkBox!.y).toBeGreaterThan(slot!.y);
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);

    // The first bookable day is the selected one and is what the link asks for.
    const day = firstBookableDay();
    const href = new URL((await link.getAttribute('href'))!, 'http://x');
    expect(href.pathname).toBe(WL);
    expect(href.searchParams.get('service')).toBe(IDS.haircut);
    expect(href.searchParams.has('staff')).toBe(false); // "anyone" is not a person
    expect(href.searchParams.get('from')).toBe(day);
    expect([...href.searchParams.keys()].sort()).toEqual(['from', 'service']);
  });

  test('carries the chosen person, and the link opens the waitlist form with the choice prefilled', async ({ page }) => {
    await mockPublicApi(page);
    await mockJoinWaitlist(page);
    await toTimeStep(page, /Lina/);
    await page.getByRole('link', { name: EN_LINK }).click();
    await expect(page).toHaveURL(new RegExp(`${WL}\\?service=${IDS.haircut}&staff=${IDS.lina}&from=\\d{4}-\\d{2}-\\d{2}$`));
    await expect(page.getByLabel('Service')).toHaveValue(IDS.haircut);
    await expect(page.getByLabel('With')).toHaveValue(IDS.lina);
    // The wanted day starts the range on the form.
    await expect(page.getByLabel('From day')).toHaveValue(firstBookableDay());
  });

  test('a chosen full day says so, offers the waitlist prominently and keeps Continue disabled', async ({ page }) => {
    await mockPublicApi(page);
    await toTimeStep(page);
    const full = fullPills(page).first();
    await expect(full).toBeVisible();
    // Dimmed full days stay selectable (radio, not disabled) so the empty-day state can be shown.
    await expect(full).toBeEnabled();
    await expect(full).toHaveAttribute('aria-checked', 'false');
    await full.click();
    await expect(full).toBeChecked();

    const label = (await full.getAttribute('aria-label'))!.replace(/,\s*no free times$/, '');
    await expect(page.getByText(`No free times on ${label}`)).toBeVisible();
    await expect(page.getByRole('radio', { name: '09:00', exact: true })).toHaveCount(0);
    // Exactly one waitlist link, now a secondary button (not the quiet link), still with the day.
    const links = page.getByRole('link', { name: /Join the waitlist/ });
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText('Join the waitlist');
    const href = new URL((await links.getAttribute('href'))!, 'http://x');
    expect(href.searchParams.get('service')).toBe(IDS.haircut);
    // Today is the first pill and has no bookable time in the mock (minimum notice), so it is the full day we chose.
    expect(href.searchParams.get('from')).toBe(businessToday().toISODate());
    await expect(page.getByRole('button', { name: 'Continue' }).filter({ visible: true })).toBeDisabled();
  });

  test('full days move with the arrow keys like every other day', async ({ page }) => {
    await mockPublicApi(page);
    await toTimeStep(page);
    const open = page.getByRole('radio', { checked: true });
    await open.focus();
    // Walk right until a full day is focused: it is selected (a radio group selects on arrow).
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('ArrowRight');
      if ((await page.locator(':focus').getAttribute('aria-label'))?.includes('no free times')) break;
    }
    await expect(page.locator(':focus')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/^No free times on /)).toBeVisible();
  });

  test('no duplicate: with no free time at all the existing block is the only waitlist link', async ({ page }) => {
    await mockPublicApi(page, { bookedTimes: ALL_TIMES });
    await toTimeStep(page);
    await expect(page.getByText(/No free times in the next/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Join the waitlist/ })).toHaveCount(1);
    await expect(page.getByRole('link', { name: EN_LINK })).toHaveCount(0);
  });

  test('no duplicate after a lost race: only the existing "slot just taken" link', async ({ page }) => {
    await mockPublicApi(page, { takeSlotOnFirstBook: true });
    await toTimeStep(page);
    await page.getByRole('radio', { name: '09:00', exact: true }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Full name').fill('Maya');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByRole('button', { name: 'Confirm booking' }).filter({ visible: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'was just taken' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Join the waitlist/ })).toHaveCount(1);
    await expect(page.getByRole('link', { name: EN_LINK })).toHaveCount(0);
  });

  test('at 360x640 the link never pushes Continue or the summary bar off screen, and is reachable', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await mockPublicApi(page);
    await toTimeStep(page);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
    await page.getByRole('radio', { name: '09:00', exact: true }).first().click();

    const bar = page.locator('.sticky-summary-bar');
    const cta = bar.getByRole('button', { name: 'Continue' });
    await expect(cta).toBeEnabled();
    const cb = await cta.boundingBox();
    expect(cb!.y + cb!.height, 'Continue is fully inside the 640 px viewport').toBeLessThanOrEqual(640);
    const barBox = await bar.boundingBox();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(640 + 1);

    // The link is below the times and can be scrolled clear of the fixed bar (the footer reserves its height).
    const link = page.getByRole('link', { name: EN_LINK });
    await link.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lb = await link.boundingBox();
    const bb = await bar.boundingBox();
    expect(lb!.y + lb!.height).toBeLessThanOrEqual(bb!.y + 1);
    // The bar did not move because the link exists.
    const cb2 = await cta.boundingBox();
    expect(cb2!.y).toBe(cb!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('Arabic', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  });

  test('shows the link in Arabic, right to left, and the full-day state', async ({ page }) => {
    await mockPublicApi(page);
    await toTimeStep(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const link = page.getByRole('link', { name: AR_LINK });
    await expect(link).toHaveCount(1);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await fullPills(page).first().click();
    await expect(page.getByText(/^لا توجد أوقات متاحة يوم /)).toBeVisible();
    await expect(page.getByRole('link', { name: /الانضمام إلى قائمة الانتظار/ })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
