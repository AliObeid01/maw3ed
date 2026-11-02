import { expect, test } from '../helpers/test';
import {
  appt,
  at,
  defaultAppointments,
  LEA,
  MAYA,
  mockDashboardApi,
  NADINE,
  RAMI,
  todayLocal,
} from '../helpers/dashboardMock';
import { setRole } from '../helpers/mockApi';
import { IDS } from '../helpers/publicMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

test('greets by name, shows the stats and the Do this first card above the day', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening), Lina$/,
  );
  // 4 non-cancelled appointments: 2 confirmed, 2 not yet confirmed, 1 from the waitlist.
  const stats = page.getByText('Appointments today').locator('xpath=..');
  await expect(stats).toContainText('4');
  await expect(page.getByText('Refilled from waitlist today').locator('xpath=..')).toContainText('1');
  const card = page.getByRole('region', { name: 'Do this first' });
  await expect(card).toContainText('3 WhatsApp reminders due');
  await expect(card.getByRole('link', { name: 'Send now' })).toHaveAttribute('href', '/app/reminders');
  await expect(page.getByRole('link', { name: /2 outcomes to mark/ }).first()).toHaveAttribute(
    'href',
    '/app/outcomes',
  );
  await expect(page.getByRole('heading', { name: 'Waitlist activity' })).toBeVisible();
  await expect(page.getByText('Rami took 12:30 with Jad')).toBeVisible();
  // The card is the first thing after the stats, before the agenda or the calendar.
  const cardBox = (await card.boundingBox())!;
  const dayBox = (await page.getByRole('heading', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/ }).boundingBox())!;
  if (page.viewportSize()!.width < 1024) expect(cardBox.y).toBeLessThan(dayBox.y);
  else expect(cardBox.x).toBeGreaterThan(dayBox.x);
});

test('shows a calm "All reminders sent" state instead of the card when nothing is due', async ({ page }) => {
  await mockDashboardApi(page, { reminders: [] });
  await page.goto('/app');
  await expect(page.getByText('All reminders sent')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send now' })).toHaveCount(0);
});

test('hides the amber card when there are no outcomes to mark', async ({ page }) => {
  await mockDashboardApi(page, { outcomesToMark: 0 });
  await page.goto('/app');
  await expect(page.getByText('Waitlist activity')).toBeVisible();
  await expect(page.getByRole('main').getByText(/outcomes? to mark/)).toHaveCount(0);
});

test('an empty day explains itself and offers New booking', async ({ page }) => {
  await mockDashboardApi(page, { appointments: [] });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Nothing booked today yet' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'New booking' }).first()).toHaveAttribute('href', '/app/book');
});

test('a failed load shows an error with retry, and retry recovers', async ({ page }) => {
  await mockDashboardApi(page);
  let fail = true;
  await page.route('**/api/dashboard/today*', (route) =>
    fail
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' })
      : route.fallback(),
  );
  await page.goto('/app');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('We could not load this');
  await expect(page.getByText('INTERNAL')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: /Nadine Aoun/ }).first()).toBeVisible();
});

test('a 401 sends the user to sign in', async ({ page }) => {
  await mockDashboardApi(page);
  await page.route('**/api/dashboard/today*', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHORIZED","message":"x"}}' }),
  );
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});

test('the previous and next day buttons ask for that day', async ({ page }) => {
  const { calls } = await mockDashboardApi(page);
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect.poll(() => calls.filter((c) => c.path === '/api/dashboard/today').length).toBeGreaterThan(1);
  const dates = calls.filter((c) => c.path === '/api/dashboard/today').map((c) => c.search);
  expect(dates[0]).toBe(`?date=${todayLocal()}`);
  expect(dates[dates.length - 1]).not.toBe(dates[0]);
  await expect(page.getByRole('heading', { name: 'Nothing booked this day' })).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing booked this day' })).toHaveCount(0);
});

