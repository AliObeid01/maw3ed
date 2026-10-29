import type { Prisma } from '@/generated/prisma/client';
import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';
import { clientRepo } from './client.repo';
import { db } from './db';

/** Entry dates are local calendar dates ('yyyy-MM-dd'); stored as that date at 00:00 UTC. */
export const toStoredDate = (localDate: string) => new Date(`${localDate}T00:00:00.000Z`);
export const toLocalDate = (stored: Date) => stored.toISOString().slice(0, 10);

const HOLDING = [...SLOT_HOLDING_STATUSES];

const entrySelect = {
  id: true,
  status: true,
  serviceId: true,
  staffId: true,
  fromDate: true,
  toDate: true,
  createdAt: true,
  client: { select: { id: true, name: true, phone: true } },
  service: { select: { id: true, name: true } },
  staff: { select: { id: true, displayName: true } },
} satisfies Prisma.WaitlistEntrySelect;

const offerSelect = {
  id: true,
  businessId: true,
  entryId: true,
  staffId: true,
  startAt: true,
  endAt: true,
  expiresAt: true,
  status: true,
  batch: true,
  freedFromAppointmentId: true,
  claimedAppointmentId: true,
  createdAt: true,
  staff: { select: { id: true, displayName: true } },
  entry: {
    select: {
      id: true,
      status: true,
      serviceId: true,
      client: { select: { id: true, name: true, phone: true, email: true } },
      service: { select: { id: true, name: true, durationMin: true, price: true } },
    },
  },
  business: { select: { name: true, slug: true, timezone: true, locale: true } },
} satisfies Prisma.WaitlistOfferSelect;

export type OfferRow = Prisma.WaitlistOfferGetPayload<{ select: typeof offerSelect }>;
export type EntryRow = Prisma.WaitlistEntryGetPayload<{ select: typeof entrySelect }>;

export interface NewEntry {
  serviceId: string;
  staffId: string | null;
  fromDate: string;
  toDate: string;
  client: { name: string; phone: string; email: string };
}

export type JoinResult = { kind: 'created' | 'existing'; entry: EntryRow } | { kind: 'limit' };

export interface NewOffer {
  entryId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  freedFromAppointmentId: string;
  batch: number;
}

