import { AppError } from '@/server/http/errors';
import type { RouteContext } from '@/server/http/withRoute';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { availabilityService } from './availability';
import { book, type BookDeps, defaultBookDeps } from './booking';

async function resolve(slug: string) {
  const business = await publicBusinessRepo.findBySlug(slug);
  if (!business) throw AppError.notFound();
  return business;
}

const num = (v: { toString(): string }) => Number(v.toString());

export const publicBookingService = {
  async getBusiness(ctx: RouteContext, slug: string) {
    const business = await resolve(slug);
    ctx.logger = ctx.logger.child({ businessId: business.id });
    const { services, staff } = await publicBusinessRepo.catalogue(business.id);
    return {
      business: {
        name: business.name,
        slug: business.slug,
        timezone: business.timezone,
        locale: business.locale,
        ...(business.category ? { category: business.category } : {}),
        ...(business.address ? { address: business.address } : {}),
      },
      services: services.map((s) => ({ ...s, price: num(s.price) })),
      staff: staff.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        serviceIds: s.services.map((x) => x.serviceId),
      })),
    };
  },

  async slots(
    ctx: RouteContext,
    slug: string,
    query: { serviceId: string; staffId?: string | undefined; from: string; to: string },
    now: () => Date = () => new Date(),
  ) {
    const business = await resolve(slug);
    ctx.logger = ctx.logger.child({ businessId: business.id });
    return { slots: await availabilityService.slots(business, query, now()) };
  },

  async book(
    ctx: RouteContext,
    slug: string,
    body: {
      serviceId: string;
      staffId: string;
      startAt: string;
      client: { name: string; phone: string; email?: string | undefined };
    },
    idempotencyKey: string,
    deps: BookDeps = defaultBookDeps,
  ) {
    const business = await resolve(slug);
    const logger = ctx.logger.child({ businessId: business.id });
    return book(
      { businessId: business.id, requestId: ctx.requestId, logger },
      {
        serviceId: body.serviceId,
        staffId: body.staffId,
        startAt: new Date(body.startAt),
        client: body.client,
        source: 'PUBLIC',
        idempotencyKey,
      },
      deps,
    );
  },
};
