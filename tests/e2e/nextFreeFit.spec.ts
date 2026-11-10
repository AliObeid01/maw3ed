import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { layoutShift, mockHomeHero, observeLayoutShift } from './helpers/homeMock';

// PR-16 item 3: on lg+ the blue "Next free" panel fits its rows (1 row is short, 4 rows is taller) while the hero
// keeps the height of the loading skeleton, so nothing around it moves when the data arrives.

const panel = (page: Page) => page.getByTestId('next-free-panel');
const hero = (page: Page) => page.locator('main > section').first();

async function heights(page: Page) {
  return {
    panel: (await panel(page).boundingBox())!.height,
    hero: (await hero(page).boundingBox())!.height,
  };
}

async function openWith(page: Page, rows: number, width: number, delay = 0) {
  await observeLayoutShift(page);
  await mockHomeHero(page, { rows, panelDelayMs: delay });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
});

for (const width of [1440, 1024]) {
  test(`at ${width} px a one-row panel is clearly shorter than a four-row panel and the hero keeps its height`, async ({ page }) => {
    await openWith(page, 4, width, 800);
    await expect(panel(page).getByRole('status')).toBeVisible(); // skeleton
    const loading = await heights(page);
    await expect(panel(page).getByRole('listitem')).toHaveCount(4);
    const four = await heights(page);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openWith(page, 1, width);
    await expect(panel(page).getByRole('listitem')).toHaveCount(1);
    const one = await heights(page);

    if (process.env.E2E_NUMBERS) console.log(`NUMBERS width=${width} loading=${JSON.stringify(loading)} four=${JSON.stringify(four)} one=${JSON.stringify(one)}`);
    expect(one.panel).toBeLessThan(four.panel - 150); // three rows of 72 px less
    expect(one.panel).toBeLessThan(0.75 * four.panel);
    // The hero is as tall with one row as it was while the skeleton was showing: nothing below it moves.
    expect(Math.abs(one.hero - loading.hero)).toBeLessThanOrEqual(1);
    expect(Math.abs(four.hero - loading.hero)).toBeLessThanOrEqual(1);
  });
}

for (const rows of [1, 4]) {
  test(`layout shift stays below 0.01 while ${rows} row(s) load at 1440 px`, async ({ page }) => {
    await openWith(page, rows, 1440, 800);
    await expect(panel(page).getByRole('status')).toBeVisible();
    await expect(panel(page).getByRole('listitem')).toHaveCount(rows);
    await expect(panel(page).getByText('Times can be taken before you book')).toBeVisible();
    if (process.env.E2E_NUMBERS) console.log(`CLS rows=${rows} ${await layoutShift(page)}`);
    expect(await layoutShift(page)).toBeLessThan(0.01);
  });
}

test('two rows: sized between one and four', async ({ page }) => {
  await openWith(page, 2, 1440);
  await expect(panel(page).getByRole('listitem')).toHaveCount(2);
  const two = (await heights(page)).panel;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openWith(page, 4, 1440);
  await expect(panel(page).getByRole('listitem')).toHaveCount(4);
  const four = (await heights(page)).panel;
  expect(two).toBeLessThan(four - 60);
});

for (const [name, opts] of [
  ['empty', { rows: 0 }],
  ['an error', { panelStatus: 500 }],
  ['a 429', { panelStatus: 429 }],
] as const) {
  test(`the panel is hidden cleanly on ${name}: no panel, no spinner, the column collapses`, async ({ page }) => {
    await observeLayoutShift(page);
    await mockHomeHero(page, opts);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="next-free-panel"] [role="status"]')).toHaveCount(0);
    // The reserved column is released: the hero is no taller than its text column needs (well under the 496 px panel).
    const column = page.getByTestId('next-free-column');
    await expect.poll(async () => (await column.boundingBox())?.height ?? 0).toBeLessThan(40);
  });
}

test('Arabic, right to left, 1440 and 1024: the one-row panel fits its content and sits at the start of the hero', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  for (const width of [1440, 1024]) {
    await openWith(page, 1, width);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(panel(page).getByRole('listitem')).toHaveCount(1);
    const { panel: h } = await heights(page);
    expect(h).toBeLessThan(380);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
