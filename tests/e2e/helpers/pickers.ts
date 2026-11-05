import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the custom Select, TimePicker and DatePicker (F69-D). The native controls are gone, so specs no longer
 * call `selectOption` or fill `type=date`. Every picker is a button with role `combobox` named by its label; its
 * options live in a sheet (phones) or popover (md and up) that is portaled to the body, so options are looked up on
 * the page, never inside the form.
 *
 * `label` is the visible label ("Service") or the combobox Locator itself. `within` narrows the search (a dialog)
 * and `nth` picks one of several same-named pickers (two "Opens" rows).
 */
export type PickerRef = string | RegExp | Locator;
export type PickerOpts = {
  within?: Locator;
  nth?: number;
  /** Column names when the UI is not English (the Arabic ones are "الساعات" and "الدقائق"). */
  names?: { hours: string; minutes: string };
};

export function picker(page: Page, label: PickerRef, opts: PickerOpts = {}): Locator {
  if (typeof label !== 'string' && !(label instanceof RegExp)) return label;
  const scope = opts.within ?? page;
  return scope.getByRole('combobox', { name: label, exact: typeof label === 'string' }).nth(opts.nth ?? 0);
}

/**
 * The same field, found by its id. While a picker is open as a phone sheet the rest of the page is hidden from the
 * accessibility tree (aria-hidden by the modal), so a role query for the field finds nothing until it closes.
 */
export async function stable(page: Page, label: PickerRef, opts?: PickerOpts): Promise<Locator> {
  const id = await picker(page, label, opts).getAttribute('id');
  return page.locator(`[id="${id}"]`);
}

/** Open the picker (if it is not open) and return the trigger (by id, so it stays reachable while open). */
async function openPicker(page: Page, label: PickerRef, opts?: PickerOpts) {
  const found = picker(page, label, opts);
  await found.scrollIntoViewIfNeeded();
  const trigger = await stable(page, label, opts);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await found.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return trigger;
}

/** The text on the closed field. */
export async function pickerText(page: Page, label: PickerRef, opts?: PickerOpts) {
  return ((await picker(page, label, opts).innerText()) ?? '').trim();
}

/** Choose an option of a Select by its visible text (exact, or a regexp). */
export async function selectOption(
  page: Page,
  label: PickerRef,
  optionText: string | RegExp,
  opts?: PickerOpts,
) {
  const trigger = await openPicker(page, label, opts);
  const option = page
    .getByRole('option', { name: optionText, exact: typeof optionText === 'string' })
    .first();
  await option.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

/** Search a searchable Select, then choose the option. */
export async function searchAndSelect(
  page: Page,
  label: PickerRef,
  query: string,
  optionText: string | RegExp,
  opts?: PickerOpts,
) {
  await openPicker(page, label, opts);
  await page.getByRole('combobox', { name: 'Search', exact: true }).fill(query);
  await page.getByRole('option', { name: optionText, exact: typeof optionText === 'string' }).first().click();
}

/** Choose `HH:mm` in a TimePicker (hours column, then minutes column). `24:00` is the end-of-day option. */
export async function pickTime(page: Page, label: PickerRef, hm: string, opts?: PickerOpts) {
  const trigger = await openPicker(page, label, opts);
  const [h, m] = hm.split(':') as [string, string];
  await page
    .getByRole('listbox', { name: opts?.names?.hours ?? 'Hours', exact: true })
    .getByRole('option', { name: new RegExp(`^${h}(\\s|$)`) })
    .click();
  if (h !== '24') {
    await page
      .getByRole('listbox', { name: opts?.names?.minutes ?? 'Minutes', exact: true })
      .getByRole('option', { name: m, exact: true })
      .click();
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveText(hm);
}

/** Choose a `yyyy-MM-dd` day in a DatePicker, paging through the months to reach it. */
export async function pickDate(page: Page, label: PickerRef, ymd: string, opts?: PickerOpts) {
  const trigger = await openPicker(page, label, opts);
  await goToMonth(page, ymd);
  await page.locator(`[data-ymd="${ymd}"]`).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

/** Page the open calendar to the month of `ymd` with the previous / next buttons. */
export async function goToMonth(page: Page, ymd: string, names = { prev: 'Previous month', next: 'Next month' }) {
  const monthOf = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  const diffNow = async () => {
    const shown = await page.locator('[data-ymd]').first().getAttribute('data-ymd');
    return monthOf(ymd) - monthOf(shown!);
  };
  // Far away (a 2036 date from 2026): jump by years with Shift+PageUp / Shift+PageDown, as a keyboard user would.
  const far = await diffNow();
  if (Math.abs(far) >= 12) {
    await page.locator('[data-ymd][tabindex="0"]').focus();
    const years = Math.trunc(far / 12);
    for (let i = 0; i < Math.abs(years); i++) await page.keyboard.press(years > 0 ? 'Shift+PageDown' : 'Shift+PageUp');
  }
  for (let i = 0; i < 24; i++) {
    const diff = await diffNow();
    if (diff === 0) return;
    await page.getByRole('button', { name: diff > 0 ? names.next : names.prev, exact: true }).click();
  }
  throw new Error(`could not reach the month of ${ymd}`);
}

/** The first and last day shown that are enabled in the open calendar (min / max checks). */
export async function enabledDays(page: Page) {
  const days = page.locator('[data-ymd]:not([disabled])');
  const count = await days.count();
  return {
    first: count ? await days.first().getAttribute('data-ymd') : null,
    last: count ? await days.last().getAttribute('data-ymd') : null,
    count,
  };
}
