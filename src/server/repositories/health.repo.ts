import { db } from './db';

export const healthRepo = {
  /** Cheap round trip to Postgres. Not tenant data, so no businessId. */
  async ping(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  },
};
