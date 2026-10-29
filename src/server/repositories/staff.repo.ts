import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';

export interface StaffRow {
  id: string;
  displayName: string;
  bookable: boolean;
  active: boolean;
  role: 'OWNER' | 'STAFF' | null;
  serviceIds: string[];
}

const staffInclude = (businessId: string) =>
  ({
    services: { where: { businessId }, select: { serviceId: true } },
    user: { select: { memberships: { where: { businessId }, select: { role: true } } } },
  }) satisfies Prisma.StaffMemberInclude;

type StaffWithRels = Prisma.StaffMemberGetPayload<{ include: ReturnType<typeof staffInclude> }>;

const toRow = (s: StaffWithRels): StaffRow => ({
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

  /** Staff member and its service links commit together. */
  create: (
    businessId: string,
    data: { displayName: string; bookable: boolean; serviceIds: string[] },
  ) =>
    db.$transaction(async (tx) => {
      const staff = await tx.staffMember.create({
        data: { businessId, displayName: data.displayName, bookable: data.bookable },
      });
      if (data.serviceIds.length > 0)
        await tx.staffService.createMany({
          data: data.serviceIds.map((serviceId) => ({
            businessId,
            staffId: staff.id,
            serviceId,
          })),
        });
      return staff.id;
    }),

  update: async (
    businessId: string,
    id: string,
    patch: { displayName?: string; bookable?: boolean; active?: boolean },
  ) => {
    const result = await db.staffMember.updateMany({ where: { id, businessId }, data: patch });
    return result.count === 1;
  },

  /** Replace the whole set in one transaction. Returns false when the staff member is not in this business. */
  replaceServices: (businessId: string, staffId: string, serviceIds: string[]) =>
    db.$transaction(async (tx) => {
      if ((await tx.staffMember.count({ where: { id: staffId, businessId } })) !== 1) return false;
      await tx.staffService.deleteMany({ where: { staffId, businessId } });
      if (serviceIds.length > 0)
        await tx.staffService.createMany({
          data: serviceIds.map((serviceId) => ({ businessId, staffId, serviceId })),
        });
      return true;
    }),

  /** BOOKED or CONFIRMED appointments that have not started yet. */
  hasFutureActiveAppointments: async (businessId: string, staffId: string, now: Date) =>
    (await db.appointment.count({
      where: {
        businessId,
        staffId,
        status: { in: ['BOOKED', 'CONFIRMED'] },
        startAt: { gt: now },
      },
    })) > 0,
};
