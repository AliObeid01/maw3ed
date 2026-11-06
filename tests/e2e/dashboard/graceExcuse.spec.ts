import type { Page } from '@playwright/test';
import { formatClock } from '../../../src/lib/time/clock';
import { expect, test } from '../helpers/test';
import { trackIntlErrors } from '../helpers/intlErrors';
import { setRole } from '../helpers/mockApi';
import { appt, client, mockOutcomesApi } from '../helpers/outcomesMock';

// PR-2: the 10 minute No-show grace period and the Excuse action, on the appointment page (mocked API).
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

const MAYA = client('clmaya', 'Maya Khoury', '+96171234567', { attended: 4 });
const NADINE = client('clnadine', 'Nadine Aoun', '+96176418902', { attended: 7, noShows: 2, lateCancels: 1 });

const setup = (extra: Parameters<typeof appt>[4] = {}, startMinutes = -120, duration = 30) => ({
  clients: [{ ...MAYA }, { ...NADINE }],
  appointments: [appt('apone', 'clmaya', startMinutes, duration, extra)],
});
// The time sits in a left-to-right isolate (U+2066 .. U+2069) so it never reorders inside Arabic text.
const available = (time: string) => new RegExp('No-show is available from \u2066?' + time);
const opensAt = (startAt: string) => formatClock(Date.parse(startAt) + 10 * 60_000, 'Asia/Beirut');

