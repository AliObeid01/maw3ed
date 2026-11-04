import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { defaultState, mockSetupApi, setRole, type MockState } from '../helpers/mockApi';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';

// F68-B: closing at midnight and opening past midnight in the hours editor (mocked API, fake-session dev server).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

type Iv = { weekday: number; startLocal: string; endLocal: string };
const stateWith = (hours: Iv[]): MockState => {
  const state = defaultState();
  state.hours['p1'] = hours;
  return state;
};

async function setTime(group: Locator, hm: string) {
  const [h, m] = hm.split(':') as [string, string];
  await group.getByRole('combobox').nth(0).selectOption(h);
  if (h !== '24') await group.getByRole('combobox').nth(1).selectOption(m);
}

async function open(page: Page, state: MockState, day: string) {
  const mock = await mockSetupApi(page, { state });
  await page.goto('/app/hours');
  await page.getByRole('button', { name: new RegExp(`Edit or add hours on ${day}`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { ...mock, dialog };
}

const savedIntervals = (calls: Array<{ method: string; path: string; body?: unknown }>) =>
  (calls.find((c) => c.method === 'PUT' && c.path === '/api/staff/p1/hours')?.body as { intervals: Iv[] }).intervals;

test.describe('F68-B hours editor: midnight', () => {
  test('Closes offers 24:00 (midnight) with minutes locked, and the saved end is 24:00', async ({ page }) => {
    const { calls, dialog } = await open(page, stateWith([{ weekday: 1, startLocal: '09:00', endLocal: '17:30' }]), 'Monday');
    await dialog.getByRole('button', { name: 'Add hours' }).click();
    // The suggested second entry starts at 18:30 on a half hour: 23:30 to midnight used to be refused.
    const opens = dialog.getByRole('group', { name: 'Opens' }).nth(1);
    const closes = dialog.getByRole('group', { name: 'Closes' }).nth(1);
    await setTime(opens, '23:30');
    await closes.getByRole('combobox').nth(0).selectOption({ label: '24:00 (midnight)' });
    await expect(closes.getByRole('combobox').nth(0)).toHaveValue('24');
    await expect(closes.getByRole('combobox').nth(1)).toBeDisabled();
    await expect(closes.getByRole('combobox').nth(1)).toHaveValue('00');
    // No ambiguous "00" in the Closes hour list.
    await expect(closes.getByRole('combobox').nth(0).locator('option[value="00"]')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expectNoHorizontalOverflow(dialog, 'hours sheet');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: /Edit Monday, 23:30 to 24:00/ })).toBeVisible();
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toContainText('Hours saved');
    expect(savedIntervals(calls)).toContainEqual({ weekday: 1, startLocal: '23:30', endLocal: '24:00' });
    await expectNoPageOverflow(page);
  });

  test('an old 00:00 end is read as 24:00', async ({ page }) => {
    const { dialog } = await open(page, stateWith([{ weekday: 1, startLocal: '09:00', endLocal: '24:00' }]), 'Monday');
    await expect(dialog.getByRole('group', { name: 'Closes' }).getByRole('combobox').first()).toHaveValue('24');
  });

  test('entries are sorted when Apply is pressed, so the list never reorders after saving', async ({ page }) => {
    const { dialog } = await open(page, stateWith([{ weekday: 1, startLocal: '09:00', endLocal: '12:00' }]), 'Monday');
    await dialog.getByRole('button', { name: 'Add hours' }).click();
    await setTime(dialog.getByRole('group', { name: 'Opens' }).nth(1), '06:00');
    await setTime(dialog.getByRole('group', { name: 'Closes' }).nth(1), '08:00');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    const chips = page.getByRole('button', { name: /^Edit Monday, / });
    await expect(chips.nth(0)).toHaveAccessibleName('Edit Monday, 06:00 to 08:00');
    await expect(chips.nth(1)).toHaveAccessibleName('Edit Monday, 09:00 to 12:00');
  });
});

test.describe('F68-B hours editor: open past midnight', () => {
  const monday = (): Iv[] => [{ weekday: 1, startLocal: '09:00', endLocal: '13:00' }];

  test('Closes earlier than Opens offers the split instead of the plain error, and confirming writes both days', async ({
    page,
  }) => {
    const hours: Iv[] = [...monday(), { weekday: 2, startLocal: '09:00', endLocal: '12:00' }];
    const { calls, dialog } = await open(page, stateWith(hours), 'Monday');
    await setTime(dialog.getByRole('group', { name: 'Closes' }), '02:00');
    await expect(dialog.getByText('Open until 02:00 the next day?')).toBeVisible();
    await expect(dialog.getByText('Monday 09:00 to 24:00, then Tuesday 00:00 to 02:00.', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Closing time must be after opening time.')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await expectNoHorizontalOverflow(dialog, 'hours sheet');
    for (const b of await dialog.getByRole('button').all()) {
      const box = await b.boundingBox();
      if (box) expect(box.height, 'tap target').toBeGreaterThanOrEqual(43);
    }

    await dialog.getByRole('button', { name: 'Yes, open until 02:00' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit Monday, 09:00 to 24:00/ })).toBeVisible();
    // Tuesday shows its early entry as the end of Monday night, then its own hours, in order.
    const tuesday = page.getByRole('button', { name: /^Edit Tuesday, / });
    await expect(tuesday.nth(0)).toHaveAccessibleName('Edit Tuesday, until 02:00, continues from the night before');
    await expect(tuesday.nth(0)).toContainText('until 02:00 (continues from the night before)');
    await expect(tuesday.nth(1)).toHaveAccessibleName('Edit Tuesday, 09:00 to 12:00');
    await expectNoPageOverflow(page);

    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toContainText('Hours saved');
    const saved = savedIntervals(calls);
    expect(saved).toContainEqual({ weekday: 1, startLocal: '09:00', endLocal: '24:00' });
    expect(saved).toContainEqual({ weekday: 2, startLocal: '00:00', endLocal: '02:00' });
    expect(saved).toContainEqual({ weekday: 2, startLocal: '09:00', endLocal: '12:00' });
  });

  test('keeping the times leaves the draft unchanged and shows the plain error', async ({ page }) => {
    const { dialog } = await open(page, stateWith(monday()), 'Monday');
    await setTime(dialog.getByRole('group', { name: 'Closes' }), '02:00');
    await dialog.getByRole('button', { name: 'Change the times' }).click();
    await expect(dialog.getByText('Open until 02:00 the next day?')).toHaveCount(0);
    await expect(dialog.getByText('Closing time must be after opening time.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: /Edit Monday, 09:00 to 13:00/ })).toBeVisible();
  });

  test('the week wraps: Sunday night continues on Monday', async ({ page }) => {
    const { dialog } = await open(page, stateWith([{ weekday: 0, startLocal: '20:00', endLocal: '24:00' }, ...monday()]), 'Sunday');
    await setTime(dialog.getByRole('group', { name: 'Closes' }), '03:00');
    await dialog.getByRole('button', { name: 'Yes, open until 03:00' }).click();
    const mondayChips = page.getByRole('button', { name: /^Edit Monday, / });
    await expect(mondayChips.nth(0)).toHaveAccessibleName('Edit Monday, until 03:00, continues from the night before');
    await expect(mondayChips.nth(1)).toHaveAccessibleName('Edit Monday, 09:00 to 13:00');
  });

  test('refuses (with a reason) when the new first part would overlap the same day', async ({ page }) => {
    const { dialog } = await open(
      page,
      stateWith([
        { weekday: 1, startLocal: '09:00', endLocal: '13:00' },
        { weekday: 1, startLocal: '14:00', endLocal: '19:00' },
      ]),
      'Monday',
    );
    await setTime(dialog.getByRole('group', { name: 'Closes' }).first(), '02:00');
    await dialog.getByRole('button', { name: 'Yes, open until 02:00' }).click();
    await expect(dialog.getByText('These hours overlap.')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('Copy to other days gives every copied day its own next-day tail', async ({ page }) => {
    const { dialog, calls } = await open(page, stateWith(monday()), 'Monday');
    await setTime(dialog.getByRole('group', { name: 'Closes' }), '01:00');
    await dialog.getByRole('button', { name: 'Fri' }).click();
    await dialog.getByRole('button', { name: 'Sat' }).click();
    await dialog.getByRole('button', { name: 'Yes, open until 01:00' }).click();
    await expect(page.getByRole('button', { name: /Edit Friday, 09:00 to 24:00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit Saturday, until 01:00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit Saturday, 09:00 to 24:00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit Sunday, until 01:00/ })).toBeVisible();
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toContainText('Hours saved');
    const saved = savedIntervals(calls);
    for (const weekday of [2, 6, 0]) expect(saved).toContainEqual({ weekday, startLocal: '00:00', endLocal: '01:00' });
    for (const weekday of [1, 5, 6]) expect(saved).toContainEqual({ weekday, startLocal: '09:00', endLocal: '24:00' });
  });

  test('says why when the next day is already full', async ({ page }) => {
    const full: Iv[] = [0, 1, 2, 3, 4, 5].map((k) => ({
      weekday: 2,
      startLocal: `${String(8 + k * 2).padStart(2, '0')}:00`,
      endLocal: `${String(9 + k * 2).padStart(2, '0')}:00`,
    }));
    const { dialog } = await open(page, stateWith([...monday(), ...full]), 'Monday');
    await setTime(dialog.getByRole('group', { name: 'Closes' }), '02:00');
    await dialog.getByRole('button', { name: 'Yes, open until 02:00' }).click();
    await expect(dialog.getByText(/Tuesday already has 6 blocks/)).toBeVisible();
  });

  test('shows the after-midnight hint', async ({ page }) => {
    const { dialog } = await open(page, stateWith(monday()), 'Monday');
    await expect(dialog.getByText(/Hours after midnight belong to the next day/)).toBeVisible();
  });

  test('Arabic: right to left, the times stay left to right, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page, { state: stateWith(monday()) });
    await page.goto('/app/hours');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: /الإثنين|الاثنين/ }).first().click();
    const dialog = page.getByRole('dialog');
    // Opens hours, Opens minutes, Closes hours, Closes minutes: the selects keep dir=ltr inside the rtl page.
    await expect(dialog.getByRole('combobox').first().locator('xpath=ancestor::div[@dir="ltr"][1]')).toHaveCount(1);
    await dialog.getByRole('combobox').nth(2).selectOption('02');
    await expect(dialog.getByText('هل تريد البقاء مفتوحاً حتى 02:00 من اليوم التالي؟')).toBeVisible();
    await expectNoHorizontalOverflow(dialog, 'hours sheet (ar)');
    await expectNoPageOverflow(page);
  });
});
