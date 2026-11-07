import type { CategoriesQueryT } from '@/server/contracts/directory';
import { earliestNextFree } from '@/server/domain/nextFree';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import { directoryRepo } from '@/server/repositories/directory.repo';
import { liveNextFree } from './directoryLive';

/** The category panel computes slots for the first N businesses of each category only (directory order). */
export const CATEGORY_LIVE_BUSINESSES = 6;
export const POPULAR_SERVICES = 5;

export interface CategoriesDeps {
  now: () => Date;
}
const defaults: CategoriesDeps = { now: () => new Date() };

export const categoriesService = {
  /**
   * Public home-page aggregates for every fixed category key (zero places included): places and cheapest price
   * from SQL aggregates, top-5 popular services from one ranked query, and the earliest next-free time among the
   * first 6 businesses of the category (a bounded batch, not every business). The per-IP limit is the route's.
   */
  async list(query: CategoriesQueryT, deps: CategoriesDeps = defaults) {
    const now = deps.now();
    const [totals, popular, top] = await Promise.all([
      directoryRepo.categoryTotals(query.area, CATEGORY_KEYS),
      directoryRepo.popularServices(query.area, CATEGORY_KEYS, POPULAR_SERVICES),
      directoryRepo.topBusinessIds(query.area, CATEGORY_KEYS, CATEGORY_LIVE_BUSINESSES),
    ]);
    const lives = await liveNextFree(
      top.map((t) => t.id),
      now,
    );
    return {
      categories: CATEGORY_KEYS.map((category) => {
        const total = totals.find((t) => t.category === category);
        const candidates = top
          .filter((t) => t.category === category)
          .map((t) => lives.get(t.id))
          .filter((l): l is NonNullable<typeof l> => l !== undefined);
        const best = earliestNextFree(candidates);
        return {
          category,
          places: total?.places ?? 0,
          fromPrice: total?.fromPrice ?? null,
          nextFree: best?.nextFree
            ? {
                startAt: best.nextFree.startAt.toISOString(),
                service: best.nextFree.service,
                business: { slug: best.slug, name: best.name, timezone: best.timezone },
              }
            : null,
          popularServices: popular
            .filter((p) => p.category === category)
            .map((p) => ({ name: p.name, fromPrice: p.fromPrice })),
        };
      }),
    };
  },
};
