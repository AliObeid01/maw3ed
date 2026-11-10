import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import type { ProcessedLogo } from '../../src/server/services/logoImage';
import { MANIFEST, placeholderOwnerEmail, placeholderReceptionEmail } from './manifest';
import type { BusinessPlan, DemoPlan } from './plan';

/** The database operations of the demo CLIs. Library code: the CLIs (seed.ts, remove.ts, check.ts) call it. */

export type Log = (line: string) => void;

export function connect(url: string, schema?: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ ...poolConfigFromUrl(url), max: 3 }, schema ? { schema } : undefined),
  });
}

const BATCH = 400;
async function inBatches<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH) as T[]);
}

export const MANIFEST_SLUGS = MANIFEST.map((b) => b.slug);

/** Every login address the demo creates for the given plan (owner, placeholders, receptionist). */
export function demoEmails(plan: DemoPlan): string[] {
  return plan.businesses.flatMap((b) => [b.owner.email, ...(b.reception ? [b.reception.email] : [])]);
}

export interface Conflicts {
  slugs: string[];
  emails: string[];
}

/** What already exists: any manifest slug, any demo login address. Seeding refuses unless both lists are empty. */
export async function findConflicts(prisma: PrismaClient, plan: DemoPlan): Promise<Conflicts> {
  const slugs = (
    await prisma.business.findMany({
      where: { slug: { in: plan.businesses.map((b) => b.spec.slug) } },
      select: { slug: true },
    })
  ).map((b) => b.slug);
  const emails = (
    await prisma.user.findMany({ where: { email: { in: demoEmails(plan) } }, select: { email: true } })
  ).flatMap((u) => (u.email ? [u.email] : []));
  return { slugs: slugs.sort(), emails: emails.sort() };
}

export interface SeedTiming {
  slug: string;
  ms: number;
}

/** Writes one business per transaction. Throws on the first failure (the caller tells the owner to run demo:remove). */
export async function seedDemo(
  prisma: PrismaClient,
  plan: DemoPlan,
  logos: ReadonlyMap<string, ProcessedLogo>,
  log: Log = () => undefined,
): Promise<SeedTiming[]> {
  const timings: SeedTiming[] = [];
  let n = 0;
  for (const b of plan.businesses) {
    n++;
    const started = Date.now();
    await prisma.$transaction(
      async (tx) => {
        await writeBusiness(tx, b, logos.get(b.spec.slug), plan.now);
      },
      { timeout: 600_000, maxWait: 60_000 },
    );
    const ms = Date.now() - started;
    timings.push({ slug: b.spec.slug, ms });
    log(
      `[${n}/${plan.businesses.length}] ${b.spec.slug}: ${b.clients.length} clients, ${b.appointments.length} appointments, ${b.reminderJobs.length} reminder jobs (${ms} ms)`,
    );
  }
  return timings;
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function writeBusiness(tx: Tx, b: BusinessPlan, logo: ProcessedLogo | undefined, now: Date) {
  const users = [b.owner, ...(b.reception ? [b.reception] : [])];
  await tx.user.createMany({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: u.passwordHash,
      emailVerifiedAt: u.emailVerifiedAt,
      createdAt: u.createdAt,
    })),
  });
  await tx.business.create({
    data: {
      id: b.business.id,
      slug: b.business.slug,
      name: b.business.name,
      category: b.business.category,
      area: b.business.area,
      address: b.business.address,
      timezone: b.business.timezone,
      locale: b.business.locale,
      currency: b.business.currency,
      plan: b.business.plan,
      listed: b.business.listed,
      depositEnabled: b.business.depositEnabled,
      depositThreshold: b.business.depositThreshold,
      depositAmount: b.business.depositAmount,
      createdAt: b.business.createdAt,
    },
  });
  await tx.membership.createMany({ data: b.memberships });
  await tx.staffMember.createMany({ data: b.staff });
  await tx.service.createMany({ data: b.services });
  await tx.staffService.createMany({ data: b.staffServices });
  await tx.workingHours.createMany({ data: b.workingHours });
  if (b.timeOff.length) await tx.timeOff.createMany({ data: b.timeOff });
  await inBatches(b.clients, (rows) => tx.client.createMany({ data: rows }));
  await inBatches(b.appointments, (rows) => tx.appointment.createMany({ data: rows }));
  await inBatches(b.reminderJobs, (rows) => tx.reminderJob.createMany({ data: rows }));
  if (b.waitlistEntries.length) await tx.waitlistEntry.createMany({ data: b.waitlistEntries });
  if (b.waitlistOffers.length) await tx.waitlistOffer.createMany({ data: b.waitlistOffers });
  if (b.baseline) await tx.pilotBaseline.create({ data: b.baseline });
  if (logo) {
    // Same row the logo upload writes (businessLogoRepo.upsert): processed WebP, its hash, the 256x256 size.
    await tx.businessLogo.create({
      data: {
        businessId: b.business.id,
        mime: logo.mime,
        bytes: new Uint8Array(logo.bytes),
        width: logo.width,
        height: logo.height,
        hash: logo.hash,
        updatedAt: now,
      },
    });
  }
}

