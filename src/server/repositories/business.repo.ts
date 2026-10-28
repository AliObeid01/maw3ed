import { db } from './db';

export const businessRepo = {
  slugExists: async (slug: string) =>
    (await db.business.findUnique({ where: { slug }, select: { id: true } })) !== null,
  /** The id comes from the session, so this IS the tenant boundary. */
  findById: (businessId: string) => db.business.findUnique({ where: { id: businessId } }),
};
