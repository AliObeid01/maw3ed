import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { clockNow } from '../helpers/clock';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';
import { pickDate, pickTime, picker, searchAndSelect, selectOption, stable } from '../helpers/pickers';

// F69-D: the custom Select, TimePicker and DatePicker (mocked API, fake-session dev server). The helpers in
// helpers/pickers.ts are used everywhere else; here the pickers themselves are under test: keyboard-only use, the
// phone bottom sheet, the desktop popover, Arabic RTL, and min / max.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const today = () => clockNow().setZone('Asia/Beirut').toFormat('yyyy-MM-dd');

async function openAddService(page: Page) {
  await mockSetupApi(page, { state: defaultState() });
  await page.goto('/app/services');
  await page.getByRole('button', { name: 'Add service' }).first().click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
}

test.describe('phone: 360 px bottom sheet', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('Select opens as a bottom sheet over the form sheet, fits the viewport, Esc closes only the picker', async ({
    page,
  }) => {
    await openAddService(page);
    const trigger = await stable(page, 'Duration');
    await trigger.click();
    const surface = page.getByRole('dialog', { name: 'Duration', exact: true });
    await expect(surface).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const box = (await surface.boundingBox())!;
    expect(box.y + box.height, 'sits on the bottom edge').toBeGreaterThanOrEqual(640 - 1);
    expect(box.height, 'never taller than the viewport').toBeLessThanOrEqual(640 * 0.9);
    expect(box.width).toBeLessThanOrEqual(360);
    await expectNoHorizontalOverflow(surface, 'select sheet');
    await expectNoPageOverflow(page);
    for (const o of await surface.getByRole('option').all()) {
      expect((await o.boundingBox())!.height, 'option tap target').toBeGreaterThanOrEqual(43);
    }
    // The long list scrolls inside the sheet.
    await expect(surface.getByRole('option', { name: '2 h', exact: true })).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible(); // the form stays open
  });

  test('backdrop and the Close button close the sheet', async ({ page }) => {
    await openAddService(page);
    const trigger = await stable(page, 'Duration');
    await trigger.click();
    const surface = page.getByRole('dialog', { name: 'Duration', exact: true });
    await surface.getByRole('button', { name: 'Close' }).click();
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('DatePicker sheet: 44 px day cells, whole month visible, no page overflow', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    await picker(page, 'From, date').click();
    const surface = page.getByRole('dialog', { name: 'From, date' });
    await expect(surface).toBeVisible();
    const days = surface.locator('[data-ymd]:not([disabled])');
    for (const d of (await days.all()).slice(0, 8)) {
      const b = (await d.boundingBox())!;
      expect(b.height, 'day cell height').toBeGreaterThanOrEqual(43);
      expect(b.width, 'day cell width').toBeGreaterThanOrEqual(43);
    }
    const box = (await surface.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(640 + 1);
    await expectNoHorizontalOverflow(surface, 'date sheet');
    await expectNoPageOverflow(page);
  });

  test('TimePicker sheet shows two columns that fit 360 px', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    await picker(page, 'From, time').click();
    const surface = page.getByRole('dialog', { name: 'From, time' });
    await expect(surface.getByRole('listbox')).toHaveCount(2);
    await expectNoHorizontalOverflow(surface, 'time sheet');
    await expectNoPageOverflow(page);
  });
});

