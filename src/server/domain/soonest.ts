/**
 * Pure ranking helpers for `GET /api/public/directory?sort=soonest`. No I/O, no clock: the caller has already
 * computed every `startAt` (the next-free instant) with the slot engine.
 */
export interface SoonestItem {
  id: string;
  name: string;
  category: string | null;
  startAt: Date;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Earliest instant first; equal instants fall back to name, then id, so the order never depends on input order. */
export function rankSoonest<T extends SoonestItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || cmp(a.name, b.name) || cmp(a.id, b.id),
  );
}

const keyOf = (category: string | null) => (category ?? '').trim().toLowerCase();

/**
 * Round-robin over categories for an input already ranked by `rankSoonest`: the soonest business of each
 * category first (categories ordered by their soonest time), then the second of each, and so on, until `limit`.
 */
export function spreadByCategory<T extends SoonestItem>(ranked: readonly T[], limit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of ranked) {
    const key = keyOf(item.category);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const lists = [...groups.values()]; // Map keeps first-seen order = order of each category's soonest item
  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let any = false;
    for (const list of lists) {
      const next = list[round];
      if (!next) continue;
      any = true;
      out.push(next);
      if (out.length === limit) return out;
    }
    if (!any) break;
  }
  return out;
}
