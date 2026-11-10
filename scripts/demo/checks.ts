import type { PrismaClient } from '../../src/generated/prisma/client';
import { isAreaKey, isCategoryKey } from '../../src/lib/business/profile';
import { FLAGSHIP_SLUG, MANIFEST } from './manifest';

/**
 * Read-only invariant checks of the demo data. Runs against whatever database `prisma` points at and only ever
 * SELECTs. The slot and pilot-report checks call the app's real services (they use the app's own database client,
 * so DATABASE_URL, and DATABASE_SCHEMA in tests, must point at the same database as `prisma`).
 */

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PilotFigures {
  baselineAppointments: number | null;
  baselineNoShows: number | null;
  baselineRate: number | null;
  currentRate: number | null;
  relativeChangePct: number | null;
  attended: number;
  noShows: number;
  lateCancels: number;
  appointments: number;
  confirmRate: number | null;
  cancellationsViaLink: number;
  waitlistSlotsOffered: number;
  waitlistRefills: number;
  waitlistRefillRate: number | null;
  weekly: { weekStart: string; noShowRate: number | null; attended: number; noShows: number }[];
}

export interface CheckReport {
  businesses: number;
  checks: Check[];
  pilot: PilotFigures | null;
  nextFree: { slug: string; startAt: string | null; hoursAway: number | null }[];
  ok: boolean;
}

