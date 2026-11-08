import { HOME_CATEGORIES } from './categories';

/** Chips on the hero's "Popular:" row. */
export const HERO_CHIP_COUNT = 4;

type Cat = { category: string; places: number; popularServices: readonly { name: string }[] };

/**
 * The hero chips from the live categories data: the top service of each non-empty category in category order, then
 * the next one of each, and so on, de-duplicated case-insensitively (a category whose top service is already a chip offers its next), at most four. With fewer than four (or no data)
 * the static `fallback` list is used whole, so the row never looks half-filled. Names are business-entered.
 */
export function heroChips(categories: readonly Cat[] | undefined, fallback: readonly string[]): string[] {
  if (!categories || categories.length === 0) return [...fallback];
  const lists = HOME_CATEGORIES.map((key) => categories.find((c) => c.category === key))
    .filter((c): c is Cat => Boolean(c) && (c?.places ?? 0) > 0)
    .map((c) => c.popularServices.map((s) => s.name.trim()).filter(Boolean));
  const seen = new Set<string>();
  const next = lists.map(() => 0); // each category's pointer into its own ranking
  const out: string[] = [];
  const depth = Math.max(0, ...lists.map((l) => l.length));
  // One round per rank: every category offers its best service not shown yet (so a duplicate of an earlier chip does
  // not cost the category its place, it offers its next one), until there are four.
  for (let round = 0; round < depth && out.length < HERO_CHIP_COUNT; round++) {
    for (const [i, list] of lists.entries()) {
      let name: string | undefined;
      while (next[i]! < list.length) {
        const candidate = list[next[i]!++]!;
        if (!seen.has(candidate.toLowerCase())) {
          name = candidate;
          break;
        }
      }
      if (!name) continue;
      seen.add(name.toLowerCase());
      out.push(name);
      if (out.length === HERO_CHIP_COUNT) break;
    }
  }
  return out.length >= HERO_CHIP_COUNT ? out : [...fallback];
}