export interface RowCounts {
  [table: string]: number;
}

/** Row counts of every table the demo writes, for the given business ids. */
export async function countRows(prisma: PrismaClient, businessIds: string[]): Promise<RowCounts> {
  const where = { businessId: { in: businessIds } };
  const [
    business, membership, staff, service, staffService, workingHours, timeOff, client, appointment,
    reminderJob, waitlistEntry, waitlistOffer, pilotBaseline, businessLogo, session, invite, payment,
  ] = await Promise.all([
    prisma.business.count({ where: { id: { in: businessIds } } }),
    prisma.membership.count({ where }),
    prisma.staffMember.count({ where }),
    prisma.service.count({ where }),
    prisma.staffService.count({ where }),
    prisma.workingHours.count({ where }),
    prisma.timeOff.count({ where }),
    prisma.client.count({ where }),
    prisma.appointment.count({ where }),
    prisma.reminderJob.count({ where }),
    prisma.waitlistEntry.count({ where }),
    prisma.waitlistOffer.count({ where }),
    prisma.pilotBaseline.count({ where }),
    prisma.businessLogo.count({ where }),
    prisma.session.count({ where }),
    prisma.invite.count({ where }),
    prisma.payment.count({ where }),
  ]);
  return {
    Business: business, Membership: membership, StaffMember: staff, Service: service,
    StaffService: staffService, WorkingHours: workingHours, TimeOff: timeOff, Client: client,
    Appointment: appointment, ReminderJob: reminderJob, WaitlistEntry: waitlistEntry,
    WaitlistOffer: waitlistOffer, PilotBaseline: pilotBaseline, BusinessLogo: businessLogo,
    Session: session, Invite: invite, Payment: payment,
  };
}

export interface RemoveReport {
  businesses: { id: string; slug: string }[];
  before: RowCounts;
  after: RowCounts | null;
  users: { deleted: string[]; kept: { email: string; reason: string }[] };
  applied: boolean;
}

/**
 * Removes ONLY the manifest businesses (found by slug) with every dependent row, children first, then the placeholder
 * owners and (when `demoOwnerEmail` is given) the demo owner, each only if all of their memberships are inside the
 * demo businesses. Nothing else is ever selected.
 */
export async function removeDemo(
  prisma: PrismaClient,
  opts: { slugs?: readonly string[]; demoOwnerEmail?: string | undefined; apply: boolean },
  log: Log = () => undefined,
): Promise<RemoveReport> {
  const slugs = [...(opts.slugs ?? MANIFEST_SLUGS)];
  const businesses = await prisma.business.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const ids = businesses.map((b) => b.id);
  const before = await countRows(prisma, ids);

  const loginEmails = [
    ...slugs.flatMap((s) => [placeholderOwnerEmail(s), placeholderReceptionEmail(s)]),
    ...(opts.demoOwnerEmail ? [opts.demoOwnerEmail.toLowerCase()] : []),
  ];
  const candidates = await prisma.user.findMany({
    where: { email: { in: loginEmails } },
    select: { id: true, email: true, memberships: { select: { businessId: true } } },
  });
  const deletable: { id: string; email: string }[] = [];
  const kept: { email: string; reason: string }[] = [];
  for (const u of candidates) {
    const outside = u.memberships.filter((m) => !ids.includes(m.businessId));
    if (outside.length > 0) kept.push({ email: u.email ?? '', reason: `also a member of ${outside.length} other business(es)` });
    else deletable.push({ id: u.id, email: u.email ?? '' });
  }
  const report: RemoveReport = {
    businesses,
    before,
    after: null,
    users: { deleted: deletable.map((u) => u.email), kept },
    applied: false,
  };
  if (!opts.apply) return report;

  await prisma.$transaction(
    async (tx) => {
      const where = { businessId: { in: ids } };
      // Children first.
      await tx.reminderJob.deleteMany({ where });
      await tx.waitlistOffer.deleteMany({ where });
      await tx.waitlistEntry.deleteMany({ where });
      await tx.payment.deleteMany({ where });
      await tx.appointment.deleteMany({ where });
      await tx.client.deleteMany({ where });
      await tx.timeOff.deleteMany({ where });
      await tx.workingHours.deleteMany({ where });
      await tx.staffService.deleteMany({ where });
      await tx.activationToken.deleteMany({ where });
      await tx.staffMember.deleteMany({ where });
      await tx.service.deleteMany({ where });
      await tx.pilotBaseline.deleteMany({ where });
      await tx.invite.deleteMany({ where });
      await tx.session.deleteMany({ where });
      await tx.membership.deleteMany({ where });
      await tx.businessLogo.deleteMany({ where });
      await tx.business.deleteMany({ where: { id: { in: ids } } });
      if (deletable.length) await tx.user.deleteMany({ where: { id: { in: deletable.map((u) => u.id) } } });
    },
    { timeout: 600_000, maxWait: 60_000 },
  );
  report.applied = true;
  report.after = await countRows(prisma, ids);
  log(`removed ${businesses.length} business(es) and ${deletable.length} user(s)`);
  return report;
}