export async function runChecks(prisma: PrismaClient, now: Date): Promise<CheckReport> {
  const slugs = MANIFEST.map((b) => b.slug);
  const businesses = await prisma.business.findMany({
    where: { slug: { in: slugs } },
    select: {
      id: true, slug: true, name: true, category: true, area: true, address: true, timezone: true,
      locale: true, listed: true, plan: true,
    },
  });
  const ids = businesses.map((b) => b.id);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add('all manifest businesses exist', businesses.length === MANIFEST.length, `${businesses.length} of ${MANIFEST.length}`);
  if (ids.length === 0) return { businesses: 0, checks, pilot: null, nextFree: [], ok: false };

  const overlaps = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "Appointment" a JOIN "Appointment" b
      ON a."staffId" = b."staffId" AND a."id" < b."id"
     AND tstzrange(a."startAt", a."blockedUntil", '[)') && tstzrange(b."startAt", b."blockedUntil", '[)')
    WHERE a."businessId" = ANY(${ids}::text[])
      AND a."status" IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')
      AND b."status" IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`;
  add('no overlapping appointments per staff', (overlaps[0]?.n ?? -1) === 0, `${overlaps[0]?.n} overlapping pair(s)`);

  const dupJobs = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM "ReminderJob" WHERE "businessId" = ANY(${ids}::text[])
      GROUP BY "appointmentId", "kind", "channel" HAVING count(*) > 1) d`;
  add('no duplicate (appointment, kind, channel) reminder keys', (dupJobs[0]?.n ?? -1) === 0, `${dupJobs[0]?.n} duplicate key(s)`);

  const drift = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "Client" c
    WHERE c."businessId" = ANY(${ids}::text[]) AND (
      c."attended"    <> (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c."id" AND a."status" = 'ATTENDED') OR
      c."noShows"     <> (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c."id" AND a."status" = 'NO_SHOW') OR
      c."lateCancels" <> (SELECT count(*) FROM "Appointment" a WHERE a."clientId" = c."id" AND a."status" = 'LATE_CANCEL'))`;
  add('client counters equal the appointment history', (drift[0]?.n ?? -1) === 0, `${drift[0]?.n} client(s) differ`);

  const pendingEmail = await prisma.reminderJob.count({
    where: { businessId: { in: ids }, channel: 'EMAIL', status: { in: ['PENDING', 'SENDING'] } },
  });
  add('zero PENDING or SENDING EMAIL reminder jobs', pendingEmail === 0, `${pendingEmail} found`);

  const emails = await prisma.client.count({ where: { businessId: { in: ids }, email: { not: null } } });
  add('no client has an e-mail address', emails === 0, `${emails} found`);

  const contact =
    (await prisma.appointment.count({ where: { businessId: { in: ids }, contactEmail: { not: null } } })) +
    (await prisma.waitlistEntry.count({ where: { businessId: { in: ids }, contactEmail: { not: null } } }));
  add('no booking or waitlist contact e-mail', contact === 0, `${contact} found`);

  const badPhones = await prisma.client.count({
    where: { businessId: { in: ids }, NOT: { phone: { startsWith: '+961' } } },
  });
  add('every client phone is an LB E.164 number', badPhones === 0, `${badPhones} not starting with +961`);

  const incomplete = businesses.filter(
    (b) =>
      !b.listed || !isCategoryKey(b.category) || !isAreaKey(b.area) || !b.address?.trim() ||
      b.timezone !== 'Asia/Beirut' || !['en', 'ar'].includes(b.locale) || !b.name.trim(),
  );
  add('every business is listed with a complete profile', incomplete.length === 0, incomplete.map((b) => b.slug).join(', ') || 'all complete');

  const noStaffHours = await prisma.staffMember.count({
    where: { businessId: { in: ids }, workingHours: { none: {} } },
  });
  add('every staff member has working hours', noStaffHours === 0, `${noStaffHours} without`);

  // The real slot engine: a free time within 48 hours for every business.
  const { liveNextFree } = await import('../../src/server/services/directoryLive');
  const live = await liveNextFree(ids, now);
  const nextFree = businesses.map((b) => {
    const nf = live.get(b.id)?.nextFree ?? null;
    return {
      slug: b.slug,
      startAt: nf ? nf.startAt.toISOString() : null,
      hoursAway: nf ? Math.round(((nf.startAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10 : null,
    };
  });
  const late = nextFree.filter((n) => n.hoursAway === null || n.hoursAway > 48);
  add('every business has a free slot within 48 hours', late.length === 0, late.map((n) => n.slug).join(', ') || 'all have one');

  // The real pilot report for the flagship.
  let pilot: PilotFigures | null = null;
  const flagship = businesses.find((b) => b.slug === FLAGSHIP_SLUG);
  if (flagship) {
    const owner = await prisma.membership.findFirst({
      where: { businessId: flagship.id, role: 'OWNER' },
      select: { userId: true },
    });
    if (owner) {
      const { pilotService } = await import('../../src/server/services/pilot');
      const { rootLogger } = await import('../../src/server/http/logger');
      const ctx = {
        requestId: 'demo-check', logger: rootLogger, businessId: flagship.id, userId: owner.userId,
        role: 'OWNER' as const, sessionId: 'demo-check',
      };
      const r = await pilotService.report(ctx, 6, () => now);
      pilot = {
        baselineAppointments: r.baseline?.appointments ?? null,
        baselineNoShows: r.baseline?.noShows ?? null,
        baselineRate: r.pilot.baselineRate,
        currentRate: r.pilot.noShowRate,
        relativeChangePct: r.pilot.changeRelativePct,
        attended: r.pilot.attended,
        noShows: r.pilot.noShows,
        lateCancels: r.pilot.lateCancels,
        appointments: r.pilot.appointments,
        confirmRate: r.signals.confirmRate,
        cancellationsViaLink: r.signals.cancellationsViaLink,
        waitlistSlotsOffered: r.signals.waitlistSlotsOffered,
        waitlistRefills: r.signals.waitlistRefills,
        waitlistRefillRate: r.signals.waitlistRefillRate,
        weekly: r.weekly.map((w) => ({ weekStart: w.weekStart, noShowRate: w.noShowRate, attended: w.attended, noShows: w.noShows })),
      };
      add(
        'flagship pilot report reads about 9 to 10 percent against an 18 percent baseline',
        pilot.baselineRate !== null && pilot.baselineRate >= 17 && pilot.baselineRate <= 19 &&
          pilot.currentRate !== null && pilot.currentRate >= 8 && pilot.currentRate <= 11,
        `baseline ${pilot.baselineRate}%, current ${pilot.currentRate}%`,
      );
    }
  }

  return { businesses: businesses.length, checks, pilot, nextFree, ok: checks.every((c) => c.ok) };
}
