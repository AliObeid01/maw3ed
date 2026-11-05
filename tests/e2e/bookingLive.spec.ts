import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import { mockPublicApi, SLUG, type PublicMockOptions } from './helpers/publicMock';

// F68-B: the public page quietly re-reads the business and the chosen service's slots about every minute while
// the tab is visible. Time is the fake browser clock from freezeClock (page.clock), so minutes pass instantly.

const BOOK = `/b/${SLUG}`;
const MIN = 60_000;

async function reachDetails(page: Page, options: PublicMockOptions) {
  // The poller waits 60 s +-15 % (Math.random jitter, src/lib/booking/liveRefresh.ts). Pin the draw to 0.5 so every
  // wait is exactly 60 s: the request counts below are then deterministic instead of depending on 51-69 s draws.
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const mock = await mockPublicApi(page, options);
  await page.goto(BOOK);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: /Anyone available/ }).click();
  const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  return mock;
}

const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test.describe('public booking: live refresh', () => {
  test('a chosen time that disappears sends the client back to the times, with their typed details kept', async ({
    page,
  }) => {
    const options: PublicMockOptions = { bookedTimes: [] };
    await reachDetails(page, options);
    await page.getByLabel('Full name').fill('Maya Haddad');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByLabel('Email', { exact: true }).fill('maya@example.test');
    await page.getByLabel('Mobile number').focus();

    // Someone else takes 09:00 on every day; the next quiet refresh finds out.
    options.bookedTimes = ['09:00'];
    await page.clock.runFor(75_000);

    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'That time was just taken. Pick another; your details are kept.' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '09:00', exact: true })).toHaveCount(0);
    await expectNoPageOverflow(page);

    await page.getByRole('radio', { name: /^\d{2}:\d{2}$/ }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await expect(page.getByLabel('Full name')).toHaveValue('Maya Haddad');
    await expect(page.getByLabel('Mobile number')).toHaveValue('71 234 567');
  });

  test('unchanged data refreshes without remounting or stealing focus, and without a request storm', async ({ page }) => {
    const mock = await reachDetails(page, { bookedTimes: [] });
    const name = page.getByLabel('Full name');
    await name.fill('Maya');
    await name.evaluate((el) => el.setAttribute('data-probe', 'same-node'));
    const business0 = mock.businessRequests;
    const slots0 = mock.slotRequests.length;

    // Five simulated minutes with the client present (a click each minute counts as interaction).
    for (let i = 0; i < 5; i++) {
      await name.click();
      await page.clock.runFor(MIN);
    }
    await expect.poll(() => mock.businessRequests - business0).toBeGreaterThanOrEqual(4);
    expect(mock.businessRequests - business0).toBeLessThanOrEqual(6);
    expect(mock.slotRequests.length - slots0).toBeGreaterThanOrEqual(4);
    expect(mock.slotRequests.length - slots0).toBeLessThanOrEqual(6);

    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Maya');
    await expect(name).toHaveAttribute('data-probe', 'same-node');
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('pauses while the tab is hidden, stops when idle, and resumes on the next interaction', async ({ page }) => {
    const mock = await reachDetails(page, { bookedTimes: [] });
    const total = () => mock.businessRequests;

    await setVisibility(page, 'hidden');
    const hiddenAt = total();
    await page.clock.runFor(5 * MIN);
    expect(total(), 'no requests while hidden').toBe(hiddenAt);

    await setVisibility(page, 'visible');
    await page.clock.runFor(80_000);
    await expect.poll(total).toBeGreaterThan(hiddenAt);

    // 20 quiet minutes: the poller gives up after about 15, so far fewer than 20 requests happen.
    const before = total();
    await page.clock.runFor(20 * MIN);
    await page.waitForTimeout(300);
    const afterIdle = total();
    expect(afterIdle - before).toBeLessThanOrEqual(16);
    await page.clock.runFor(10 * MIN);
    await page.waitForTimeout(300);
    expect(total(), 'idle: nothing more').toBe(afterIdle);

    await page.getByLabel('Full name').click();
    await expect.poll(total).toBeGreaterThan(afterIdle);
  });
});
