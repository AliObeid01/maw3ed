import { db } from './db';

export interface ServiceFields {
  name: string;
  durationMin: number;
  bufferMin: number;
  price: number;
  active: boolean;
  sortOrder: number;
}

export const serviceRepo = {
  list: (businessId: string, opts: { activeOnly?: boolean } = {}) =>
    db.service.findMany({
      where: { businessId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    }),

  findById: (businessId: string, id: string) => db.service.findFirst({ where: { id, businessId } }),

  create: (
    businessId: string,
    data: Pick<ServiceFields, 'name' | 'durationMin' | 'bufferMin' | 'price'>,
  ) => db.service.create({ data: { businessId, ...data } }),

  /** True when exactly one row of this business was updated. */
  update: async (businessId: string, id: string, patch: Partial<ServiceFields>) => {
    const result = await db.service.updateMany({ where: { id, businessId }, data: patch });
    return result.count === 1;
  },
};
