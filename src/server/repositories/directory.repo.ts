import { Prisma } from '@/generated/prisma/client';
import { db } from './db';

export interface DirectoryRow {
  slug: string;
  name: string;
  category: string | null;
  area: string | null;
  address: string | null;
  serviceCount: number;
  fromPrice: number | null;
  /** Keyset position, used to build the next cursor. */
  id: string;
}

/** Escape LIKE wildcards so user input is matched literally (`\` is the ESCAPE character). */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Business is ready: an active service, and an active bookable staff member with working hours. */
const READY = Prisma.sql`
  EXISTS (SELECT 1 FROM "Service" s WHERE s."businessId" = b."id" AND s."active")
  AND EXISTS (
    SELECT 1 FROM "StaffMember" m
    WHERE m."businessId" = b."id" AND m."active" AND m."bookable"
      AND EXISTS (SELECT 1 FROM "WorkingHours" w WHERE w."businessId" = b."id" AND w."staffId" = m."id")
  )`;

/**
 * The public directory is the one query that spans tenants on purpose: it reads only the public columns
 * of opted-in (`listed`) businesses, so it takes no businessId. Readiness is re-evaluated on every read.
 */
export const directoryRepo = {
  async list(input: {
    search?: string;
    category?: string;
    area?: string;
    /** Text matched (ILIKE, parameterised) against ACTIVE service names, in addition to `search`. */
    service?: string;
    after?: { name: string; id: string };
    take: number;
  }): Promise<DirectoryRow[]> {
    const search = input.search ? `%${escapeLike(input.search)}%` : undefined;
    const searchSql = search
      ? Prisma.sql`AND (b."name" ILIKE ${search} ESCAPE '\\' OR b."category" ILIKE ${search} ESCAPE '\\' OR b."address" ILIKE ${search} ESCAPE '\\' OR EXISTS (SELECT 1 FROM "Service" ss WHERE ss."businessId" = b."id" AND ss."active" AND ss."name" ILIKE ${search} ESCAPE '\\'))`
      : Prisma.empty;
    const categorySql = input.category
      ? Prisma.sql`AND lower(b."category") = lower(${input.category})`
      : Prisma.empty;
    const areaSql = input.area ? Prisma.sql`AND b."area" = ${input.area}` : Prisma.empty;
    const serviceSql = input.service
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Service" sv WHERE sv."businessId" = b."id" AND sv."active" AND sv."name" ILIKE ${`%${escapeLike(input.service)}%`} ESCAPE '\\')`
      : Prisma.empty;
    const cursorSql = input.after
      ? Prisma.sql`AND (b."name", b."id") > (${input.after.name}, ${input.after.id})`
      : Prisma.empty;

    const rows = await db.$queryRaw<
      {
        id: string;
        slug: string;
        name: string;
        category: string | null;
        area: string | null;
        address: string | null;
        serviceCount: bigint | number;
        fromPrice: Prisma.Decimal | string | number | null;
      }[]
    >`
      SELECT b."id", b."slug", b."name", b."category", b."area", b."address",
        (SELECT count(*) FROM "Service" s WHERE s."businessId" = b."id" AND s."active") AS "serviceCount",
        (SELECT min(s."price") FROM "Service" s WHERE s."businessId" = b."id" AND s."active") AS "fromPrice"
      FROM "Business" b
      WHERE b."listed" AND ${READY} ${searchSql} ${categorySql} ${areaSql} ${serviceSql} ${cursorSql}
      ORDER BY b."name" ASC, b."id" ASC
      LIMIT ${input.take}`;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      area: r.area,
      address: r.address,
      serviceCount: Number(r.serviceCount),
      fromPrice: r.fromPrice === null ? null : Number(r.fromPrice),
    }));
  },

  /**
   * Per fixed category key: how many listed + ready places, and the cheapest active service price among them.
   * Cheap aggregates in SQL; categories without places are simply absent (the service fills them with zero).
   */
  async categoryTotals(area: string | undefined, keys: readonly string[]) {
    const rows = await db.$queryRaw<
      {
        category: string;
        places: bigint | number;
        fromPrice: Prisma.Decimal | string | number | null;
      }[]
    >`
      SELECT lower(b."category") AS category, count(*) AS places,
        min((SELECT min(s."price") FROM "Service" s WHERE s."businessId" = b."id" AND s."active")) AS "fromPrice"
      FROM "Business" b
      WHERE b."listed" AND ${READY} AND lower(b."category") = ANY(${keys as string[]}::text[]) ${areaClause(area)}
      GROUP BY lower(b."category")`;
    return rows.map((r) => ({
      category: r.category,
      places: Number(r.places),
      fromPrice: r.fromPrice === null ? null : Number(r.fromPrice),
    }));
  },

  /**
   * Top services per category, ranked by RECENT DEMAND: the number of appointments created in the
   * `windowDays` before `now` (BOOKED, CONFIRMED, ATTENDED, NO_SHOW, LATE_CANCEL; not CANCELLED, not
   * PENDING_PAYMENT) for ACTIVE services of listed + ready businesses whose normalised name (lower(btrim))
   * matches, within the category and the optional area. Ties: number of businesses offering it (desc), lowest
   * from-price, then the key. The counts only order the result and are never returned. `now` is injected.
   */
  async popularServices(
    area: string | undefined,
    keys: readonly string[],
    perCategory: number,
    now: Date,
    windowDays: number,
  ) {
    const since = new Date(now.getTime() - windowDays * 86_400_000);
    const rows = await db.$queryRaw<
      { category: string; name: string; fromPrice: Prisma.Decimal | string | number }[]
    >`
      WITH shops AS (
        SELECT b."id", lower(b."category") AS category
        FROM "Business" b
        WHERE b."listed" AND ${READY} AND lower(b."category") = ANY(${keys as string[]}::text[]) ${areaClause(area)}
      ), base AS (
        SELECT sh.category, lower(btrim(s."name")) AS key, min(btrim(s."name")) AS name,
          count(DISTINCT sh."id") AS businesses, min(s."price") AS "fromPrice"
        FROM shops sh
        JOIN "Service" s ON s."businessId" = sh."id" AND s."active"
        GROUP BY sh.category, lower(btrim(s."name"))
      ), demand AS (
        SELECT sh.category, lower(btrim(s."name")) AS key, count(*) AS bookings
        FROM shops sh
        JOIN "Service" s ON s."businessId" = sh."id" AND s."active"
        JOIN "Appointment" a ON a."businessId" = sh."id" AND a."serviceId" = s."id"
          AND a."status" IN ('BOOKED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'LATE_CANCEL')
          AND a."createdAt" >= ${since}
        GROUP BY sh.category, lower(btrim(s."name"))
      ), ranked AS (
        SELECT base.category, base.key, base.name, base."fromPrice",
          row_number() OVER (
            PARTITION BY base.category
            ORDER BY coalesce(demand.bookings, 0) DESC, base.businesses DESC, base."fromPrice" ASC, base.key ASC
          ) AS rn
        FROM base
        LEFT JOIN demand ON demand.category = base.category AND demand.key = base.key
      )
      SELECT category, name, "fromPrice" FROM ranked WHERE rn <= ${perCategory} ORDER BY category, rn`;
    return rows.map((r) => ({
      category: r.category,
      name: r.name,
      fromPrice: Number(r.fromPrice),
    }));
  },

  /**
   * Up to `perBusiness` ACTIVE services for each business id, cheapest first then name, in ONE query (no N+1).
   * Public fields only: name, duration, price.
   */
  async servicesFor(ids: readonly string[], perBusiness: number) {
    if (ids.length === 0)
      return new Map<string, { name: string; durationMin: number; price: number }[]>();
    const rows = await db.$queryRaw<
      {
        businessId: string;
        name: string;
        durationMin: number;
        price: Prisma.Decimal | string | number;
      }[]
    >`
      SELECT "businessId", "name", "durationMin", "price" FROM (
        SELECT s."businessId", s."name", s."durationMin", s."price",
          row_number() OVER (PARTITION BY s."businessId" ORDER BY s."price" ASC, s."name" ASC, s."id" ASC) AS rn
        FROM "Service" s
        WHERE s."active" AND s."businessId" = ANY(${ids as string[]}::text[])
      ) t WHERE rn <= ${perBusiness} ORDER BY "businessId", rn`;
    const out = new Map<string, { name: string; durationMin: number; price: number }[]>();
    for (const r of rows) {
      const list = out.get(r.businessId) ?? [];
      list.push({ name: r.name, durationMin: Number(r.durationMin), price: Number(r.price) });
      out.set(r.businessId, list);
    }
    return out;
  },

  /** Largest booking window (days) among listed businesses; 0 when there are none. One indexed aggregate. */
  async maxBookingWindowDays(): Promise<number> {
    const agg = await db.business.aggregate({
      where: { listed: true },
      _max: { bookingWindowDays: true },
    });
    return agg._max.bookingWindowDays ?? 0;
  },

  /** The first `perCategory` listed + ready businesses (name, id order: the directory order) of each category. */
  async topBusinessIds(area: string | undefined, keys: readonly string[], perCategory: number) {
    const rows = await db.$queryRaw<{ id: string; category: string }[]>`
      SELECT id, category FROM (
        SELECT b."id", lower(b."category") AS category,
          row_number() OVER (PARTITION BY lower(b."category") ORDER BY b."name" ASC, b."id" ASC) AS rn
        FROM "Business" b
        WHERE b."listed" AND ${READY} AND lower(b."category") = ANY(${keys as string[]}::text[]) ${areaClause(area)}
      ) t WHERE rn <= ${perCategory} ORDER BY category, rn`;
    return rows;
  },
};

const areaClause = (area: string | undefined) =>
  area ? Prisma.sql`AND b."area" = ${area}` : Prisma.empty;
