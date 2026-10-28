import { db } from './db';

/** Users are global (one login can belong to several businesses), so these are not businessId-scoped. */
export const userRepo = {
  findByEmail: (email: string) => db.user.findUnique({ where: { email } }),
  findById: (id: string) => db.user.findUnique({ where: { id } }),
};
