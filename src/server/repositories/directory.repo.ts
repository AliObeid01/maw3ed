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
      ? Prisma.sql`AND (b."name" ILIKE ${search} ESCAPE '\\' OR b."category" ILIKE ${search} ESCAPE '\\' OR b."address" ILIKE ${search} ESCAPE '\\')`
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
   * Top services per category: a service counts once per business that offers it (name compared
   * case-insensitively), ranked by number of businesses, then cheapest, then name. Top `perCategory` per key.
   */
  async popularServices(area: string | undefined, keys: readonly string[], perCategory: number) {
    const rows = await db.$queryRaw<
      { category: string; name: string; fromPrice: Prisma.Decimal | string | number }[]
    >`
      WITH base AS (
        SELECT lower(b."category") AS category, lower(btrim(s."name")) AS key, min(s."name") AS name,
          count(DISTINCT b."id") AS businesses, min(s."price") AS "fromPrice"
        FROM "Business" b
        JOIN "Service" s ON s."businessId" = b."id" AND s."active"
        WHERE b."listed" AND ${READY} AND lower(b."category") = ANY(${keys as string[]}::text[]) ${areaClause(area)}
        GROUP BY lower(b."category"), lower(btrim(s."name"))
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY category ORDER BY businesses DESC, "fromPrice" ASC, key ASC) AS rn
        FROM base
      )
      SELECT category, name, "fromPrice" FROM ranked WHERE rn <= ${perCategory} ORDER BY category, rn`;
    return rows.map((r) => ({
      category: r.category,
      name: r.name,
      fromPrice: Number(r.fromPrice),
    }));
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
