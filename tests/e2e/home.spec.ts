import { expect, test } from './helpers/test';
import { ORIGIN } from './helpers/clock';

// The home page needs no API. F54: the hero preview is decorative and only shows from lg.

test('the hero preview is decorative, labelled Example, and only visible on wide screens', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Fewer no-shows. More time.' })).toBeVisible();
  const preview = page.getByTestId('hero-preview');
  await expect(preview).toHaveAttribute('aria-hidden', 'true');
  await expect(preview).toContainText('Example');
  if (info.project.name === 'desktop') {
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Slot booked');
    await expect(preview).toContainText('Reminder 24 hours before');
    await expect(preview).toContainText('A spot just opened up');
    expect(await preview.locator('img, svg image, script, a, button').count()).toBe(0);
  } else {
    await expect(preview).toBeHidden();
  }
  // Nothing in the preview is reachable by the keyboard.
  await expect(preview.locator('a, button, input, [tabindex]')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Arabic: the preview is translated and mirrored, with no overflow', async ({ page, context }, info) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const preview = page.getByTestId('hero-preview');
  await expect(preview).toContainText('مثال');
  if (info.project.name === 'desktop') {
    await expect(preview).toBeVisible();
    // In RTL the text column comes first, so the preview sits on the physical left.
    const hero = await page.getByRole('heading', { level: 1 }).boundingBox();
    const card = await preview.boundingBox();
    expect(card!.x).toBeLessThan(hero!.x);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
