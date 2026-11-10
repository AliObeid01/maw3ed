import type { Page } from '@playwright/test';
import { clockNow, freezeClock } from './clock';

// Minimal, self-contained mock of the two public requests the home hero makes (categories for the Popular chips,
// directory?sort=soonest for the Next free panel). Fake businesses only. Used by heroChips / nextFreeFit specs and
// by the visual passes.

/** Real-like long service names (a clinic). */
export const LONG_SERVICES = [
  'Plastic Surgery Consultation',
  'Botox Treatment',
  'Cheek Filler',
  'Aesthetic Surgery',
];

const CATEGORY_KEYS = ['barbers', 'hair-salons', 'dental-clinics', 'beauty-clinics', 'spa-massage', 'physiotherapy'];

const at = (days: number, hh: number, mm: number) =>
  clockNow().setZone('Asia/Beirut').plus({ days }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toUTC().toISO()!;

export const fakeBusiness = (i: number, name = `Studio ${i + 1}`) => ({
  slug: `fake-biz-${i + 1}`,
  name,
  category: CATEGORY_KEYS[i % CATEGORY_KEYS.length],
  area: 'beirut',
  address: 'Hamra Street',
  serviceCount: 3,
  fromPrice: 10,
  timezone: 'Asia/Beirut',
  logoUrl: null,
  nextFree: { startAt: at(0, 10 + i, 30), service: { id: `s${i}`, name: 'Consultation', durationMin: 30 } },
  freeTimes: [at(0, 10 + i, 30)],
  services: [{ name: 'Consultation', durationMin: 30, price: 10 }],
});

export type HomeMockOpts = {
  /** One popular service name per category, in category order; undefined = the default (few, so the static chips show). */
  popular?: string[];
  /** Number of rows the Next free panel answers with (0 = empty list). */
  rows?: number;
  rowNames?: string[];
  /** The panel request fails with this status. */
  panelStatus?: number;
  /** Hold the categories answer for this long. */
  categoriesDelayMs?: number;
  /** Hold the panel answer for this long. */
  panelDelayMs?: number;
};

export async function mockHomeHero(page: Page, opts: HomeMockOpts = {}) {
  await freezeClock(page);
  await page.route('**/api/public/categories**', async (route) => {
    if (opts.categoriesDelayMs) await new Promise((r) => setTimeout(r, opts.categoriesDelayMs));
    const popular = opts.popular;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: [
          ...CATEGORY_KEYS.map((category, i) => ({
            category,
            places: 3,
            fromPrice: 10,
            nextFree: null,
            popularServices: popular?.[i] ? [{ name: popular[i], fromPrice: 10 }] : [],
          })),
          { category: 'other', places: 0, fromPrice: null, nextFree: null, popularServices: [] },
        ],
      }),
    });
  });
  await page.route('**/api/public/directory**', async (route) => {
    const url = new URL(route.request().url());
    const soonest = url.searchParams.get('sort') === 'soonest';
    if (soonest && opts.panelDelayMs) await new Promise((r) => setTimeout(r, opts.panelDelayMs));
    if (soonest && opts.panelStatus) {
      return route.fulfill({
        status: opts.panelStatus,
        contentType: 'application/json',
        body: '{"error":{"code":"RATE_LIMITED","message":"x"}}',
      });
    }
    const n = opts.rows ?? 4;
    const businesses = soonest || url.searchParams.get('include')
      ? Array.from({ length: n }, (_, i) => fakeBusiness(i, opts.rowNames?.[i]))
      : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(soonest ? { businesses } : { businesses, nextCursor: null }),
    });
  });
}

/** Record layout-shift entries from the start of the page (call before goto). Read with `layoutShift(page)`. */
export async function observeLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export const layoutShift = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
