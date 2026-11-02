import { Prisma } from '@/generated/prisma/client';
import {
  DELETED_CLIENT_NAME,
  TOMBSTONE_PHONE_PREFIX,
  tombstonePhone,
} from '@/server/domain/clientFlags';
import { db } from './db';
import { expirePendingDeposits } from './payment.repo';
import { reminderJobRepo } from './reminderJob.repo';

export type ClientSort = 'name' | 'noShows' | 'recent';

export interface ClientListRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  attended: number;
  noShows: number;
  lateCancels: number;
  createdAt: Date;
  lastVisitAt: Date | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const ORDER: Record<ClientSort, Prisma.Sql> = {
  name: Prisma.sql`lower(c."name") ASC, c."id" ASC`,
  noShows: Prisma.sql`c."noShows" DESC, lower(c."name") ASC, c."id" ASC`,
  recent: Prisma.sql`"lastVisitAt" DESC NULLS LAST, lower(c."name") ASC, c."id" ASC`,
};

const LAST_VISIT = Prisma.sql`(SELECT max(a."startAt") FROM "Appointment" a
  WHERE a."clientId" = c."id" AND a."businessId" = c."businessId" AND a."status" = 'ATTENDED')`;

export const clientRepo = {
  /** The no-show counter of the client with this E.164 phone in this business; 0 for a new client. */
  async noShowsByPhone(businessId: string, phone: string): Promise<number> {
    const row = await db.client.findUnique({
      where: { businessId_phone: { businessId, phone } },
      select: { noShows: true },
    });
    return row?.noShows ?? 0;
  },

  /**
   * Client list for one business. Anonymised clients are hidden. `search` matches the name (case-insensitive
   * contains) and, when it looks like a phone number, the phone digits. Offset paging over a total order.
   */
  list: (
    businessId: string,
    q: { search?: string | undefined; sort: ClientSort; limit: number; offset: number },
  ) => {
    const search = q.search?.trim() ?? '';
    const digits = search.replace(/\D/g, '');
    const phoneLike = /^[\d\s+()-]+$/.test(search) && digits.length > 0;
    const filters: Prisma.Sql[] = [
      Prisma.sql`c."businessId" = ${businessId}`,
      Prisma.sql`c."phone" NOT LIKE ${`${TOMBSTONE_PHONE_PREFIX}%`}`,
    ];
    if (search) {
      const byName = Prisma.sql`c."name" ILIKE ${`%${escapeLike(search)}%`}`;
      filters.push(phoneLike ? Prisma.sql`(${byName} OR c."phone" LIKE ${`%${digits}%`})` : byName);
    }
    return db.$queryRaw<ClientListRow[]>`
      SELECT c."id", c."name", c."phone", c."email", c."attended", c."noShows", c."lateCancels",
             c."createdAt", ${LAST_VISIT} AS "lastVisitAt"
      FROM "Client" c
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY ${ORDER[q.sort]}
      LIMIT ${q.limit} OFFSET ${q.offset}`;
  },

  async findDetail(businessId: string, id: string): Promise<ClientListRow | null> {
    const rows = await db.$queryRaw<ClientListRow[]>`
      SELECT c."id", c."name", c."phone", c."email", c."attended", c."noShows", c."lateCancels",
             c."createdAt", ${LAST_VISIT} AS "lastVisitAt"
      FROM "Client" c
      WHERE c."businessId" = ${businessId} AND c."id" = ${id}
        AND c."phone" NOT LIKE ${`${TOMBSTONE_PHONE_PREFIX}%`}`;
    return rows[0] ?? null;
  },

  history: (businessId: string, clientId: string, limit: number) =>
    db.appointment.findMany({
      where: { businessId, clientId },
      orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        startAt: true,
        status: true,
        service: { select: { id: true, name: true } },
        staff: { select: { id: true, displayName: true } },
      },
    }),

  /**
   * "Delete on request" (NFR-04) as an anonymisation, in ONE transaction: future active appointments are
   * cancelled (slot freed, pending reminders skipped), open waitlist entries (and their open offers) are
   * closed, then the client row loses name, phone and email. Counters stay so the history keeps its totals.
   * Returns null when the client is not in this business or is already anonymised: a second DELETE of the
   * same client therefore answers 404.
   */
  anonymise: (businessId: string, id: string, now: Date) =>
    db.$transaction(async (tx) => {
      // Lock the client row first: a concurrent booking's insert (FK key share) waits for this transaction,
      // and a concurrent second DELETE waits, then finds the tombstone and answers 404.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Client"
        WHERE "id" = ${id} AND "businessId" = ${businessId} AND "phone" NOT LIKE ${`${TOMBSTONE_PHONE_PREFIX}%`}
        FOR UPDATE`;
      if (locked.length !== 1) return null;

      const ACTIVE = ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'] as const;
      const freed: {
        id: string;
        serviceId: string;
        staffId: string;
        startAt: Date;
        endAt: Date;
      }[] = [];
      const cancelFuture = async () => {
        const future = await tx.appointment.findMany({
          where: { businessId, clientId: id, startAt: { gt: now }, status: { in: [...ACTIVE] } },
          select: { id: true, serviceId: true, staffId: true, startAt: true, endAt: true },
        });
        for (const a of future) {
          const res = await tx.appointment.updateMany({
            where: { id: a.id, businessId, status: { in: [...ACTIVE] } },
            data: { status: 'CANCELLED', cancelledAt: now, cancelledVia: 'STAFF' },
          });
          if (res.count !== 1) continue;
          await reminderJobRepo.skipPending(businessId, tx, a.id);
          await expirePendingDeposits(tx, businessId, [a.id]);
          freed.push(a);
        }
      };
      await cancelFuture();

      const entries = await tx.waitlistEntry.findMany({
        where: { businessId, clientId: id, status: 'OPEN' },
        select: { id: true },
      });
      if (entries.length) {
        const entryIds = entries.map((e) => e.id);
        await tx.waitlistOffer.updateMany({
          where: { businessId, entryId: { in: entryIds }, status: 'OPEN' },
          data: { status: 'SUPERSEDED' },
        });
        await tx.waitlistEntry.updateMany({
          where: { businessId, id: { in: entryIds }, status: 'OPEN' },
          data: { status: 'CANCELLED' },
        });
      }

      await tx.client.updateMany({
        where: { id, businessId },
        data: { name: DELETED_CLIENT_NAME, phone: tombstonePhone(id), email: null },
      });
      // Sweep again after the tombstone: anything that became visible while we worked is cancelled too.
      await cancelFuture();
      // F16: the per-appointment contact email is personal data too. Every appointment of this client
      // (past and future, any status) loses it, after the last sweep so nothing is left behind.
      await tx.appointment.updateMany({
        where: {
          businessId,
          clientId: id,
          OR: [{ contactEmail: { not: null } }, { contactName: { not: null } }],
        },
        data: { contactEmail: null, contactName: null },
      });
      // Same for the address a waitlist entry was joined with (any status, nullable column).
      await tx.waitlistEntry.updateMany({
        where: { businessId, clientId: id, contactEmail: { not: null } },
        data: { contactEmail: null },
      });
      return { freed };
    }),

  /**
   * Recompute attended / noShows / lateCancels from the appointment table (the counters are a cache of it).
   * One client, or every client of the business. Not wired to a route: a repair tool for counter drift.
   * Returns the number of client rows whose counters changed.
   */
  async reconcileClientCounters(businessId: string, clientId?: string): Promise<number> {
    const only = clientId ? Prisma.sql`AND c."id" = ${clientId}` : Prisma.empty;
    const changed = await db.$executeRaw`
      UPDATE "Client" c SET
        "attended" = t.attended, "noShows" = t."noShows", "lateCancels" = t."lateCancels"
      FROM (
        SELECT c2."id",
          (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c2."id" AND a."businessId" = c2."businessId" AND a."status" = 'ATTENDED')::int AS attended,
          (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c2."id" AND a."businessId" = c2."businessId" AND a."status" = 'NO_SHOW')::int AS "noShows",
          (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c2."id" AND a."businessId" = c2."businessId" AND a."status" = 'LATE_CANCEL')::int AS "lateCancels"
        FROM "Client" c2 WHERE c2."businessId" = ${businessId}
      ) t
      WHERE c."id" = t."id" AND c."businessId" = ${businessId} ${only}
        AND (c."attended", c."noShows", c."lateCancels") IS DISTINCT FROM (t.attended, t."noShows", t."lateCancels")`;
    return changed;
  },

  /**
   * Find-or-create by (businessId, E.164 phone) that NEVER modifies an existing client (not even empty
   * fields). Used by the unauthenticated waitlist join: whatever the caller supplies for an existing
   * phone number must not reach that client's record.
   */
  async findOrCreateUntouched(
    businessId: string,
    tx: Prisma.TransactionClient,
    input: { name: string; phone: string; email?: string | undefined },
  ) {
    await tx.client.createMany({
      data: [{ businessId, name: input.name, phone: input.phone, email: input.email ?? null }],
      skipDuplicates: true,
    });
    return tx.client.findFirstOrThrow({ where: { businessId, phone: input.phone } });
  },

  /**
   * Find-or-create by (businessId, E.164 phone), safe under concurrency (ON CONFLICT DO NOTHING).
   * Runs on the caller's transaction so a failed booking leaves no client behind.
   *
   * Contact data of an EXISTING client:
   * - `overwriteContact = false` (public and waitlist bookings, which are unauthenticated): only FILL a
   *   name/email that is null or empty. A non-empty stored value is never replaced, otherwise anyone who
   *   knows a victim's phone number could redirect that client's reminder emails to themselves.
   * - `overwriteContact = true` (session-authenticated front-desk booking): a provided, different
   *   name/email replaces the stored one. Nothing is ever wiped by an omitted value.
   * F16: this record rule is deliberately unchanged. The address typed for a booking is stored on the
   * APPOINTMENT (Appointment.contactEmail) and is what that booking's emails go to.
   */
  async upsertByPhone(
    businessId: string,
    tx: Prisma.TransactionClient,
    input: { name: string; phone: string; email?: string | undefined },
    overwriteContact: boolean,
  ) {
    await tx.client.createMany({
      data: [{ businessId, name: input.name, phone: input.phone, email: input.email ?? null }],
      skipDuplicates: true,
    });
    const client = await tx.client.findFirstOrThrow({
      where: { businessId, phone: input.phone },
    });
    const data: { name?: string; email?: string } = {};
    if (input.name && input.name !== client.name && (overwriteContact || !client.name.trim()))
      data.name = input.name;
    if (input.email && input.email !== client.email && (overwriteContact || !client.email))
      data.email = input.email;
    if (Object.keys(data).length === 0) return client;
    return tx.client.update({ where: { id: client.id }, data });
  },
};
