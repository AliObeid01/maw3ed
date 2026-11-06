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
      WHERE b."listed" AND ${READY} ${searchSql} ${categorySql} ${areaSql} ${cursorSql}
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
};
