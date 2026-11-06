import type { Prisma } from '@/generated/prisma/client';
import { ACTIVE_APPOINTMENT_STATUSES } from '@/server/domain/appointmentStatus';
import { assertRoomForBookable } from './billing.repo';
import { db } from './db';

/** Login state shown to the owner: no login yet / link sent / signed up / turned off. `null` = not applicable (owner, receptionist). */
export type StaffLoginStatus = 'NONE' | 'NOT_ACTIVATED' | 'ACTIVE' | 'OFF';

export interface StaffRow {
  id: string;
  displayName: string;
  bookable: boolean;
  active: boolean;
  role: 'OWNER' | 'STAFF' | 'PRACTITIONER' | null;
  serviceIds: string[];
  /** null when this person is signed in as the owner or a receptionist (their own login). */
  loginStatus: StaffLoginStatus | null;
  /** The practitioner's login phone (ACTIVE), or the phone a pending link was made for. Owner-only in the API. */
  loginPhone: string | null;
  linkExpiresAt: Date | null;
}

/** The staff member does not exist in this business (also: belongs to another business). */
export class StaffNotFoundError extends Error {}
/** A service id is not one of this business's services. */
export class ServiceNotOwnedError extends Error {}
/** Deactivation refused: active appointments that have not ended yet. */
export class HasFutureAppointmentsError extends Error {}

export type Tx = Prisma.TransactionClient;

/**
 * Take a row lock on the staff member (`FOR UPDATE`) inside a transaction. Everything that rewrites
 * a staff member's hours or services, deactivates them, or books them must call this first so those
 * operations serialise. Throws StaffNotFoundError when the row is not in this business.
 */
