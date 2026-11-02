import { expect, test } from '../helpers/test';
import { appt, at, LEA, MAYA, mockDashboardApi, NADINE, RAMI } from '../helpers/dashboardMock';
import { setRole } from '../helpers/mockApi';
import { IDS } from '../helpers/publicMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
const OUT = process.env.SHOTS_DIR ?? 'shots';
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

test('shot: calendar', async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboardApi(page, {
    appointments: [
      appt('q1', at(12, 0), 15, IDS.beard, IDS.lina, NADINE),
      appt('q2', at(12, 15), 15, IDS.beard, IDS.lina, LEA),
      appt('q3', at(12, 30), 15, IDS.beard, IDS.lina, RAMI),
      appt('q4', at(12, 45), 15, IDS.beard, IDS.lina, MAYA),
      appt('q5', at(14, 0), 60, IDS.haircut, IDS.karim, LEA),
      appt('q6', at(14, 30), 30, IDS.haircut, IDS.karim, RAMI),
      appt('q7', at(18, 45), 15, IDS.beard, IDS.jad, MAYA),
      appt('q8', at(10, 0), 30, IDS.haircut, IDS.lina, LEA),
    ],
  });
  await page.goto('/app');
  const grid = page.getByRole('group', { name: 'Day calendar' });
  await expect(grid).toBeVisible();
  await grid.getByRole('button', { name: /Rami Haddad.*12:30/ }).focus();
  await grid.screenshot({ path: `${OUT}/calendar-1440.png` });
});

test('shot: reminders sent button', async ({ page, isMobile }) => {
  await mockDashboardApi(page);
  await page.goto('/app/reminders');
  await expect(page.getByRole('button', { name: /^Sent by/ }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/reminders-${isMobile ? '360' : '1440'}.png`, fullPage: true });
});
