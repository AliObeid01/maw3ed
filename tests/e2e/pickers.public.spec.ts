import { type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { expect, test } from './helpers/test';
import { clockNow } from './helpers/clock';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from './helpers/layout';
import { goToMonth, picker, pickDate, searchAndSelect, stable } from './helpers/pickers';
import { IDS, mockPublicApi, SLUG, TZ } from './helpers/publicMock';
import { mockJoinWaitlist } from './helpers/waitlistMock';

// F69-D on the public pages and sign-up, against the production build (real strict CSP: the test fixture fails on any
// Content-Security-Policy violation, so every picker opened here also proves it works under the nonce CSP).
// Phone (Pixel 5) gets the bottom sheet, desktop the anchored popover.

const WL = `/b/${SLUG}/waitlist`;
const today = () => clockNow().setZone(TZ);
const ymd = (d: DateTime) => d.toFormat('yyyy-MM-dd');
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function openWaitlist(page: Page) {
  await mockPublicApi(page, {});
  await mockJoinWaitlist(page, {});
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await expect(page.getByRole('heading', { name: 'Join the waitlist', level: 2 })).toBeVisible();
}

test('Select opens as a sheet on a phone and a popover on desktop, fits, scrolls and returns focus', async ({ page }) => {
  await openWaitlist(page);
  const trigger = await stable(page, 'Service');
  await trigger.click();
  const surface = page.getByRole('dialog', { name: 'Service', exact: true });
  await expect(surface).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await surface.boundingBox())!;
  const field = (await trigger.boundingBox())!;
  if (isPhone(page)) {
    expect(box.y + box.height, 'bottom sheet on the bottom edge').toBeGreaterThanOrEqual(vp.height - 1);
    expect(box.height).toBeLessThanOrEqual(vp.height * 0.9);
  } else {
    expect(box.y, 'popover under the field').toBeGreaterThanOrEqual(field.y + field.height);
    expect(Math.abs(box.x - field.x)).toBeLessThanOrEqual(12);
  }
  await expectNoHorizontalOverflow(surface, 'service picker');
  await expectNoPageOverflow(page);
  await expect(surface.getByRole('option', { selected: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('waitlist days: From starts today, To follows From and is capped at 31 days (min / max)', async ({ page }) => {
  await openWaitlist(page);
  const t0 = today();
  // From: nothing before today is selectable.
  await picker(page, 'From day').click();
  await expect(page.locator(`[data-ymd="${ymd(t0)}"]`)).toBeEnabled();
  if (t0.day > 1) await expect(page.locator(`[data-ymd="${ymd(t0.minus({ days: 1 }))}"]`)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // To: from the chosen From day up to 30 days later (31 days in all).
  const from = t0.plus({ days: 2 });
  await pickDate(page, 'From day', ymd(from));
  await expect(picker(page, 'From day')).toHaveAttribute('data-value', ymd(from));
  await picker(page, 'To day').click();
  await goToMonth(page, ymd(from));
  await expect(page.locator(`[data-ymd="${ymd(from)}"]`)).toBeEnabled();
  await expect(page.locator(`[data-ymd="${ymd(from.minus({ days: 1 }))}"]`)).toBeDisabled();
  const last = from.plus({ days: 30 });
  await goToMonth(page, ymd(last));
  await expect(page.locator(`[data-ymd="${ymd(last)}"]`)).toBeEnabled();
  await expect(page.locator(`[data-ymd="${ymd(last.plus({ days: 1 }))}"]`)).toBeDisabled();
  await page.locator(`[data-ymd="${ymd(last)}"]`).click();
  await expect(picker(page, 'To day')).toHaveAttribute('data-value', ymd(last));
  await expect(picker(page, 'To day')).toHaveAttribute('aria-expanded', 'false');
});

test('country code: searchable, filters by name and dial code, keyboard Enter chooses', async ({ page }) => {
  await openWaitlist(page);
  const trigger = picker(page, 'Country code');
  await expect(trigger).toHaveText('+961');
  await searchAndSelect(page, 'Country code', 'syria', /\+963/);
  await expect(trigger).toHaveAttribute('data-value', '+963');
  await expect(trigger).toHaveText('+963');
  await expect(trigger).toBeFocused();
  // Keyboard only: open, type a dial code, Enter.
  await trigger.press('Enter');
  const search = page.getByRole('combobox', { name: 'Search', exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.type('+97');
  await expect(page.getByRole('option')).toHaveCount(4); // +971 to +974
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('data-value', '+972'); // the first match in list order
  await expectNoPageOverflow(page);
});

test('sign up: the timezone list is searchable and posts the chosen zone', async ({ page }) => {
  await page.route('**/api/auth/slug-check**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }),
  );
  await page.goto('/signup');
  const zone = picker(page, 'Timezone');
  await expect(zone).toBeVisible();
  await searchAndSelect(page, 'Timezone', 'tokyo', /Asia\/Tokyo/);
  await expect(zone).toHaveAttribute('data-value', 'Asia/Tokyo');
  await expect(zone).toHaveAttribute('name', 'timezone');
  await expectNoPageOverflow(page);
});

test.describe('Arabic', () => {
  test('waitlist pickers: RTL, Arabic labels, Latin digits, mirrored chevrons, no overflow', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await openWaitlistAr(page);
    const from = page.locator('button[role=combobox][data-value]').filter({ hasText: /\d{4}/ }).first();
    await from.click();
    const surface = page.getByRole('dialog').last();
    const prev = surface.getByRole('button', { name: 'الشهر السابق' });
    const next = surface.getByRole('button', { name: 'الشهر التالي' });
    expect((await prev.boundingBox())!.x, 'previous month is on the right').toBeGreaterThan((await next.boundingBox())!.x);
    expect((await surface.innerText()) + (await from.innerText())).not.toMatch(/[٠-٩۰-۹]/);
    await expectNoHorizontalOverflow(surface, 'date picker (ar)');
    await expectNoPageOverflow(page);
  });
});

async function openWaitlistAr(page: Page) {
  await mockPublicApi(page, {});
  await mockJoinWaitlist(page, {});
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}