test.describe('No-show grace period', () => {
  test('No-show is disabled with the time it opens; Late cancel works; one line says both free the time', async ({
    page,
  }) => {
    const { appointments } = await mockOutcomesApi(page, setup({}, -4, 30));
    await page.goto('/app/appointments/apone');
    const outcome = page.getByRole('region', { name: 'Outcome' });
    const time = opensAt(appointments[0]!.startAt);
    const noShow = outcome.getByRole('button', { name: /as No-show/ });
    await expect(noShow).toBeDisabled();
    await expect(outcome.getByText(available(time))).toBeVisible();
    await expect(noShow).toHaveAccessibleDescription(available(time));
    await expect(outcome.getByRole('button', { name: /as Late cancel/ })).toBeEnabled();
    await expect(outcome.getByText('No-show and Late cancel free the time from now.')).toBeVisible();
    expect((await noShow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('after the grace period No-show works and the helper text is gone', async ({ page }) => {
    const { calls } = await mockOutcomesApi(page, setup({}, -12, 30));
    await page.goto('/app/appointments/apone');
    const outcome = page.getByRole('region', { name: 'Outcome' });
    await expect(outcome.getByText(/No-show is available from/)).toHaveCount(0);
    await outcome.getByRole('button', { name: /as No-show/ }).click();
    await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('No-show');
    await expect(excuseBtn(page)).toBeVisible();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  test('409 NO_SHOW_TOO_EARLY from the server shows the business-time clock', async ({ page }) => {
    const { appointments } = await mockOutcomesApi(page, setup({}, -12, 30));
    await page.goto('/app/appointments/apone');
    const outcome = page.getByRole('region', { name: 'Outcome' });
    await expect(outcome.getByRole('button', { name: /as No-show/ })).toBeEnabled();
    const availableAt = new Date(Date.parse(appointments[0]!.startAt) + 10 * 60_000).toISOString();
    // The server's clock is behind this browser's: it still holds the booking inside the window.
    await page.route('**/api/appointments/apone/outcome', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'NO_SHOW_TOO_EARLY', message: 'x', fields: {}, data: { availableAt } },
        }),
      }),
    );
    await outcome.getByRole('button', { name: /as No-show/ }).click();
    await expect(outcome.getByRole('alert')).toContainText(
      available(opensAt(appointments[0]!.startAt)),
    );
  });

  test('RTL: Arabic hint and the Excuse button, times left-to-right, no sideways scroll', async ({ page }) => {
    await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    const { appointments } = await mockOutcomesApi(page, setup({}, -4, 30));
    await page.goto('/app/appointments/apone');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('«لم يحضر» متاح من')).toContainText(opensAt(appointments[0]!.startAt));
    await expect(page.getByText('«لم يحضر» و«إلغاء متأخر» يحرّران الوقت فورًا.')).toBeVisible();
    appointments[0]!.status = 'NO_SHOW';
    await page.reload();
    await expect(page.getByRole('button', { name: 'عذر', exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

const excuseBtn = (page: Page) =>
  page.getByRole('region', { name: 'Outcome' }).getByRole('button', { name: 'Excuse', exact: true });

test.describe('Excuse', () => {
  for (const [status, visible] of [
    ['NO_SHOW', true],
    ['LATE_CANCEL', true],
    ['ATTENDED', false],
    ['BOOKED', false],
    ['CONFIRMED', false],
    ['CANCELLED', false],
    ['PENDING_PAYMENT', false],
  ] as const) {
    test(`the button is ${visible ? 'offered' : 'not offered'} for ${status}`, async ({ page }) => {
      await mockOutcomesApi(page, setup({ status }));
      await page.goto('/app/appointments/apone');
      await expect(page.getByRole('region', { name: 'Appointment details' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Excuse', exact: true })).toHaveCount(visible ? 1 : 0);
    });
  }

  test('confirm explains the effect, then the booking is a normal cancellation and the counter drops', async ({
    page,
  }) => {
    const { calls } = await mockOutcomesApi(page, {
      clients: [{ ...NADINE }],
      appointments: [appt('apone', 'clnadine', -120, 30, { status: 'NO_SHOW' })],
    });
    await page.goto('/app/appointments/apone');
    const who = page.getByRole('region', { name: 'Client' });
    await expect(who).toContainText('2 no-shows');
    const button = excuseBtn(page);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Excuse this mark?' });
    await expect(dialog).toContainText(
      "This removes the mark from the client's history. The booking becomes a normal cancellation.",
    );
    // Keeping the mark sends nothing.
    await dialog.getByRole('button', { name: 'Keep the mark' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter((c) => c.path.endsWith('/excuse'))).toHaveLength(0);

    await button.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, excuse it' }).dblclick();
    await expect(
      page.getByRole('status').filter({ hasText: 'Excused. Nadine Aoun no longer has this mark.' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
    await expect(who).toContainText('1 no-show');
    await expect(page.getByRole('region', { name: 'Outcome' })).toHaveCount(0);
    const posts = calls.filter((c) => c.path === '/api/appointments/apone/excuse' && c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({});
  });

  test('works for a late cancel written by the cancel link', async ({ page }) => {
    await mockOutcomesApi(page, {
      clients: [{ ...NADINE }],
      appointments: [appt('apone', 'clnadine', -120, 30, { status: 'LATE_CANCEL', cancelledVia: 'LINK' })],
    });
    await page.goto('/app/appointments/apone');
    const who = page.getByRole('region', { name: 'Client' });
    await expect(who).toContainText('1 late cancel');
    await excuseBtn(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, excuse it' }).click();
    await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
    await expect(who).not.toContainText('late cancel');
    await expect(who).toContainText('2 no-shows');
  });

  test('409 (no longer excusable): a calm message and the page reloads what the server knows', async ({ page }) => {
    await mockOutcomesApi(page, { ...setup({ status: 'NO_SHOW' }), excuseScript: ['409'] });
    await page.goto('/app/appointments/apone');
    await excuseBtn(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, excuse it' }).click();
    await expect(page.getByRole('region', { name: 'Outcome' }).getByRole('alert')).toContainText(
      'This appointment can no longer be excused. Refresh the page.',
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a server error keeps the mark and a retry works', async ({ page }) => {
    await mockOutcomesApi(page, { ...setup({ status: 'NO_SHOW' }), excuseScript: ['500', 'ok'] });
    await page.goto('/app/appointments/apone');
    await excuseBtn(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, excuse it' }).click();
    await expect(page.getByRole('region', { name: 'Outcome' }).getByRole('alert')).toBeVisible();
    await excuseBtn(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, excuse it' }).click();
    await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
  });

  test('a receptionist (STAFF) can excuse', async ({ page }) => {
    await setRole(page, 'STAFF', DASHBOARD);
    await mockOutcomesApi(page, setup({ status: 'NO_SHOW' }));
    await page.goto('/app/appointments/apone');
    await expect(excuseBtn(page)).toBeVisible();
  });
});
