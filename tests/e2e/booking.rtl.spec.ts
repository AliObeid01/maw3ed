import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { mkdirSync } from 'node:fs';
import { mockPublicApi, SLUG } from './helpers/publicMock';

// Arabic booking, end to end, on the mobile viewport (Pixel 5, 393 px; the no-scroll check also runs at 360 px).
// Self-contained like booking.spec.ts: every /api/public call is answered by page.route.
// Set RTL_SHOTS=<dir> to write a screenshot of each step.

const BOOK = `/b/${SLUG}`;
const SHOTS = process.env.RTL_SHOTS;

test.skip(({ isMobile }) => !isMobile, 'RTL booking is a phone flow');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectTapTarget(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  expect(box, 'target is rendered').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
});

test('books end to end in Arabic, right to left, without horizontal scroll', async ({ page }) => {
  const { calls } = await mockPublicApi(page);
  await page.goto(BOOK);

  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'اختر خدمة' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'booking-1-service');

  await page.getByRole('button', { name: /Haircut/ }).click();
  await expect(page.getByRole('heading', { name: 'من تفضّل؟' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'booking-2-staff');
  const anyone = page.getByRole('button', { name: /أي موظف متاح/ });
  await expectTapTarget(anyone);
  await anyone.click();

  await expect(page.getByRole('heading', { name: 'اختر اليوم والوقت' })).toBeVisible();
  const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot).toBeChecked();
  await expectNoHorizontalScroll(page);
  await shot(page, 'booking-3-time');
  const next = page.getByRole('button', { name: 'متابعة' });
  await expectTapTarget(next);
  await next.click();

  await expect(page.getByRole('heading', { name: 'بياناتك' })).toBeVisible();
  await page.getByLabel('الاسم الكامل').fill('Maya Haddad');
  const phone = page.getByLabel('رقم الجوال');
  await phone.fill('71 234 567');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('maya@example.test');
  // Phone numbers stay left-to-right and copyable inside RTL text.
  await expect(phone).toHaveCSS('direction', 'ltr');
  await expectNoHorizontalScroll(page);
  await shot(page, 'booking-4-details');
  const confirm = page.getByRole('button', { name: 'تأكيد الحجز' });
  await expectTapTarget(confirm);
  await confirm.click();

  await expect(page.getByRole('heading', { name: /تم حجزك يا Maya/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'booking-5-booked');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.key).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
});

test('uses the Arabic font, not horizontal scroll at 360 px, and the toggle keeps the path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await mockPublicApi(page);
  await page.goto(BOOK);
  await expect(page.getByRole('heading', { name: 'اختر خدمة' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const family = await page.getByRole('heading', { name: 'اختر خدمة' }).evaluate(
    (el) => getComputedStyle(el).fontFamily,
  );
  expect(family.toLowerCase()).toContain('ibm plex sans arabic');

  const toggle = page.getByRole('banner').getByRole('button', { name: 'English' });
  await expectTapTarget(toggle);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(BOOK);
  expect((await page.context().cookies()).find((c) => c.name === 'locale')?.value).toBe('en');
});
