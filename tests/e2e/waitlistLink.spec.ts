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
    await expect(page.getByLabel('From day')).toHaveAttribute('data-value', firstBookableDay());
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
    await page.getByLabel('Email', { exact: true }).fill('maya@example.test');
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

/** WCAG contrast of the first full-day pill's weekday and date number against its own computed background. */
async function fullPillContrast(page: Page) {
  return fullPills(page)
    .first()
    .evaluate((pill) => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgb = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi! + 0.05) / (lo! + 0.05);
      };
      const bg = rgb(getComputedStyle(pill).backgroundColor);
      const texts = [...pill.querySelectorAll('span')].map((s) => ratio(rgb(getComputedStyle(s).color), bg));
      const page = rgb(getComputedStyle(document.body).backgroundColor);
      const border = rgb(getComputedStyle(pill).borderTopColor);
      return { texts, border: ratio(border, page), checked: pill.getAttribute('aria-checked') === 'true' };
    });
}

for (const [name, viewport] of [['360', { width: 360, height: 640 }], ['desktop 1440', { width: 1440, height: 900 }]] as const) {
  for (const locale of ['en', 'ar']) {
    test(`F63 contrast: full-day pills keep 4.5:1 text, ${name}, ${locale}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
      await page.setViewportSize(viewport);
      await mockPublicApi(page);
      await toTimeStep(page);
      const idle = await fullPillContrast(page);
      expect(idle.checked).toBe(false);
      expect(idle.texts).toHaveLength(2);
      for (const r of idle.texts) expect(r, 'unselected full day text').toBeGreaterThanOrEqual(4.5);
      // Selected full day: outlined, ink text, brand border (3:1 against the page).
      await fullPills(page).first().click();
      await page.waitForTimeout(400); // colours animate over 200 ms
      const picked = await fullPillContrast(page);
      expect(picked.checked).toBe(true);
      for (const r of picked.texts) expect(r, 'selected full day text').toBeGreaterThanOrEqual(4.5);
      expect(picked.border, 'selected full day outline').toBeGreaterThanOrEqual(3);
      // Hover only changes the border to brand, so the text contrast above holds there too; focus uses the global ring.
      await fullPills(page).first().hover();
      await page.waitForTimeout(400);
      for (const r of (await fullPillContrast(page)).texts) expect(r).toBeGreaterThanOrEqual(4.5);
    });
  }
}

test('F63 desktop width: the full-day pill and the waitlist link render and work at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPublicApi(page);
  await toTimeStep(page);
  const link = page.getByRole('link', { name: EN_LINK });
  await expect(link).toHaveCount(1);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await fullPills(page).first().click();
  await expect(page.getByText(/^No free times on /)).toBeVisible();
  await expect(page.getByRole('link', { name: /Join the waitlist/ })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test.describe('the waitlist page ignores a bad ?from=', () => {
  for (const [label, from] of [['garbage', 'garbage'], ['a past date', '2020-01-01'], ['an impossible date', '2026-02-31']] as const) {
    test(`${label}: renders with the default dates`, async ({ page }) => {
      await mockPublicApi(page);
      await mockJoinWaitlist(page);
      await page.goto(`${WL}?service=${IDS.haircut}&from=${from}`);
      await expect(page.getByLabel('Service')).toHaveValue(IDS.haircut);
      // The default range starts today in the business timezone, never the bad value.
      await expect(page.getByLabel('From day')).toHaveAttribute('data-value', businessToday().toISODate()!);
      await expect(page.getByLabel('From day')).not.toHaveAttribute('data-value', from);
    });
  }

  test('a valid day inside the window starts the range there', async ({ page }) => {
    await mockPublicApi(page);
    await mockJoinWaitlist(page);
    const day = firstBookableDay();
    await page.goto(`${WL}?service=${IDS.haircut}&from=${day}`);
    await expect(page.getByLabel('From day')).toHaveAttribute('data-value', day);
  });
});