test.describe('phone: agenda list', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'agenda is for phones'));

  test('groups by hour, filters by staff, and has no calendar grid', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    await expect(page.getByRole('group', { name: 'Day calendar' })).toHaveCount(0);
    const agenda = page.getByRole('main');
    await expect(agenda.getByRole('heading', { level: 3 })).toHaveText(['10:00', '11:00', '12:00', '14:00']);
    await expect(agenda.getByRole('button', { name: /Nadine Aoun/ })).toContainText('2 no-shows');
    await expect(agenda.getByRole('button', { name: /Maya Haddad/ })).toContainText('2 no-shows');

    await page.getByRole('button', { name: 'Karim', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Karim', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(agenda.getByRole('button', { name: /Lea Saab/ })).toBeVisible();
    await expect(agenda.getByRole('button', { name: /Nadine Aoun/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(agenda.getByRole('button', { name: /Nadine Aoun/ })).toBeVisible();
  });

  test('a row opens the appointment sheet with call and WhatsApp links', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    await page.getByRole('button', { name: /Maya Haddad/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Appointment' });
    await expect(sheet).toContainText('Maya Haddad');
    await expect(sheet).toContainText('+961 70 555 218');
    await expect(sheet.getByRole('link', { name: 'Call Maya Haddad' })).toHaveAttribute('href', 'tel:+96170555218');
    const wa = sheet.getByRole('link', { name: 'Open a WhatsApp chat with Maya Haddad' });
    await expect(wa).toHaveAttribute('href', 'https://wa.me/96170555218');
    await expect(wa).toHaveAttribute('rel', /noopener/);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('cancel asks for confirmation, then cancels and refreshes the day', async ({ page }) => {
    const { calls } = await mockDashboardApi(page);
    await page.goto('/app');
    await page.getByRole('button', { name: /Maya Haddad/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel appointment' }).click();
    const confirm = page.getByRole('dialog', { name: 'Cancel this appointment?' });
    // Keeping it makes no request.
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    expect(calls.filter((c) => c.path.endsWith('/cancel'))).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel appointment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText("Maya Haddad's appointment was cancelled")).toBeVisible();
    expect(calls.filter((c) => c.path === '/api/appointments/ap4/cancel')).toHaveLength(1);
    await expect(page.getByRole('main').getByRole('button', { name: /Maya Haddad/ })).toHaveCount(0);
  });

  test('tab bar shows the reminders badge and the outcomes badge', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    const tabs = page.getByRole('navigation', { name: 'Main tabs' });
    await expect(tabs.getByRole('link', { name: /Reminders/ })).toContainText('3 reminders due');
    await expect(tabs.getByRole('link', { name: /Outcomes/ })).toContainText('2 outcomes to mark');
  });
});

test.describe('desktop: calendar grid', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, 'calendar is for lg and up'));

  test('one column per person, blocks tinted by status, no agenda list', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    const grid = page.getByRole('group', { name: 'Day calendar' });
    await expect(grid).toBeVisible();
    for (const name of ['Lina', 'Karim', 'Jad']) {
      await expect(grid.getByRole('list', { name })).toBeVisible();
    }
    await expect(grid.getByRole('list', { name: 'Lina' }).getByRole('button')).toHaveCount(2);
    // Confirmed is brand-soft, a waitlist booking amber, a plain booking grey.
    const bg = (name: RegExp) =>
      grid.getByRole('button', { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(/Nadine Aoun/)).toBe('rgb(227, 237, 235)');
    expect(await bg(/Rami Haddad/)).toBe('rgb(243, 227, 196)');
    expect(await bg(/Maya Haddad/)).toBe('rgb(236, 232, 223)');
    // 44 px per 30 minutes: the 45 minute blow-dry is 66 px tall.
    const box = (await grid.getByRole('button', { name: /Lea Saab/ }).boundingBox())!;
    expect(box.height).toBeGreaterThan(60);
    expect(box.height).toBeLessThan(70);
    await expect(grid.getByRole('button', { name: /Nadine Aoun/ })).toContainText('2 no-shows');
    // F55: a tall (non-compact) block has the full details as its accessible name too.
    await expect(grid.getByRole('button', { name: /Nadine Aoun · .* · .* · (Lina|Karim|Jad) · / })).toHaveCount(1);
    // No staff filter chips on desktop.
    await expect(page.getByRole('group', { name: 'Filter by team member' })).toHaveCount(0);
  });

  test('short appointments stay readable and never cover each other (15-minute granularity)', async ({ page }) => {
    const lina = IDS.lina;
    await mockDashboardApi(page, {
      appointments: [
        // Four 15-minute visits back to back: 22 px each by time, drawn at the readable minimum.
        appt('q1', at(12, 0), 15, IDS.beard, lina, NADINE),
        appt('q2', at(12, 15), 15, IDS.beard, lina, LEA),
        appt('q3', at(12, 30), 15, IDS.beard, lina, RAMI),
        appt('q4', at(12, 45), 15, IDS.beard, lina, MAYA),
        // A real overlap in another column.
        appt('q5', at(14, 0), 60, IDS.haircut, IDS.karim, LEA),
        appt('q6', at(14, 30), 30, IDS.haircut, IDS.karim, RAMI),
        // A late one, so the column has to grow to hold its minimum height.
        appt('q7', at(18, 45), 15, IDS.beard, IDS.jad, MAYA),
      ],
    });
    await page.goto('/app');
    const grid = page.getByRole('group', { name: 'Day calendar' });
    for (const column of ['Lina', 'Karim', 'Jad']) {
      const buttons = grid.getByRole('list', { name: column }).getByRole('button');
      await expect(buttons.first()).toBeVisible();
      const boxes = await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(30); // about 32 px visible
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const c = boxes[j]!;
          const overlapsX = a.left < c.right - 0.5 && c.left < a.right - 0.5;
          const overlapsY = a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          expect(overlapsX && overlapsY, `${column}: block ${i} covers block ${j}`).toBe(false);
        }
    }
    // One line: client name and time; the full details are in the tooltip and the accessible name.
    const first = grid.getByRole('button', { name: /Nadine Aoun/ });
    await expect(first).toContainText('12:00');
    await expect(first).toHaveAttribute('title', /Nadine Aoun · .*12:00 – 12:15.* · Beard trim/);
    // F55: `title` is not an accessible name; the aria-label carries client, time, service and staff.
    await expect(first).toHaveAttribute('aria-label', /Nadine Aoun · .*12:00 – 12:15.* · Beard trim · Lina/);
    await expect(grid.getByRole('button', { name: /Nadine Aoun.*12:00 – 12:15.*Beard trim.*Lina/ })).toHaveCount(1);
    await first.focus();
    await expect(first).toBeFocused();
    const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    // The late block is inside its column (the column grew), not clipped by the grid.
    const late = (await grid.getByRole('button', { name: /Maya Haddad.*18:45/ }).boundingBox())!;
    const column = (await grid.getByRole('list', { name: 'Jad' }).boundingBox())!;
    expect(late.y + late.height).toBeLessThanOrEqual(column.y + column.height + 0.5);
  });

  test('a block opens the same appointment sheet', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    await page.getByRole('group', { name: 'Day calendar' }).getByRole('button', { name: /Lea Saab/ }).click();
    await expect(page.getByRole('dialog', { name: 'Appointment' })).toContainText('Lea Saab');
  });

  test('the sidebar carries the badges and New booking links to the form', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/app');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Reminders/ })).toContainText(
      '3 reminders due',
    );
    await expect(page.getByRole('complementary').getByRole('link', { name: 'New booking' })).toHaveAttribute(
      'href',
      '/app/book',
    );
  });
});

test('RTL: Arabic Today lays out right to left without horizontal scroll', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockDashboardApi(page, { appointments: defaultAppointments() });
  await page.goto('/app');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lina');
  await expect(page.getByText('مواعيد اليوم')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('F45: the refill tile names the day it counts (today vs another day)', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app');
  await expect(page.getByText('Refilled from waitlist today')).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByText('Refilled from waitlist on this day')).toBeVisible();
  await expect(page.getByText('Refilled from waitlist today')).toHaveCount(0);
});
