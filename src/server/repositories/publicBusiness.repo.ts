import { db } from './db';

/** Business settings the booking engine needs. */
export const businessConfigSelect = {
  id: true,
  slug: true,
  name: true,
  category: true,
  area: true,
  address: true,
  timezone: true,
  locale: true,
  slotStepMin: true,
  bookingWindowDays: true,
  minNoticeMin: true,
  cancelCutoffMin: true,
} as const;

export const publicBusinessRepo = {
  /** Slug resolution for public routes: the one lookup that is not scoped by a session businessId. */
  findBySlug: (slug: string) =>
    db.business.findUnique({ where: { slug }, select: businessConfigSelect }),

  /** The assistant (MCP) sees only businesses that opted in to the directory (`listed`). Unlisted = not found. */
  findListedBySlug: (slug: string) =>
    db.business.findFirst({
      where: { slug, listed: true },
      select: { ...businessConfigSelect, currency: true },
    }),

  findListedById: (businessId: string) =>
    db.business.findFirst({
      where: { id: businessId, listed: true },
      select: { ...businessConfigSelect, currency: true },
    }),

  findById: (businessId: string) =>
    db.business.findUnique({ where: { id: businessId }, select: businessConfigSelect }),

  /** Deposit rules and currency of one business (FR-26). */
  async depositSettings(businessId: string) {
    const b = await db.business.findUnique({
      where: { id: businessId },
      select: {
        depositEnabled: true,
        depositThreshold: true,
        depositAmount: true,
        currency: true,
      },
    });
    return b
      ? {
          enabled: b.depositEnabled,
          threshold: b.depositThreshold,
          amount: Number(b.depositAmount.toString()),
          currency: b.currency,
        }
      : null;
  },

  /** Active services, and bookable active staff with the active services they perform. Two queries. */
  async catalogue(businessId: string) {
    const [services, staff] = await Promise.all([
      db.service.findMany({
        where: { businessId, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, durationMin: true, bufferMin: true, price: true },
      }),
      db.staffMember.findMany({
        where: { businessId, active: true, bookable: true },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          displayName: true,
          services: {
            where: { businessId, service: { active: true } },
            select: { serviceId: true },
          },
        },
      }),
    ]);
    return { services, staff };
  },
};