test.describe('desktop: 1440 px popover', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Select opens as a popover under the field (no backdrop), Esc closes only the picker', async ({ page }) => {
    await openAddService(page);
    const trigger = await stable(page, 'Duration');
    await trigger.click();
    const surface = page.getByRole('dialog', { name: 'Duration', exact: true });
    await expect(surface).toBeVisible();
    const t = (await trigger.boundingBox())!;
    const s = (await surface.boundingBox())!;
    expect(Math.abs(s.x - t.x), 'aligned to the field start').toBeLessThanOrEqual(12);
    expect(s.width).toBeGreaterThanOrEqual(t.width - 1);
    expect(s.y, 'under the field').toBeGreaterThanOrEqual(t.y + t.height);
    expect(s.y + s.height, 'inside the viewport').toBeLessThanOrEqual(900);
    // Selected option is announced and marked.
    await expect(surface.getByRole('option', { selected: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible(); // the form stays open
  });

  test('clicking outside closes the popover and Tab hands focus on', async ({ page }) => {
    await openAddService(page);
    const trigger = await stable(page, 'Duration');
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Duration', exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog', { name: 'Duration', exact: true })).toHaveCount(0);
    await expect(await stable(page, 'Buffer after')).toBeFocused();
  });

  test('DatePicker popover is 7 columns wide and has a Today button', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    await picker(page, 'From, date').click();
    const surface = page.getByRole('dialog', { name: 'From, date' });
    await expect(surface.getByRole('columnheader')).toHaveCount(7);
    await expect(surface.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(surface.locator(`[data-ymd="${today()}"]`)).toHaveAttribute('aria-current', 'date');
    await expectNoHorizontalOverflow(surface, 'date popover');
  });
});

