import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { LONG_SERVICES, layoutShift, mockHomeHero, observeLayoutShift } from './helpers/homeMock';

// PR-16 item 2: the hero "Popular" chips with REAL-LIKE long service names. At sm and up the chips wrap onto at
// most two rows (no scroller, no scrollbar, nothing half cut); on phones they stay on one line, scrollable, with
// the native scrollbar hidden and a soft fade on the scrolling side.

const chipsBox = (page: Page) => page.getByTestId('hero-chips');

type Metrics = {
  scrollWidth: number;
  clientWidth: number;
  rows: number;
  visible: number;
  clipped: string[];
  scrollbarWidth: string;
  overflowX: string;
  wrap: string;
  maskImage: string;
};

async function measure(page: Page): Promise<Metrics> {
  return chipsBox(page).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const links = Array.from(el.querySelectorAll('a')).filter((a) => getComputedStyle(a).visibility !== 'hidden');
    const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
    const cs = getComputedStyle(el);
    const clipped = links
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
      })
      .map((a) => a.textContent ?? '');
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rows: tops.size,
      visible: links.length,
      clipped,
      scrollbarWidth: cs.scrollbarWidth,
      overflowX: cs.overflowX,
      wrap: cs.flexWrap,
      maskImage: cs.maskImage || cs.webkitMaskImage || 'none',
    };
  });
}

async function open(page: Page, width: number) {
  await mockHomeHero(page, { popular: LONG_SERVICES, panelStatus: 500 });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(chipsBox(page).getByRole('link').first()).toHaveText('Plastic Surgery Consultation');
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
});

for (const width of [1440, 1024, 768, 640]) {
  test(`at ${width} px the chips wrap onto at most two rows, no scrollbar, nothing clipped`, async ({ page }) => {
    await open(page, width);
    const m = await measure(page);
    expect(m.wrap).toBe('wrap');
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(m.rows).toBeLessThanOrEqual(2);
    expect(m.clipped).toEqual([]);
    expect(m.visible).toBeGreaterThanOrEqual(2);
    // Room enough that a typical long service name ("Plastic Surgery Consultation") shows in full.
    const firstCut = await chipsBox(page).evaluate((el) => {
      const s = el.querySelector('a > span')!;
      return s.scrollWidth > s.clientWidth;
    });
    expect(firstCut).toBe(false);
    // Every chip says its full name on hover, even when the text is shortened.
    for (const name of LONG_SERVICES) {
      const link = chipsBox(page).getByRole('link', { name });
      if ((await link.count()) && (await link.isVisible())) await expect(link).toHaveAttribute('title', name);
    }
  });
}

test('a container too narrow for everything hides whole chips (never a half cut one) and keeps two rows', async ({ page }) => {
  await open(page, 1440);
  await chipsBox(page).evaluate((el) => {
    (el as HTMLElement).style.width = '300px'; // test-only: force a third row
  });
  // Wait for the resize observer to have hidden the chips that no longer fit (rows alone can still read 2 from the old layout).
  await expect.poll(async () => (await measure(page)).visible).toBeLessThan(LONG_SERVICES.length);
  const m = await measure(page);
  expect(m.rows).toBeLessThanOrEqual(2);
  expect(m.clipped).toEqual([]);
  // The hidden chips are out of the tab order and the accessibility tree too (visibility: hidden), not just clipped.
  const hidden = await chipsBox(page).evaluate((el) =>
    Array.from(el.querySelectorAll('a')).filter((a) => getComputedStyle(a).visibility === 'hidden').length,
  );
  expect(hidden).toBe(LONG_SERVICES.length - m.visible);

  // Sizes can change after the first fit without the container changing (a web font arriving): the fit follows.
  await chipsBox(page).evaluate((el) => {
    el.querySelectorAll('a').forEach((a) => ((a as HTMLElement).style.minWidth = '260px'));
  });
  await expect.poll(async () => (await measure(page)).clipped).toEqual([]);
  const after = await measure(page);
  expect(after.rows).toBeLessThanOrEqual(2);
  expect(after.visible).toBeLessThanOrEqual(m.visible); // fewer or equal: with wide fonts the first fit may already leave one chip
});

for (const width of [390, 360, 320]) {
  test(`at ${width} px (phone) the chips stay on one line, scroll, hide the scrollbar and fade at the end`, async ({ page }) => {
    await open(page, width);
    const m = await measure(page);
    expect(m.rows).toBe(1);
    expect(m.wrap).toBe('nowrap');
    expect(m.overflowX).toBe('auto');
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth); // there is something to scroll to
    expect(m.scrollbarWidth).toBe('none');
    expect(m.maskImage).toContain('linear-gradient');
    // No chip is wider than the row; long names are shortened with an ellipsis.
    const truncated = await chipsBox(page).evaluate((el) =>
      Array.from(el.querySelectorAll('a > span')).some((s) => s.scrollWidth > s.clientWidth),
    );
    expect(truncated).toBe(true);
    // The page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('Arabic, right to left: the fade is on the left (scrolling side), phones scroll, desktop wraps', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  await mockHomeHero(page, { popular: LONG_SERVICES, panelStatus: 500 });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(chipsBox(page).getByRole('link').first()).toBeVisible();
  const phone = await measure(page);
  expect(phone.rows).toBe(1);
  expect(phone.scrollbarWidth).toBe('none');
  expect(phone.maskImage).toMatch(/to left|270deg/); // the browser may normalise the keyword to an angle
  // A Latin business-entered name keeps its own direction inside the Arabic page, so the ellipsis cuts the END of the
  // name ("Plastic Surgery Consult..."), not the start ("...stic Surgery Consultation").
  const starts = await chipsBox(page).evaluate((el) =>
    Array.from(el.querySelectorAll('a > span.truncate')).map((s) => {
      const range = document.createRange();
      range.setStart(s.firstChild!, 0);
      range.setEnd(s.firstChild!, 1);
      return range.getBoundingClientRect().left - s.getBoundingClientRect().left;
    }),
  );
  // The first letter sits at the left edge of its chip text (an ellipsis on the right), never pushed off to the left.
  for (const offset of starts) expect(offset).toBeGreaterThanOrEqual(-1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await measure(page)).wrap).toBe('wrap');
  const wide = await measure(page);
  expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth);
  expect(wide.rows).toBeLessThanOrEqual(2);
  expect(wide.clipped).toEqual([]);
});

test('no layout shift when the live names arrive (height reserved), desktop and phone', async ({ page }) => {
  for (const width of [1440, 360]) {
    await observeLayoutShift(page);
    await mockHomeHero(page, { popular: LONG_SERVICES, panelStatus: 500, categoriesDelayMs: 700 });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(chipsBox(page).getByRole('link')).toHaveCount(4);
    const before = await chipsBox(page).boundingBox();
    await expect(chipsBox(page).getByRole('link').first()).toHaveText('Plastic Surgery Consultation');
    const after = await chipsBox(page).boundingBox();
    expect(after!.height).toBe(before!.height);
    expect(after!.y).toBe(before!.y);
    expect(await layoutShift(page)).toBeLessThan(0.01);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