export const waitlistRepo = {
  // ---- join ---------------------------------------------------------------------------------------

  async serviceIsActive(businessId: string, serviceId: string) {
    return (await db.service.count({ where: { id: serviceId, businessId, active: true } })) > 0;
  },

  /** 'missing' = not in this business; 'no_service' = exists but does not perform the service. */
  async staffFor(
    businessId: string,
    staffId: string,
    serviceId: string,
  ): Promise<'ok' | 'missing' | 'no_service'> {
    const staff = await db.staffMember.findFirst({
      where: { id: staffId, businessId, active: true, bookable: true },
      select: { id: true },
    });
    if (!staff) return 'missing';
    const link = await db.staffService.count({ where: { businessId, staffId, serviceId } });
    return link > 0 ? 'ok' : 'no_service';
  },

  /**
   * Find-or-create the client (never overwriting contact details: this is unauthenticated), then the
   * entry. One transaction under a per-client advisory lock so the 5-open-entries limit and the
   * duplicate check cannot be raced.
   */
  join: (businessId: string, input: NewEntry, maxOpen: number): Promise<JoinResult> =>
    db.$transaction(
      async (tx) => {
        const client = await clientRepo.upsertByPhone(businessId, tx, input.client, false);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waitlist:${client.id}`}))`;
        const from = toStoredDate(input.fromDate);
        const to = toStoredDate(input.toDate);
        const existing = await tx.waitlistEntry.findFirst({
          where: {
            businessId,
            clientId: client.id,
            serviceId: input.serviceId,
            staffId: input.staffId,
            status: 'OPEN',
            fromDate: { lte: to },
            toDate: { gte: from },
          },
          orderBy: { createdAt: 'asc' },
          select: entrySelect,
        });
        if (existing) return { kind: 'existing', entry: existing };
        const open = await tx.waitlistEntry.count({
          where: { businessId, clientId: client.id, status: 'OPEN' },
        });
        if (open >= maxOpen) return { kind: 'limit' };
        const entry = await tx.waitlistEntry.create({
          data: {
            businessId,
            clientId: client.id,
            serviceId: input.serviceId,
            staffId: input.staffId,
            fromDate: from,
            toDate: to,
          },
          select: entrySelect,
        });
        return { kind: 'created', entry };
      },
      { maxWait: 15_000, timeout: 30_000 },
    ),

  // ---- staff side ---------------------------------------------------------------------------------

  listEntries: (businessId: string, q: { openOnly: boolean; limit: number }) =>
    db.waitlistEntry.findMany({
      where: { businessId, ...(q.openOnly ? { status: 'OPEN' as const } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: q.limit,
      select: entrySelect,
    }),

  /** OPEN -> CANCELLED (and its open offers stop being claimable), in one transaction. */
  cancelEntry: (
    businessId: string,
    id: string,
  ): Promise<'cancelled' | 'already' | 'fulfilled' | 'missing'> =>
    db.$transaction(async (tx) => {
      const res = await tx.waitlistEntry.updateMany({
        where: { id, businessId, status: 'OPEN' },
        data: { status: 'CANCELLED' },
      });
      if (res.count === 1) {
        await tx.waitlistOffer.updateMany({
          where: { businessId, entryId: id, status: 'OPEN' },
          data: { status: 'SUPERSEDED' },
        });
        return 'cancelled';
      }
      const current = await tx.waitlistEntry.findFirst({
        where: { id, businessId },
        select: { status: true },
      });
      if (!current) return 'missing';
      return current.status === 'FULFILLED' ? 'fulfilled' : 'already';
    }),

  /** The most recently active freed slots, newest first, with every offer made for each. */
  async activity(businessId: string, limit: number) {
    const groups = await db.waitlistOffer.groupBy({
      by: ['freedFromAppointmentId'],
      where: { businessId },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit,
    });
    if (groups.length === 0) return [];
    return db.waitlistOffer.findMany({
      where: {
        businessId,
        freedFromAppointmentId: { in: groups.map((g) => g.freedFromAppointmentId) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        startAt: true,
        expiresAt: true,
        createdAt: true,
        freedFromAppointmentId: true,
        claimedAppointment: { select: { createdAt: true } },
        staff: { select: { id: true, displayName: true } },
        entry: {
          select: {
            service: { select: { id: true, name: true } },
            client: { select: { name: true } },
          },
        },
      },
    });
  },

  // ---- offers -------------------------------------------------------------------------------------

  /** Signed-offer-link resolution: the token carries only the offer id, so this is the one unscoped lookup. */
  async businessIdOfOffer(offerId: string): Promise<string | null> {
    const row = await db.waitlistOffer.findUnique({
      where: { id: offerId },
      select: { businessId: true },
    });
    return row?.businessId ?? null;
  },

  findOffer: (businessId: string, id: string) =>
    db.waitlistOffer.findFirst({ where: { id, businessId }, select: offerSelect }),

  findOffers: (businessId: string, ids: string[]) =>
    db.waitlistOffer.findMany({
      where: { businessId, id: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: offerSelect,
    }),

  /** The cancelled appointment the offers are about. */
  findFreedAppointment: (businessId: string, id: string) =>
    db.appointment.findFirst({
      where: { id, businessId },
      select: {
        id: true,
        clientId: true,
        serviceId: true,
        staffId: true,
        startAt: true,
        endAt: true,
        blockedUntil: true,
        status: true,
      },
    }),

  /** True when no slot-holding appointment overlaps [from, until) for this staff member. */
  async slotIsFree(businessId: string, staffId: string, from: Date, until: Date) {
    const taken = await db.appointment.count({
      where: {
        businessId,
        staffId,
        status: { in: HOLDING },
        startAt: { lt: until },
        blockedUntil: { gt: from },
      },
    });
    return taken === 0;
  },

  openCandidates: (businessId: string, serviceId: string) =>
    db.waitlistEntry
      .findMany({
        where: { businessId, serviceId, status: 'OPEN' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          clientId: true,
          staffId: true,
          fromDate: true,
          toDate: true,
          createdAt: true,
        },
      })
      .then((rows) =>
        rows.map((r) => ({
          entryId: r.id,
          clientId: r.clientId,
          staffId: r.staffId,
          fromDate: toLocalDate(r.fromDate),
          toDate: toLocalDate(r.toDate),
          createdAt: r.createdAt,
        })),
      ),

  /** Clients (among `clientIds`) that already hold an active appointment overlapping [from, until). */
  async busyClientIds(businessId: string, clientIds: string[], from: Date, until: Date) {
    if (clientIds.length === 0) return new Set<string>();
    const rows = await db.appointment.findMany({
      where: {
        businessId,
        clientId: { in: clientIds },
        status: { in: HOLDING },
        startAt: { lt: until },
        endAt: { gt: from },
      },
      select: { clientId: true },
    });
    return new Set(rows.map((r) => r.clientId));
  },

  /** Entries that already got an offer for this freed slot, and the highest batch used. */
  async offeredFor(businessId: string, freedFromAppointmentId: string) {
    const rows = await db.waitlistOffer.findMany({
      where: { businessId, freedFromAppointmentId },
      select: { entryId: true, batch: true },
    });
    return {
      entryIds: new Set(rows.map((r) => r.entryId)),
      maxBatch: rows.reduce((m, r) => Math.max(m, r.batch), 0),
    };
  },

  /**
   * INSERT ... ON CONFLICT (entryId, freedFromAppointmentId) DO NOTHING RETURNING: only the rows this call
   * really inserted come back, so of two overlapping runs exactly one sends the emails.
   */
  async createOffers(businessId: string, rows: NewOffer[]): Promise<OfferRow[]> {
    if (rows.length === 0) return [];
    const inserted = await db.waitlistOffer.createManyAndReturn({
      data: rows.map((r) => ({ ...r, businessId, status: 'OPEN' as const })),
      skipDuplicates: true,
      select: { id: true },
    });
    return waitlistRepo.findOffers(
      businessId,
      inserted.map((r) => r.id),
    );
  },

  /**
   * Claim bookkeeping in one transaction: this offer CLAIMED (only from OPEN or already CLAIMED by the
   * same appointment), its entry FULFILLED, and every other OPEN offer for this freed slot or for this
   * entry SUPERSEDED (first claim wins).
   */
  markClaimed: (
    businessId: string,
    a: { offerId: string; entryId: string; freedFromAppointmentId: string; appointmentId: string },
  ) =>
    db.$transaction(async (tx) => {
      await tx.waitlistOffer.updateMany({
        where: { id: a.offerId, businessId, status: 'OPEN' },
        data: { status: 'CLAIMED', claimedAppointmentId: a.appointmentId },
      });
      await tx.waitlistEntry.updateMany({
        where: { id: a.entryId, businessId, status: 'OPEN' },
        data: { status: 'FULFILLED' },
      });
      await tx.waitlistOffer.updateMany({
        where: {
          businessId,
          id: { not: a.offerId },
          status: 'OPEN',
          OR: [{ freedFromAppointmentId: a.freedFromAppointmentId }, { entryId: a.entryId }],
        },
        data: { status: 'SUPERSEDED' },
      });
    }),

  /** OPEN -> SUPERSEDED for an offer whose slot someone else took (shown to the client as TAKEN). */
  async supersede(businessId: string, offerId: string) {
    await db.waitlistOffer.updateMany({
      where: { id: offerId, businessId, status: 'OPEN' },
      data: { status: 'SUPERSEDED' },
    });
  },

  // ---- expiry job (all tenants) -------------------------------------------------------------------

  /**
   * OPEN offers past their expiry -> EXPIRED in one conditional statement. A concurrent run blocks on the
   * row lock, then sees status <> OPEN and updates nothing, so each offer is expired (and counted) once.
   */
  async expireDue(now: Date) {
    const ts = now.toISOString();
    return db.$queryRaw<Array<{ id: string }>>`
      UPDATE "WaitlistOffer"
      SET "status" = 'EXPIRED'
      WHERE "status" = 'OPEN' AND "expiresAt" <= ${ts}::timestamptz
      RETURNING "id"`;
  },

  /**
   * Freed slots that still start in the future, have offers, and have none OPEN or CLAIMED: the next
   * batch may be due. Bounded, soonest first.
   */
  async cascadeCandidates(now: Date, limit: number) {
    return db.$queryRaw<Array<{ businessId: string; freedFromAppointmentId: string }>>`
      SELECT o."businessId", o."freedFromAppointmentId"
      FROM "WaitlistOffer" o
      GROUP BY o."businessId", o."freedFromAppointmentId"
      HAVING MIN(o."startAt") > ${now.toISOString()}::timestamptz
        AND COUNT(*) FILTER (WHERE o."status" IN ('OPEN', 'CLAIMED')) = 0
      ORDER BY MIN(o."startAt") ASC
      LIMIT ${limit}`;
  },

  /** Offer emails created since `since` (they count towards the daily email budget). */
  countOffersSince: (since: Date) =>
    db.waitlistOffer.count({ where: { createdAt: { gte: since } } }),
};