test.describe('keyboard only', () => {
  test('Select: arrows, Home / End, typeahead, Enter, Esc', async ({ page }) => {
    await openAddService(page);
    const trigger = await stable(page, 'Duration');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const list = page.getByRole('listbox', { name: 'Duration' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(list).toBeFocused();
    const options = list.getByRole('option');
    const active = () => list.evaluate((el) => document.getElementById(el.getAttribute('aria-activedescendant')!)?.textContent);
    await page.keyboard.press('Home');
    expect(await active()).toBe((await options.first().textContent())!);
    await page.keyboard.press('End');
    expect(await active()).toBe((await options.last().textContent())!);
    // Typeahead: "4" lands on the first option that starts with 4.
    await page.keyboard.press('4');
    expect(await active()).toMatch(/^4/);
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText(/^4/);
    // Esc leaves the value alone.
    const before = await trigger.getAttribute('data-value');
    await trigger.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('data-value', before!);
  });

  test('searchable Select (timezone): type to filter, Enter chooses', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    const trigger = await stable(page, 'Timezone');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const search = page.getByRole('combobox', { name: 'Search', exact: true });
    await expect(search).toBeFocused();
    await page.keyboard.type('tokyo');
    const options = page.getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Asia/Tokyo');
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('data-value', 'Asia/Tokyo');
    await expect(trigger).toBeFocused();
    // No match shows a message instead of an empty box.
    await trigger.press('Enter');
    await page.keyboard.type('zzzz');
    await expect(page.getByText('No matches')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('TimePicker: type the hour, Enter, arrows in minutes, Enter; focus returns', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    const trigger = await stable(page, 'From, time');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const hours = page.getByRole('listbox', { name: 'Hours', exact: true });
    const minutes = page.getByRole('listbox', { name: 'Minutes', exact: true });
    await expect(hours).toBeFocused();
    await page.keyboard.type('14');
    await page.keyboard.press('Enter');
    await expect(minutes).toBeFocused();
    await page.keyboard.press('ArrowDown'); // 00 -> 05
    await page.keyboard.press('ArrowDown'); // 05 -> 10
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveText('14:10');
    await expect(trigger).toHaveAttribute('data-value', '14:10');
    await expect(trigger).toBeFocused();
  });

  test('DatePicker: arrows, PageDown, Home, Enter pick; Esc closes without changing', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    const trigger = await stable(page, 'From, date');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const start = today();
    const focusedDay = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ymd);
    await expect.poll(focusedDay).toBe(start);
    await page.keyboard.press('ArrowRight');
    const next = clockNow().setZone('Asia/Beirut').plus({ days: 1 }).toFormat('yyyy-MM-dd');
    await expect.poll(focusedDay).toBe(next);
    await page.keyboard.press('ArrowDown');
    await expect.poll(focusedDay).toBe(clockNow().setZone('Asia/Beirut').plus({ days: 8 }).toFormat('yyyy-MM-dd'));
    await page.keyboard.press('PageDown');
    const month = clockNow().setZone('Asia/Beirut').plus({ days: 8, months: 1 }).toFormat('yyyy-MM');
    await expect.poll(async () => (await focusedDay())?.slice(0, 7)).toBe(month);
    await page.keyboard.press('Home');
    await expect.poll(async () => (await focusedDay())?.slice(0, 7)).toMatch(/^\d{4}-\d{2}$/);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('data-value', '');
    await trigger.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('data-value', next);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('values and the business time zone', () => {
  test('pickDate / pickTime set the exact yyyy-MM-dd and HH:mm the form posts', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    await pickDate(page, 'From, date', '2036-02-29'); // a leap day ten years out
    await pickDate(page, 'To, date', '2036-02-29');
    await pickTime(page, 'From, time', '08:05');
    await pickTime(page, 'To, time', '17:00');
    await expect(picker(page, 'From, date')).toHaveAttribute('data-value', '2036-02-29');
    await expect(picker(page, 'From, date')).toHaveText('Feb 29, 2036');
    await selectOption(page, 'Reason', 'Sick');
    await page.getByRole('button', { name: 'Add time off' }).click();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/staff/p1/time-off');
    // Beirut is UTC+2 in February 2036: 08:05 local is 06:05Z.
    expect((post?.body as { startAt: string }).startAt).toBe('2036-02-29T06:05:00Z');
    expect((post?.body as { reason: string }).reason).toBe('SICK');
  });

  test('searchAndSelect picks from the long timezone list', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await searchAndSelect(page, 'Timezone', 'new york', /America\/New York/);
    await expect(picker(page, 'Timezone')).toHaveAttribute('data-value', 'America/New_York');
  });
});

test.describe('Arabic RTL', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  });

  test('calendar: mirrored chevrons and arrows, Latin digits, no overflow', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const trigger = await stable(page, /التاريخ/);
    await trigger.click();
    const surface = page.getByRole('dialog').last();
    const prev = surface.getByRole('button', { name: 'الشهر السابق' });
    const next = surface.getByRole('button', { name: 'الشهر التالي' });
    const p = (await prev.boundingBox())!;
    const n = (await next.boundingBox())!;
    expect(p.x, 'previous is on the right in RTL').toBeGreaterThan(n.x);
    // Digits are Latin everywhere: the month heading, the day numbers and the trigger text.
    const text = (await surface.innerText()) + (await trigger.innerText());
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
    await expect(surface.locator('[data-ymd]').first()).toHaveText(/^\d+$/);
    // ArrowLeft goes to the NEXT day (to the left on screen), ArrowRight to the previous.
    const focusedDay = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.ymd);
    const start = (await focusedDay())!;
    await page.keyboard.press('ArrowLeft');
    const after = (await focusedDay())!;
    expect(after > start, 'ArrowLeft moves forward in RTL').toBe(true);
    await expectNoHorizontalOverflow(surface, 'date picker (ar)');
    await expectNoPageOverflow(page);
  });

  test('time and select: Latin digits, LTR time text, Arabic labels', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/hours');
    const trigger = await stable(page, /الوقت/);
    await expect(trigger.locator('span').first()).toHaveAttribute('dir', 'ltr');
    await trigger.click();
    const surface = page.getByRole('dialog').last();
    await expect(surface.getByRole('listbox', { name: 'الساعات' })).toBeVisible();
    await expect(surface.getByRole('listbox', { name: 'الدقائق' })).toBeVisible();
    await expect(surface.getByRole('listbox').first()).toHaveAttribute('aria-label', 'الساعات');
    expect(await surface.innerText()).not.toMatch(/[٠-٩۰-۹]/);
    await expectNoHorizontalOverflow(surface, 'time picker (ar)');
  });
});
