import { expect, test } from '../helpers/test';
import { forbiddenCalls, makeState, mockBarberApi } from '../helpers/barberMock';
import { expectNoPageOverflow } from '../helpers/layout';
import { setRole } from '../helpers/mockApi';

/**
 * PR-5: the barber's own screens (PRACTITIONER login). Every API call is answered by page.route with the BARBER
 * shapes (see helpers/barberMock.ts: first name and phone only, no e-mail, no counters).
 */
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'PRACTITIONER', DASHBOARD);
});

test.describe('360 px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
  });

  test('lands on Today with three tabs, own appointments by first name, no owner controls', async ({ page }) => {
    const state = await mockBarberApi(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/today$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Lina$/);

    const tabs = page.getByRole('navigation', { name: 'Main tabs' });
    await expect(tabs.getByRole('link')).toHaveText([/^Today$/, /Outcomes$/, /^Account$/]);
    for (const link of await tabs.getByRole('link').all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(tabs.getByRole('link', { name: /Today/ })).toHaveAttribute('aria-current', 'page');
    // The ended appointment is waiting for an outcome: the badge says so.
    await expect(tabs.getByRole('link', { name: /Outcomes/ })).toContainText('1 outcome to mark');

    for (const absent of ['New booking', 'Reminders', 'Clients', 'Waitlist', 'Staff', 'Settings', 'Pilot report'])
      await expect(page.getByRole('link', { name: absent })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0);
    await expect(page.getByText('Do this first')).toHaveCount(0);
    await expect(page.getByText('Refilled from waitlist')).toHaveCount(0);

    await expect(page.getByText('Appointments today').locator('xpath=..')).toContainText('3');
    const agenda = page.getByRole('button', { name: /Rana/ });
    await expect(agenda).toBeVisible();
    await expect(page.getByRole('button', { name: /Karim/ })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Haddad');
    await expect(page.locator('body')).not.toContainText('@');
    await expectNoPageOverflow(page);
    expect(forbiddenCalls(state)).toEqual([]);
  });

  test('the appointment sheet: first name, phone, Call and WhatsApp, status, outcome buttons, no cancel or excuse', async ({ page }) => {
    const state = await mockBarberApi(page);
    await page.goto('/app/today');
    await page.getByRole('button', { name: /Karim/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Appointment' });
    await expect(sheet).toContainText('Karim');
    await expect(sheet).toContainText('Confirmed by the client');
    await expect(sheet.getByRole('link', { name: 'Call Karim' })).toHaveAttribute('href', 'tel:+96170000013');
    const wa = sheet.getByRole('link', { name: 'Open a WhatsApp chat with Karim' });
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/96170000013/);
    // The call button is the outlined blue one, WhatsApp the deep green one (PR-A colours).
    const call = sheet.getByRole('link', { name: 'Call Karim' });
    expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await wa.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(sheet.getByText('Cancel appointment')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /Excuse/ })).toHaveCount(0);
    // It has not started yet: nothing can be marked and the sheet says when.
    await expect(sheet).not.toContainText('@');
    await expectNoPageOverflow(page);
    expect(forbiddenCalls(state)).toEqual([]);
  });

  test('marks an ended appointment Attended; the grace period holds No-show back for a late client', async ({ page }) => {
    const state = await mockBarberApi(page);
    await page.goto('/app/today');

    // Started two minutes ago: No-show waits for the 10 minute grace, Attended waits for the end.
    await page.getByRole('button', { name: /Dana/ }).click();
    let sheet = page.getByRole('dialog', { name: 'Appointment' });
    const noShow = sheet.getByRole('button', { name: 'Mark Dana as No-show' });
    await expect(noShow).toBeDisabled();
    await expect(sheet.getByText(/No-show is available from/)).toContainText(/\d{2}:\d{2}/);
    await expect(sheet.getByRole('button', { name: 'Mark Dana as Attended' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: /Rana/ }).click();
    sheet = page.getByRole('dialog', { name: 'Appointment' });
    await expect(sheet.getByText('Did Rana come?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Mark Rana as Attended' }).click();
    await expect(page.getByText('Marked Rana as Attended').first()).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Mark Rana as Attended' })).toHaveAttribute('aria-pressed', 'true');
    expect(state.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ outcome: 'ATTENDED' });
    expect(forbiddenCalls(state)).toEqual([]);
  });

  test('a recorded late cancel is final and cannot be excused by a barber', async ({ page }) => {
    const state = makeState();
    state.appts[0]!.status = 'LATE_CANCEL';
    await mockBarberApi(page, state);
    // A late cancel is off the agenda; its page still opens and offers no excuse.
    await page.goto('/app/appointments/a-ended');
    const card = page.getByRole('region', { name: 'Appointment details' });
    await expect(card.getByText(/A late cancel cannot be changed/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Mark Rana as Attended' })).toBeDisabled();
    await expect(card.getByRole('button', { name: /Excuse/ })).toHaveCount(0);
  });

  test('Mark outcome: the queue holds only their own ended appointments and marking updates the counters', async ({ page }) => {
    const state = await mockBarberApi(page);
    await page.goto('/app/today');
    await page.getByRole('navigation', { name: 'Main tabs' }).getByRole('link', { name: /Outcomes/ }).click();
    await expect(page).toHaveURL(/\/app\/outcomes$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mark outcome');
    await expect(page.getByText('1 left')).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: 'Rana' });
    await expect(card).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Haddad');
    await expectNoPageOverflow(page);
    await card.getByRole('button', { name: 'Mark Rana as No-show' }).click();
    await expect(page.getByText('Marked Rana as No-show')).toBeVisible();
    await expect(page.getByText('All done')).toBeVisible();
    expect(forbiddenCalls(state)).toEqual([]);
  });

  test('the appointment page opens from the queue; another barber\'s id is a calm "not found"', async ({ page }) => {
    await mockBarberApi(page);
    await page.goto('/app/outcomes');
    await page.getByRole('link', { name: 'Open the appointment of Rana' }).click();
    await expect(page).toHaveURL(/\/app\/appointments\/a-ended$/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Call Rana' })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto('/app/appointments/someone-elses');
    await expect(page.getByRole('heading', { name: /not found|could not find/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Rana');
  });

  test('owner pages redirect to Today, also after a client-side navigation, and no owner API is called', async ({ page }) => {
    test.setTimeout(240_000); // every owner page is compiled on first use by the dev server
    const state = await mockBarberApi(page);
    for (const path of ['/app/staff', '/app/clients/abc', '/app/book', '/app/welcome']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/app\/today$/, { timeout: 30_000 });
    }
    // Soft navigation (no new document, so the layout does not re-run): the page guard answers on the server.
    await page.goto('/app/today');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { next: { router: { push: (to: string) => void } } }).next.router.push('/app/staff'),
    );
    await expect(page).toHaveURL(/\/app\/today$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Staff' })).toHaveCount(0);
    await page.goto('/app/account');
    await expect(page.getByText('Phone (your sign-in)')).toBeVisible();
    await expect(page.getByText('+961 70 000 001')).toBeVisible();
    expect(forbiddenCalls(state)).toEqual([]);
  });

  test('a login without a linked team member sees a calm empty state', async ({ page }) => {
    const state = makeState();
    state.noSchedule = true;
    await mockBarberApi(page, state);
    await page.goto('/app/today');
    await expect(page.getByText('Your schedule is not set up yet')).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

test.describe('1440 px', () => {
  test('desktop: sidebar with Today, Mark outcome and Account only; calendar; no New booking', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await mockBarberApi(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/today$/);
    const side = page.locator('aside');
    await expect(side.getByRole('link', { name: 'Today' })).toBeVisible();
    await expect(side.getByRole('link', { name: /Mark outcome/ })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Account' })).toBeVisible();
    for (const absent of ['New booking', 'Reminders', 'Clients', 'Waitlist', 'Staff', 'Services', 'Settings', 'Pilot report'])
      await expect(side.getByRole('link', { name: absent })).toHaveCount(0);
    await expect(page.getByRole('group', { name: /calendar/i })).toBeVisible();
    await page.getByRole('button', { name: /Karim/ }).click();
    await expect(page.getByRole('dialog', { name: 'Appointment' })).toContainText('Karim');
    await page.keyboard.press('Escape');
    await expectNoPageOverflow(page);
    await page.goto('/app/outcomes');
    await expect(page.getByText('1 left')).toBeVisible();
    await expectNoPageOverflow(page);
    expect(forbiddenCalls(state)).toEqual([]);
  });
});

test.describe('Arabic', () => {
  test('right-to-left at 360 px: tabs, agenda, sheet with the grace hint and the queue, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await page.setViewportSize({ width: 360, height: 740 });
    await mockBarberApi(page);
    await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const tabs = page.getByRole('navigation', { name: 'التبويبات الرئيسية' });
    await expect(tabs.getByRole('link')).toHaveText([/^اليوم$/, /النتائج$/, /^الحساب$/]);
    await expect(page.getByRole('button', { name: /Rana/ })).toBeVisible();
    await expectNoPageOverflow(page);

    await page.getByRole('button', { name: /Dana/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/\d{2}:\d{2}/).first()).toBeVisible();
    await expect(sheet.getByRole('link', { name: /^اتصل بـ/ })).toHaveAttribute('href', 'tel:+96170000012');
    await expectNoPageOverflow(page);
    await page.keyboard.press('Escape');

    await tabs.getByRole('link').nth(1).click();
    await expect(page).toHaveURL(/\/app\/outcomes$/, { timeout: 30_000 });
    await expect(page.getByText('Rana').first()).toBeVisible();
    await expectNoPageOverflow(page);
  });
});
