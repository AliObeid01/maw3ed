import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { ORIGIN } from './helpers/clock';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { mockOfferApi } from './helpers/waitlistMock';

// F44: a confirmation promises only the reminders the server says will be sent (`reminders` on the booking and
// claim responses). Self-contained: every /api call is answered by page.route. The windows themselves are proven
// against the database in tests/integration/reminders.promise.test.ts.

const BOTH = 'We will email you reminders 24 hours and 2 hours before.';
const H2 = 'We will email you a reminder 2 hours before, because this time is less than 24 hours away.';
const NONE = 'This time is very close, so we will not send reminder emails. Please add it to your calendar.';

const VARIANTS = [
  { name: 'both', reminders: { h24: true, h2: true, email: true }, copy: BOTH, others: [H2, NONE] },
  { name: 'only 2 h', reminders: { h24: false, h2: true, email: true }, copy: H2, others: [BOTH, NONE] },
  { name: 'none', reminders: { h24: false, h2: false, email: true }, copy: NONE, others: [BOTH, H2] },
] as const;

for (const v of VARIANTS) {
  test(`booked screen, ${v.name}`, async ({ page }) => {
    await mockPublicApi(page, { reminders: v.reminders });
    await page.goto(`/b/${SLUG}`);
    await page.getByRole('button', { name: /Haircut/ }).click();
    await page.getByRole('button', { name: /Anyone available/ }).click();
    const slot = page.getByRole('radio', { name: '9:00', exact: true }).first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Full name').fill('Maya Haddad');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
    await expect(page.getByText(v.copy)).toBeVisible();
    for (const other of v.others) await expect(page.getByText(other)).toHaveCount(0);
    // The old fixed timeline never comes back.
    await expect(page.getByText('Second reminder 2 h before')).toHaveCount(0);
  });
}

async function claim(page: Page) {
  await page.goto('/o/tok.abc');
  await page.getByRole('button', { name: 'Book this slot' }).click();
}

for (const v of VARIANTS) {
  test(`waitlist claim, ${v.name}`, async ({ page }) => {
    await mockOfferApi(page, { reminders: v.reminders });
    await claim(page);
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    await expect(page.getByText(v.copy)).toBeVisible();
    for (const other of v.others) await expect(page.getByText(other)).toHaveCount(0);
  });
}

test('waitlist claim derives the variant from the slot when the server says nothing special (a day ahead: both)', async ({
  page,
}) => {
  await mockOfferApi(page);
  await claim(page);
  await expect(page.getByText(BOTH)).toBeVisible();
});

test.describe('Arabic', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  });

  const AR = {
    both: 'سنرسل لك تذكيرين بالبريد الإلكتروني، قبل 24 ساعة وقبل ساعتين.',
    h2: 'سنرسل لك تذكيرًا بالبريد الإلكتروني قبل ساعتين، لأن هذا الموعد يقع خلال أقل من 24 ساعة.',
    none: 'هذا الموعد قريب جدًا، لذلك لن نرسل رسائل تذكير بالبريد. يُرجى إضافته إلى تقويمك.',
    noEmail: 'لم تتم إضافة عنوان بريد إلكتروني، لذلك لا يمكننا إرسال تذكيرات بالبريد. يُرجى إضافة هذا الموعد إلى تقويمك.',
  };

  for (const [name, reminders, copy] of [
    ['no email address', { h24: false, h2: false, email: false }, AR.noEmail],
    ['both', { h24: true, h2: true, email: true }, AR.both],
    ['only 2 h', { h24: false, h2: true, email: true }, AR.h2],
    ['none', { h24: false, h2: false, email: true }, AR.none],
  ] as const) {
    test(`waitlist claim, ${name}`, async ({ page }) => {
      await mockOfferApi(page, { reminders });
      await page.goto('/o/tok.abc');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.getByRole('button', { name: 'احجز هذا الموعد' }).click();
      await expect(page.getByRole('heading', { name: 'تم حجزك' })).toBeVisible();
      await expect(page.getByText(copy)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

// ---- no email address ------------------------------------------------------------------------------

const NO_EMAIL = 'No email address was added, so we cannot send reminder emails. Please add this time to your calendar.';

async function toDetails(page: Page) {
  await page.goto(`/b/${SLUG}`);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: /Anyone available/ }).click();
  const slot = page.getByRole('radio', { name: '9:00', exact: true }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Full name').fill('Maya Haddad');
  await page.getByLabel('Mobile number').fill('71 234 567');
}

test('booked screen without an email address: its own honest variant, no email promise', async ({ page }) => {
  await mockPublicApi(page); // the mock answers like the server: no email on the booking -> email: false
  await toDetails(page);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
  await expect(page.getByText(NO_EMAIL)).toBeVisible();
  for (const other of [BOTH, H2, NONE]) await expect(page.getByText(other)).toHaveCount(0);
});

test('booked screen with an email address, 23 h ahead: only the 2 h variant (the server decided)', async ({ page }) => {
  await mockPublicApi(page);
  await toDetails(page);
  await page.getByLabel('Email (optional)').fill('maya@example.com');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText(H2)).toBeVisible();
  await expect(page.getByText(NO_EMAIL)).toHaveCount(0);
});

test('the details preview is hidden without an email and labelled as an estimate with one', async ({ page }) => {
  await mockPublicApi(page);
  await toDetails(page);
  await expect(page.getByText(/Times are estimates/)).toHaveCount(0);
  await expect(page.getByText('Reminder 2 (estimate)')).toHaveCount(0);
  await page.getByLabel('Email (optional)').fill('maya@example.com');
  await expect(page.getByText('Reminder 2 (estimate)')).toBeVisible();
  await expect(page.getByText(/Reminders are sent only if there is enough time before your appointment/)).toBeVisible();
});

test('claim page shows the no-email variant', async ({ page }) => {
  await mockOfferApi(page, { reminders: { h24: false, h2: false, email: false } });
  await claim(page);
  await expect(page.getByText(NO_EMAIL)).toBeVisible();
});
