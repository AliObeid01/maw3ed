import type { Prisma } from '@/generated/prisma/client';
import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';
import { clientRepo } from './client.repo';
import { db } from './db';

/** Entry dates are local calendar dates ('yyyy-MM-dd'); stored as that date at 00:00 UTC. */
export const toStoredDate = (localDate: string) => new Date(`${localDate}T00:00:00.000Z`);
export const toLocalDate = (stored: Date) => stored.toISOString().slice(0, 10);

const HOLDING = [...SLOT_HOLDING_STATUSES];

/** A waitlist claim books with the idempotency key `waitlist-offer-<offerId>`. */
export const OFFER_KEY_PREFIX = 'waitlist-offer-';

/** Claim bookkeeping on an existing transaction (see waitlistRepo.markClaimed). Idempotent. */
export async function markClaimedIn(
  tx: Prisma.TransactionClient,
  businessId: string,
  a: { offerId: string; entryId: string; freedFromAppointmentId: string; appointmentId: string },
) {
  await tx.waitlistOffer.updateMany({
    where: { id: a.offerId, businessId, status: { in: ['OPEN', 'EXPIRED', 'SUPERSEDED'] } },
    data: { status: 'CLAIMED', claimedAppointmentId: a.appointmentId },
  });
  await tx.waitlistEntry.updateMany({
    where: { id: a.entryId, businessId, status: { in: ['OPEN', 'CANCELLED'] } },
    data: { status: 'FULFILLED', claimingOfferId: null, claimingAt: null },
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
}

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
  emailedAt: true,
  staff: { select: { id: true, displayName: true } },
  entry: {
    select: {
      id: true,
      status: true,
      serviceId: true,
      staffId: true,
      contactEmail: true,
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
        const client = await clientRepo.findOrCreateUntouched(businessId, tx, input.client);
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
            contactEmail: input.client.email,
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
    lease: { now: Date; leaseMs: number },
  ): Promise<'cancelled' | 'already' | 'fulfilled' | 'busy' | 'missing'> =>
    db.$transaction(async (tx) => {
      const staleBefore = new Date(lease.now.getTime() - lease.leaseMs);
      // An entry whose offer is being booked right now (fresh reservation) is not cancelled under it.
      const res = await tx.waitlistEntry.updateMany({
        where: {
          id,
          businessId,
          status: 'OPEN',
          OR: [{ claimingOfferId: null }, { claimingAt: { lt: staleBefore } }],
        },
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
        select: { status: true, claimingOfferId: true, claimingAt: true },
      });
      if (!current) return 'missing';
      if (current.status === 'OPEN') return 'busy';
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

  /** Entries and clients that already got an offer for this freed slot, and the highest batch used. */
  async offeredFor(businessId: string, freedFromAppointmentId: string) {
    const rows = await db.waitlistOffer.findMany({
      where: { businessId, freedFromAppointmentId },
      select: { entryId: true, batch: true, entry: { select: { clientId: true } } },
    });
    return {
      entryIds: new Set(rows.map((r) => r.entryId)),
      clientIds: new Set(rows.map((r) => r.entry.clientId)),
      maxBatch: rows.reduce((m, r) => Math.max(m, r.batch), 0),
    };
  },

  /**
   * Create the next batch for a freed slot, serialised per slot: under a transaction-scoped advisory lock
   * it re-checks that no offer is still OPEN or CLAIMED, reads which entries/clients were already
   * offered, lets `plan` pick the new rows (pure, no I/O) and inserts them with ON CONFLICT DO NOTHING
   * RETURNING. Overlapping runs therefore queue up, and the loser finds live offers and inserts nothing,
   * so a slot never has more than one batch open. Only the rows this call inserted come back.
   */
  async createBatch(
    businessId: string,
    freedFromAppointmentId: string,
    plan: (prior: {
      entryIds: Set<string>;
      clientIds: Set<string>;
      maxBatch: number;
    }) => Omit<NewOffer, 'batch'>[],
  ): Promise<OfferRow[]> {
    const ids = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer:${freedFromAppointmentId}`}))`;
        const live = await tx.waitlistOffer.count({
          where: { businessId, freedFromAppointmentId, status: { in: ['OPEN', 'CLAIMED'] } },
        });
        if (live > 0) return [];
        const prior = await tx.waitlistOffer.findMany({
          where: { businessId, freedFromAppointmentId },
          select: { entryId: true, batch: true, entry: { select: { clientId: true } } },
        });
        const maxBatch = prior.reduce((m, r) => Math.max(m, r.batch), 0);
        const rows = plan({
          entryIds: new Set(prior.map((r) => r.entryId)),
          clientIds: new Set(prior.map((r) => r.entry.clientId)),
          maxBatch,
        });
        if (rows.length === 0) return [];
        const inserted = await tx.waitlistOffer.createManyAndReturn({
          data: rows.map((r) => ({
            ...r,
            batch: maxBatch + 1,
            businessId,
            status: 'OPEN' as const,
          })),
          skipDuplicates: true,
          select: { id: true },
        });
        return inserted.map((r) => r.id);
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    return waitlistRepo.findOffers(businessId, ids);
  },

  /** The offer email was accepted by the provider. */
  async markEmailed(businessId: string, offerId: string, at: Date) {
    await db.waitlistOffer.updateMany({
      where: { id: offerId, businessId, emailedAt: null },
      data: { emailedAt: at },
    });
  },

  /** OPEN, unexpired offers whose email never went out (provider outage): safe to resend by key. */
  unsentOffers: (now: Date, olderThan: Date, limit: number) =>
    db.waitlistOffer.findMany({
      where: {
        status: 'OPEN',
        emailedAt: null,
        expiresAt: { gt: now },
        createdAt: { lte: olderThan },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, businessId: true },
    }),

  /**
   * Claim bookkeeping in ONE transaction, keyed by the offer id. The booking exists, so the record must say
   * so even if the offer expired or was superseded, or the entry was cancelled, while book() ran:
   * the offer becomes CLAIMED (from OPEN, EXPIRED or SUPERSEDED), the entry FULFILLED (from OPEN or
   * CANCELLED), and every other OPEN offer for this freed slot or this entry SUPERSEDED.
   */
  /**
   * Does this entry already own a live deposit hold made through ANOTHER of its offers? Such a claim keeps the
   * entry reserved for the hold's whole life (15 min), longer than the 60 s claim lease, until it is paid
   * (markClaimedIn), swept or abandoned. Holds with no expiry count as live.
   */
  async hasLiveDepositHold(businessId: string, entryId: string, exceptOfferId: string, now: Date) {
    const offers = await db.waitlistOffer.findMany({
      where: { businessId, entryId, id: { not: exceptOfferId } },
      select: { id: true },
    });
    if (offers.length === 0) return false;
    const count = await db.appointment.count({
      where: {
        businessId,
        status: 'PENDING_PAYMENT',
        source: 'WAITLIST',
        idempotencyKey: { in: offers.map((o) => `${OFFER_KEY_PREFIX}${o.id}`) },
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
    });
    return count > 0;
  },

  /**
   * Did this offer's own claim create a deposit hold that was swept (cancelled by the system, unpaid)? The hold is
   * found through the booking idempotency key; no column records it, an unpaid hold leaves no trace on the offer.
   */
  async hasLapsedHold(businessId: string, offerId: string) {
    const count = await db.appointment.count({
      where: {
        businessId,
        source: 'WAITLIST',
        status: 'CANCELLED',
        cancelledVia: 'SYSTEM',
        idempotencyKey: `${OFFER_KEY_PREFIX}${offerId}`,
      },
    });
    return count > 0;
  },

  markClaimed: (
    businessId: string,
    a: { offerId: string; entryId: string; freedFromAppointmentId: string; appointmentId: string },
  ) => db.$transaction((tx) => markClaimedIn(tx, businessId, a)),

  /**
   * Atomically reserve an OPEN entry for one offer (one conditional UPDATE). Another offer of the same
   * entry cannot book while the reservation is fresh; the same offer may re-reserve (retry); a stale
   * reservation (older than `leaseMs`, e.g. a crashed request) is taken over.
   */
  async reserveEntry(
    businessId: string,
    entryId: string,
    offerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const res = await db.waitlistEntry.updateMany({
      where: {
        id: entryId,
        businessId,
        status: 'OPEN',
        OR: [
          { claimingOfferId: null },
          { claimingOfferId: offerId },
          { claimingAt: { lt: new Date(now.getTime() - leaseMs) } },
        ],
      },
      data: { claimingOfferId: offerId, claimingAt: now },
    });
    return res.count === 1;
  },

  /** Drop this offer's reservation (the booking failed). No-op when someone else holds it. */
  async releaseEntry(businessId: string, entryId: string, offerId: string) {
    await db.waitlistEntry.updateMany({
      where: { id: entryId, businessId, claimingOfferId: offerId },
      data: { claimingOfferId: null, claimingAt: null },
    });
  },

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
      WHERE o."startAt" > ${now.toISOString()}::timestamptz
      GROUP BY o."businessId", o."freedFromAppointmentId"
      HAVING COUNT(*) FILTER (WHERE o."status" IN ('OPEN', 'CLAIMED')) = 0
        AND EXISTS (
          SELECT 1
          FROM "WaitlistEntry" e
          JOIN "Appointment" f ON f."id" = o."freedFromAppointmentId"
          WHERE e."businessId" = o."businessId"
            AND e."serviceId" = f."serviceId"
            AND e."status" = 'OPEN'
            AND e."clientId" <> f."clientId"
            AND NOT EXISTS (
              SELECT 1 FROM "WaitlistOffer" x
              WHERE x."entryId" = e."id" AND x."freedFromAppointmentId" = o."freedFromAppointmentId"
            )
        )
      ORDER BY MIN(o."startAt") ASC
      LIMIT ${limit}`;
  },

  /** Offer emails created since `since` (they count towards the daily email budget). */
  countOffersSince: (since: Date) =>
    db.waitlistOffer.count({ where: { createdAt: { gte: since } } }),
};