export async function lockStaff(tx: Tx, businessId: string, staffId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "StaffMember" WHERE id = ${staffId} AND "businessId" = ${businessId} FOR UPDATE`;
  if (rows.length !== 1) throw new StaffNotFoundError();
}

/**
 * Take a practitioner's login away inside the caller's transaction (staff row already locked): open links,
 * this business's sessions, the PRACTITIONER membership; the StaffMember and its appointments stay, unlinked
 * and marked `loginOffAt`. Never touches an owner or receptionist login. Returns whether a login was removed.
 */
export async function revokeStaffLogin(
  tx: Tx,
  businessId: string,
  staffId: string,
  now: Date,
): Promise<boolean> {
  await tx.activationToken.deleteMany({
    where: { businessId, staffMemberId: staffId, usedAt: null },
  });
  const staff = await tx.staffMember.findFirst({
    where: { id: staffId, businessId },
    select: { userId: true },
  });
  if (!staff?.userId) return false;
  const membership = await tx.membership.findUnique({
    where: { userId_businessId: { userId: staff.userId, businessId } },
    select: { id: true, role: true },
  });
  if (membership?.role !== 'PRACTITIONER') return false;
  await tx.session.deleteMany({ where: { businessId, userId: staff.userId } });
  await tx.membership.deleteMany({ where: { id: membership.id, businessId } });
  await tx.staffMember.updateMany({
    where: { id: staffId, businessId },
    data: { userId: null, loginOffAt: now },
  });
  return true;
}

/** Every id must be a service of this business, checked inside the caller's transaction. */
async function assertServicesOwned(tx: Tx, businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return;
  const owned = await tx.service.count({ where: { businessId, id: { in: serviceIds } } });
  if (owned !== new Set(serviceIds).size) throw new ServiceNotOwnedError();
}

const staffInclude = (businessId: string) =>
  ({
    services: { where: { businessId }, select: { serviceId: true } },
    user: {
      select: { phone: true, memberships: { where: { businessId }, select: { role: true } } },
    },
    activations: {
      where: { businessId, usedAt: null },
      select: { phone: true, expiresAt: true },
      take: 1,
    },
  }) satisfies Prisma.StaffMemberInclude;

type StaffWithRels = Prisma.StaffMemberGetPayload<{ include: ReturnType<typeof staffInclude> }>;

function loginOf(s: StaffWithRels): Pick<StaffRow, 'loginStatus' | 'loginPhone' | 'linkExpiresAt'> {
  const role = s.user?.memberships[0]?.role ?? null;
  if (s.userId && role === 'PRACTITIONER')
    return { loginStatus: 'ACTIVE', loginPhone: s.user?.phone ?? null, linkExpiresAt: null };
  if (s.userId) return { loginStatus: null, loginPhone: null, linkExpiresAt: null };
  const open = s.activations[0];
  if (open) return { loginStatus: 'NOT_ACTIVATED', loginPhone: open.phone, linkExpiresAt: open.expiresAt };
  return {
    loginStatus: s.loginOffAt ? 'OFF' : 'NONE',
    loginPhone: null,
    linkExpiresAt: null,
  };
}

const toRow = (s: StaffWithRels): StaffRow => ({
  ...loginOf(s),
  id: s.id,
  displayName: s.displayName,
  bookable: s.bookable,
  active: s.active,
  role: s.user?.memberships[0]?.role ?? null,
  serviceIds: s.services.map((x) => x.serviceId).sort(),
});

export const staffRepo = {
  list: async (businessId: string): Promise<StaffRow[]> =>
    (
      await db.staffMember.findMany({
        where: { businessId },
        include: staffInclude(businessId),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map(toRow),

  findById: async (businessId: string, id: string): Promise<StaffRow | null> => {
    const s = await db.staffMember.findFirst({
      where: { id, businessId },
      include: staffInclude(businessId),
    });
    return s ? toRow(s) : null;
  },

  exists: async (businessId: string, id: string) =>
    (await db.staffMember.count({ where: { id, businessId } })) === 1,

  /** Staff member and its service links commit together. Throws ServiceNotOwnedError on a foreign id. */
  create: (
    businessId: string,
    data: { displayName: string; bookable: boolean; serviceIds: string[] },
  ) =>
    db.$transaction(async (tx) => {
      await assertServicesOwned(tx, businessId, data.serviceIds);
      if (data.bookable) await assertRoomForBookable(tx, businessId);
      const staff = await tx.staffMember.create({
        data: { businessId, displayName: data.displayName, bookable: data.bookable },
      });
      const serviceIds = [...new Set(data.serviceIds)];
      if (serviceIds.length > 0)
        await tx.staffService.createMany({
          data: serviceIds.map((serviceId) => ({ businessId, staffId: staff.id, serviceId })),
        });
      return staff.id;
    }),

  /**
   * Apply a patch under a staff row lock. Turning `active` off first refuses
   * (HasFutureAppointmentsError) while any active appointment has not ended (`endAt > now`, so one in
   * progress also blocks). Throws StaffNotFoundError when the row is not in this business.
   */
  update: (
    businessId: string,
    id: string,
    patch: { displayName?: string; bookable?: boolean; active?: boolean },
    now: Date,
  ) =>
    db.$transaction(async (tx) => {
      await lockStaff(tx, businessId, id);
      const current = await tx.staffMember.findFirst({
        where: { id, businessId },
        select: { active: true, bookable: true },
      });
      // Becoming an active bookable member (new flag or reactivation) must fit the plan.
      if (
        current &&
        (patch.active ?? current.active) &&
        (patch.bookable ?? current.bookable) &&
        !(current.active && current.bookable)
      )
        await assertRoomForBookable(tx, businessId, id);
      if (patch.active === false) {
        if (current?.active) {
          const blocking = await tx.appointment.count({
            where: {
              businessId,
              staffId: id,
              status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
              endAt: { gt: now },
            },
          });
          if (blocking > 0) throw new HasFutureAppointmentsError();
        }
        // A deactivated person cannot keep a way in: the practitioner login goes with it.
        await revokeStaffLogin(tx, businessId, id, now);
      }
      const result = await tx.staffMember.updateMany({ where: { id, businessId }, data: patch });
      if (result.count !== 1) throw new StaffNotFoundError();
    }),

  /**
   * Replace the whole set under a staff row lock, so concurrent replaces serialise.
   * Throws StaffNotFoundError / ServiceNotOwnedError.
   */
  replaceServices: (businessId: string, staffId: string, serviceIds: string[]) =>
    db.$transaction(async (tx) => {
      await lockStaff(tx, businessId, staffId);
      const unique = [...new Set(serviceIds)];
      await assertServicesOwned(tx, businessId, unique);
      await tx.staffService.deleteMany({ where: { staffId, businessId } });
      if (unique.length > 0)
        await tx.staffService.createMany({
          data: unique.map((serviceId) => ({ businessId, staffId, serviceId })),
        });
    }),
};
