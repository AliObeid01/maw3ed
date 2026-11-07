import type { DirectoryQueryT } from '@/server/contracts/directory';
import { FREE_TIMES_MAX } from '@/server/domain/nextFree';
import { UNKNOWN_IP } from '@/server/http/clientIp';
import { AppError } from '@/server/http/errors';
import { directoryRepo, type DirectoryRow } from '@/server/repositories/directory.repo';
import { rateLimiter, routeRateLimitDisabled, type RateLimiter } from './rateLimit';
import { liveNextFree, type LiveResult } from './directoryLive';

const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');

function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    )
      return { name: parsed[0], id: parsed[1] };
  } catch {
    /* fall through */
  }
  throw AppError.validation({ cursor: 'Invalid cursor.' });
}

/** Default and maximum page size when slots are computed (`include=nextFree` or `when`). */
export const LIVE_PAGE_SIZE = 12;
/** `when`: candidates are examined in batches of this size, and at most SCAN_BUDGET per request. */
export const SCAN_BATCH = 12;
export const SCAN_BUDGET = 36;

export interface DirectoryDeps {
  now: () => Date;
  limiter: Pick<RateLimiter, 'consume'>;
}
const defaults: DirectoryDeps = { now: () => new Date(), limiter: rateLimiter };

const plainItem = (b: DirectoryRow) => ({
  slug: b.slug,
  name: b.name,
  category: b.category,
  area: b.area,
  address: b.address,
  serviceCount: b.serviceCount,
  fromPrice: b.fromPrice,
});

const liveFields = (live: LiveResult | undefined) => ({
  timezone: live?.timezone,
  nextFree: live?.nextFree
    ? { startAt: live.nextFree.startAt.toISOString(), service: live.nextFree.service }
    : null,
  freeTimes: (live?.nextFree?.freeTimes ?? []).slice(0, FREE_TIMES_MAX).map((d) => d.toISOString()),
});

export const directoryService = {
  /**
   * Public. Only listed businesses that still meet readiness; no owner, staff or client data.
   *
   * Plain call: one keyset page (name, id), exactly as before.
   * `include=nextFree`: the same page (at most 12) plus `timezone`, `nextFree` and `freeTimes` per item, from
   * one batched load and the slot engine.
   * `when=yyyy-MM-dd`: keeps only businesses with a free slot that local day. Slots are computed for candidates
   * in batches of 12, at most 36 candidates per request, so a page may hold fewer than `limit` items while
   * `nextCursor` is still set (it points after the last candidate examined). Keep paging until it is null.
   */
  async list(query: DirectoryQueryT, ip?: string, deps: DirectoryDeps = defaults) {
    const live = query.include === 'nextFree' || query.when !== undefined;
    const limit = query.limit ?? (live ? LIVE_PAGE_SIZE : 24);
    if (live && limit > LIVE_PAGE_SIZE)
      throw AppError.validation({
        limit: `At most ${LIVE_PAGE_SIZE} when include or when is set.`,
      });
    if (live && ip && ip !== UNKNOWN_IP && !routeRateLimitDisabled()) {
      const decision = await deps.limiter.consume('directoryLive', ip);
      if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);
    }
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const base = {
      search: query.search,
      category: query.category,
      area: query.area,
      service: query.service,
    };
    const withLive = query.include === 'nextFree';

    if (query.when === undefined) {
      const rows = await directoryRepo.list({ ...base, after, take: limit + 1 });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const lives = withLive
        ? await liveNextFree(
            page.map((r) => r.id),
            deps.now(),
          )
        : undefined;
      return {
        businesses: page.map((b) => ({
          ...plainItem(b),
          ...(lives ? liveFields(lives.get(b.id)) : {}),
        })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.name, last.id) : null,
      };
    }

    // `when`: bounded scan.
    const now = deps.now();
    const matches: { row: DirectoryRow; live: LiveResult }[] = [];
    let cursor = after;
    let scanned = 0;
    let lastExamined: DirectoryRow | undefined;
    let exhausted = false;
    let rowsLeftInBatch = false;
    while (matches.length < limit && scanned < SCAN_BUDGET && !exhausted) {
      const batch = await directoryRepo.list({ ...base, after: cursor, take: SCAN_BATCH });
      exhausted = batch.length < SCAN_BATCH;
      if (batch.length === 0) break;
      const lives = await liveNextFree(
        batch.map((r) => r.id),
        now,
        query.when,
      );
      for (const [i, row] of batch.entries()) {
        lastExamined = row;
        scanned++;
        const live = lives.get(row.id);
        if (live?.nextFree) matches.push({ row, live });
        if (matches.length === limit) {
          rowsLeftInBatch = i < batch.length - 1;
          break;
        }
      }
      cursor = lastExamined ? { name: lastExamined.name, id: lastExamined.id } : cursor;
    }
    const more = rowsLeftInBatch || !exhausted;
    return {
      businesses: matches.map(({ row, live }) => ({
        ...plainItem(row),
        ...(withLive ? liveFields(live) : {}),
      })),
      nextCursor: more && lastExamined ? encodeCursor(lastExamined.name, lastExamined.id) : null,
    };
  },
};
