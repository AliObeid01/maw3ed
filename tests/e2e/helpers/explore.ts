import type { Page } from '@playwright/test';
import { clockNow, freezeClock } from './clock';
import { selectOption } from './pickers';

/** Beirut local time `days` from the virtual now at hh:mm, as a UTC instant. */
export const beirut = (days: number, hh: number, mm: number, zone = 'Asia/Beirut') =>
  clockNow()
    .setZone(zone)
    .plus({ days })
    .set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
    .toUTC()
    .toISO()!;

export type Biz = Record<string, unknown> & { slug: string; name: string };

export const biz = (over: Record<string, unknown> = {}): Biz =>
  ({
    slug: 'abu-karam',
    name: 'Abu Karam Barbershop',
    category: 'barbers',
    area: 'sidon',
    address: 'Riad El Solh St',
    serviceCount: 3,
    fromPrice: 8,
    timezone: 'Asia/Beirut',
    nextFree: { startAt: beirut(0, 15, 30), service: { id: 's1', name: 'Haircut', durationMin: 30 } },
    freeTimes: [beirut(0, 15, 30), beirut(0, 16, 0), beirut(0, 17, 30), beirut(0, 18, 0)],
    services: [
      { name: 'Haircut', durationMin: 30, price: 8 },
      { name: 'Beard trim', durationMin: 20, price: 12.5 },
    ],
    ...over,
  }) as Biz;

export const fade = biz({
  slug: 'fade-lab',
  name: 'Fade Lab',
  area: 'beirut',
  address: 'Mar Mikhael',
  fromPrice: 15,
  nextFree: { startAt: beirut(1, 12, 15), service: { id: 's2', name: 'Fade', durationMin: 45 } },
  freeTimes: [beirut(1, 12, 15), beirut(1, 13, 0)],
  services: [{ name: 'Fade', durationMin: 45, price: 15 }],
});
export const salon = biz({
  slug: 'studio-nour',
  name: 'Studio Nour',
  category: 'hair-salons',
  area: 'beirut',
  address: 'Hamra Street',
  fromPrice: 20,
  nextFree: null,
  freeTimes: [],
  services: [{ name: 'Colour', durationMin: 90, price: 60 }],
});

export const ALL = [biz(), fade, salon];

export type ExploreMock = {
  /** Every directory request, as `path?query` in order. */
  requests: string[];
  categories: string[];
  /** Change what the next requests answer. */
  setMode: (mode: Mode) => void;
};
type Mode = { status?: number; pages?: Record<string, { businesses: Biz[]; nextCursor: string | null }> };

const POPULAR: Record<string, string[]> = {
  barbers: ['Haircut', 'Beard trim'],
  'hair-salons': ['Colour', 'Blow dry'],
};

/**
 * Answers /api/public/directory like the real endpoint (AND of search, service, area, category and `when`) and
 * /api/public/categories with popular services, on the frozen clock. `pages` overrides the answer per `cursor`
 * (key '' = first page).
 */
export async function mockExplore(
  page: Page,
  opts: { all?: Biz[]; mode?: Mode } = {},
): Promise<ExploreMock> {
  await freezeClock(page);
  const all = opts.all ?? ALL;
  let mode: Mode = opts.mode ?? {};
  const seen: ExploreMock = { requests: [], categories: [], setMode: (m) => (mode = m) };
  await page.route('**/api/public/categories**', (route) => {
    const url = new URL(route.request().url());
    seen.categories.push(url.search);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: Object.entries(POPULAR).map(([category, names]) => ({
          category,
          places: 2,
          fromPrice: 8,
          nextFree: null,
          popularServices: names.map((name) => ({ name, fromPrice: 8 })),
        })),
      }),
    });
  });
  await page.route('**/api/public/directory**', (route) => {
    const url = new URL(route.request().url());
    seen.requests.push(`${url.pathname}${url.search}`);
    if (mode.status && mode.status !== 200) {
      return route.fulfill({
        status: mode.status,
        contentType: 'application/json',
        headers: mode.status === 429 ? { 'Retry-After': '60' } : {},
        body: JSON.stringify({ error: { code: mode.status === 429 ? 'RATE_LIMITED' : 'INTERNAL', message: 'x' } }),
      });
    }
    const q = url.searchParams;
    const lc = (name: string) => (q.get(name) ?? '').toLowerCase();
    const cursor = q.get('cursor') ?? '';
    const forced = mode.pages?.[cursor];
    const businesses =
      forced?.businesses ??
      all.filter(
        (b) =>
          String(b.name).toLowerCase().includes(lc('search')) &&
          (!lc('category') || String(b.category).toLowerCase() === lc('category')) &&
          (!q.get('area') || b.area === q.get('area')) &&
          (!lc('service') ||
            ((b.services as { name: string }[] | undefined) ?? []).some((s) =>
              s.name.toLowerCase().includes(lc('service')),
            )) &&
          // `when`: only businesses with free times that day (the mock keeps today's and tomorrow's).
          (!q.get('when') || ((b.freeTimes as string[] | undefined) ?? []).length > 0),
      );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ businesses, nextCursor: forced ? forced.nextCursor : null }),
    });
  });
  return seen;
}

/** True on the phone layout (the Filters button replaces the inline bar). */
export const isPhone = async (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Change filters on either layout: on a phone open the sheet, run `edit`, press Apply. */
export async function withFilters(page: Page, edit: () => Promise<void>) {
  const phone = await isPhone(page);
  if (phone) await page.getByRole('button', { name: /^Filters/ }).click();
  await edit();
  if (phone) await page.getByRole('button', { name: 'Apply' }).click();
}

export const chooseArea = (page: Page, area: string) =>
  withFilters(page, () => selectOption(page, 'Area', area));
export const chooseCategory = (page: Page, category: string) =>
  withFilters(page, () => selectOption(page, 'Category', category));

/** Submit the search box (Enter). */
export async function search(page: Page, text: string) {
  const box = page.getByRole('searchbox', { name: 'Business name' });
  await box.fill(text);
  await box.press('Enter');
}
