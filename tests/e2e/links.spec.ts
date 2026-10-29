import { expect, test } from '@playwright/test';
import { mockLinkApi, type LinkMock } from './helpers/publicMock';

// Self-contained: every /api/links call is answered by page.route.

async function open(page: Parameters<typeof mockLinkApi>[0], mock: LinkMock = {}, token = 'tok123') {
  const api = await mockLinkApi(page, mock);
  await page.goto(`/l/${token}`);
  return api;
}

test.describe('confirm link', () => {
  test('loading the page never changes anything; confirm is primary and only a press sends the POST', async ({
    page,
  }) => {
    const { calls } = await open(page, { act: 'confirm' });
    await expect(page.getByRole('heading', { name: 'Please confirm your appointment' })).toBeVisible();
    await expect(page.getByText('Karim')).toBeVisible();
    expect(calls.map((c) => c.method)).toEqual(['GET']);

    const primary = page.locator('[data-primary="true"]');
    await expect(primary).toHaveText("Yes, I'll be there");
    await expect(page.locator('[data-primary="false"]')).toHaveText("I can't come, cancel");
    // Primary comes first in reading order.
    await expect(page.getByRole('button').filter({ hasText: /there|cancel/ }).first()).toHaveText(
      "Yes, I'll be there",
    );

    await primary.click();
    await expect(page.getByRole('heading', { name: "You're confirmed" })).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', token: 'tok123', body: { action: 'confirm' } },
    ]);
  });
});

test.describe('cancel link', () => {
  test('cancel is primary and listed first', async ({ page }) => {
    await open(page, { act: 'cancel' });
    await expect(page.getByRole('heading', { name: 'Need to cancel?' })).toBeVisible();
    await expect(page.locator('[data-primary="true"]')).toHaveText("I can't come, cancel");
    await expect(page.getByRole('button').filter({ hasText: /there|cancel/ }).first()).toHaveText(
      "I can't come, cancel",
    );
  });

  test('a view link offers both actions', async ({ page }) => {
    await open(page, { act: 'view' });
    await expect(page.getByRole('button', { name: "Yes, I'll be there" })).toBeVisible();
    await expect(page.getByRole('button', { name: "I can't come, cancel" })).toBeVisible();
  });

  test('before the cutoff the dialog promises free cancellation, then shows the cancelled screen', async ({
    page,
  }) => {
    const { calls } = await open(page, { act: 'cancel', pastCutoff: false });
    await page.getByRole('button', { name: "I can't come, cancel" }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this appointment?' });
    await expect(dialog).toContainText('Free cancellation until');
    await expect(dialog).not.toContainText('late cancellation');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Yes, cancel appointment' }).click();
    await expect(page.getByRole('heading', { name: 'Appointment cancelled' })).toBeVisible();
    await expect(page.getByText('No fee was charged.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book a new time' })).toHaveAttribute(
      'href',
      '/b/studio-nour',
    );
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', token: 'tok123', body: { action: 'cancel' } },
    ]);
  });

  test('after the cutoff the dialog says it is a late cancellation', async ({ page }) => {
    await open(page, { act: 'cancel', pastCutoff: true });
    await page.getByRole('button', { name: "I can't come, cancel" }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this appointment?' });
    await expect(dialog).toContainText('This is a late cancellation');
    await expect(dialog).not.toContainText('Free cancellation until');
    await dialog.getByRole('button', { name: 'Yes, cancel appointment' }).click();
    await expect(page.getByText(/was a late cancellation/)).toBeVisible();
  });

  test('keeping the appointment sends nothing', async ({ page }) => {
    const { calls } = await open(page, { act: 'cancel' });
    await page.getByRole('button', { name: "I can't come, cancel" }).click();
    await page.getByRole('button', { name: 'Keep my appointment' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

test.describe('states', () => {
  test('an expired link (410) says so', async ({ page }) => {
    await open(page, { gone: { old: 410 } }, 'old');
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  });

  test('an unknown link (404) says it is not valid', async ({ page }) => {
    await open(page, { gone: { bad: 404 } }, 'bad');
    await expect(page.getByRole('heading', { name: "This link isn't valid" })).toBeVisible();
  });

  test('an already cancelled appointment opens on the cancelled screen with no actions', async ({
    page,
  }) => {
    await open(page, { act: 'view', status: 'CANCELLED', canConfirm: false, canCancel: false });
    await expect(page.getByRole('heading', { name: 'Appointment cancelled' })).toBeVisible();
    await expect(page.getByRole('button', { name: "Yes, I'll be there" })).toHaveCount(0);
  });

  test('the response carries no-referrer and the page is noindex', async ({ page }) => {
    await mockLinkApi(page);
    const response = await page.goto('/l/tok123');
    expect(response!.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test('Arabic link page is right-to-left without overflow', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  await open(page, { act: 'confirm' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'يرجى تأكيد موعدك' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
