import type { Page } from '@playwright/test';
import { beirut, biz, mockExplore, type Biz } from './helpers/explore';
import { expect, test } from './helpers/test';

// PR-22: the cards of one row share row tracks (CSS subgrid), so the services list, the free-times label, the first
// time chip and the CTA start at the same y across the row, whatever each card holds. The directory API is mocked with
// deliberately mismatched cards.

const times = (n: number) => Array.from({ length: n }, (_, i) => beirut(0, 14 + Math.floor(i / 2), (i % 2) * 30 + 15));
const svc = (n: number) =>
  ['Foot reflexology', 'Swedish massage', 'Aromatherapy massage', 'Moroccan bath'].slice(0, n).map((name, i) => ({
    name,
    durationMin: 30 + 15 * i,
    price: 35 + 5 * i,
  }));

const mismatched: Biz[] = [
  // Short address: the status used to share its line.
  biz({ slug: 'a', name: 'Blue Harbour Massage Studio', category: 'barbers', area: 'tyre', address: 'Tyre Corniche', serviceCount: 5, services: svc(3), freeTimes: times(3), openStatus: { open: true, until: '20:00' } }),
  // Long address.
  biz({ slug: 'b', name: 'Olive Grove Wellness Spa', category: 'barbers', area: 'beirut', address: 'Jal el Dib Highway, Metn, next to the old fuel station', serviceCount: 6, services: svc(3), freeTimes: times(3), openStatus: { open: true, until: '20:00' } }),
  // One service, no "+N more", one chip, closed.
  biz({ slug: 'c', name: 'Serenity', category: 'barbers', area: 'jounieh', address: 'Maameltein', serviceCount: 1, services: svc(1), freeTimes: times(1), openStatus: { open: false, opensAt: '09:00' } }),
  // Two-line name, no open status, chips that wrap (3 chips at 64 px+).
  biz({ slug: 'd', name: 'The Extraordinarily Long Named Cedar Wellness and Massage Retreat', category: 'barbers', area: 'beirut', address: 'Hamra', serviceCount: 4, services: svc(4).slice(0, 3), freeTimes: times(3) }),
  // No free times.
  biz({ slug: 'e', name: 'Plain Barbers', category: 'barbers', area: 'sidon', address: 'Riad El Solh', serviceCount: 2, services: svc(2), freeTimes: [], nextFree: null, openStatus: { open: true } }),
  biz({ slug: 'f', name: 'Quick Cuts', category: 'barbers', area: 'sidon', address: 'Main St', serviceCount: 3, services: svc(3), freeTimes: times(2), openStatus: { open: true, until: '18:00' } }),
];

type Metrics = { top: number; bottom: number; left: number; right: number; ctaLeft: number; ctaRight: number; services: number | null; label: number | null; chip: number | null; cta: number };

/** Group the cards by row (same top) and read the y of each aligned section. */
async function rows(page: Page, scope: string) {
  const metrics = await page.locator(`${scope} [data-testid="business-card"]`).evaluateAll((cards) =>
    cards.map((c) => {
      const y = (el: Element | null) => (el ? el.getBoundingClientRect().top : null);
      const links = c.querySelectorAll('a');
      const r = c.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        ctaLeft: (links[links.length - 1] ?? c).getBoundingClientRect().left,
        ctaRight: (links[links.length - 1] ?? c).getBoundingClientRect().right,
        services: y(c.querySelector('[data-testid="card-services"]')),
        label: y(c.querySelector('[data-testid="free-label"]')),
        chip: y(c.querySelector('[data-testid="free-label"] + ul a')),
        cta: y(links[links.length - 1] ?? null)!,
      } as Metrics;
    }),
  );
  const byRow = new Map<number, Metrics[]>();
  for (const m of metrics) {
    const key = Math.round(m.top);
    byRow.set(key, [...(byRow.get(key) ?? []), m]);
  }
  return [...byRow.values()];
}

function expectAligned(group: Metrics[]) {
  for (const key of ['services', 'label', 'chip', 'cta'] as const) {
    const ys = group.map((m) => m[key]).filter((v): v is number => v !== null);
    expect(Math.max(...ys) - Math.min(...ys), `${key} y spread`).toBeLessThanOrEqual(1);
  }
  // The CTA button stays inside its card (a margin on a full-width button once pushed it past the card edge).
  for (const m of group) {
    expect(m.ctaLeft, 'CTA inside card (start)').toBeGreaterThanOrEqual(m.left - 0.5);
    expect(m.ctaRight, 'CTA inside card (end)').toBeLessThanOrEqual(m.right + 0.5);
  }
  const heights = group.map((m) => m.bottom - m.top);
  expect(Math.max(...heights) - Math.min(...heights), 'card height spread').toBeLessThanOrEqual(1);
}

const cases = [
  { name: '1440', width: 1440, height: 900, perRow: 3 },
  { name: '768', width: 768, height: 1000, perRow: 2 },
] as const;

for (const c of cases) {
  test(`Explore: mismatched cards line up across a row at ${c.name} px`, async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop viewport sizes are set here');
    await page.setViewportSize({ width: c.width, height: c.height });
    await mockExplore(page, { all: mismatched });
    await page.goto('/directory');
    await expect(page.getByTestId('business-card')).toHaveCount(6);
    const grouped = await rows(page, 'main');
    expect(grouped.length).toBe(6 / c.perRow);
    for (const g of grouped) {
      expect(g.length).toBe(c.perRow);
      expectAligned(g);
    }
  });
}

test('home: a row of three mismatched cards lines up at 1440 px', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop viewport sizes are set here');
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockExplore(page, { all: mismatched.slice(0, 3) });
  await page.goto('/');
  await expect(page.getByTestId('top-places').getByTestId('business-card')).toHaveCount(3);
  const grouped = await rows(page, '[data-testid="top-places"]');
  expect(grouped.length).toBe(1);
  expectAligned(grouped[0]!);
});

test('Arabic RTL: mismatched cards line up at 1440 px', async ({ page, context }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop viewport sizes are set here');
  await context.addCookies([{ name: 'locale', value: 'ar', url: 'http://localhost:3000' }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockExplore(page, { all: mismatched });
  await page.goto('/directory');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('business-card')).toHaveCount(6);
  for (const g of await rows(page, 'main')) expectAligned(g);
});

test('360 px: the home carousel shows one card at a time with the CTA visible', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone project only');
  await mockExplore(page, { all: mismatched.slice(0, 3) });
  await page.goto('/');
  const cards = page.getByTestId('top-places').getByTestId('business-card');
  await expect(cards).toHaveCount(3);
  const first = cards.first();
  await expect(first.locator('a').last()).toBeVisible();
  const vw = page.viewportSize()!.width;
  const box = (await first.boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  expect(second.x).toBeGreaterThan(box.x + box.width - 1); // the next card is beside it (peeking), not stacked
  expect(Math.abs(second.y - box.y)).toBeLessThanOrEqual(1);
});
