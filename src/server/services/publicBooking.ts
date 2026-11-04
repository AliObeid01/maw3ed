import { normalizePhone } from '@/server/domain/phone';
import { AppError } from '@/server/http/errors';
import type { RouteContext } from '@/server/http/withRoute';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { availabilityService } from './availability';
import { createHmac } from 'node:crypto';
import { requireLinkSecret } from '@/server/env';
import { rateLimiter, routeRateLimitDisabled } from './rateLimit';
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
        bookingWindowDays: business.bookingWindowDays,
        cancelCutoffMin: business.cancelCutoffMin,
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
      /** F68: the public page requires an email (the route's Zod body already did; this is the backstop). */
      client: { name: string; phone: string; email: string };
    },
    idempotencyKey: string,
    deps: BookDeps = defaultBookDeps,
  ) {
    if (!body.client.email?.trim())
      throw AppError.validation({ 'client.email': 'Enter your email address.' });
    const business = await resolve(slug);
    const logger = ctx.logger.child({ businessId: business.id });
    // Per-phone budget (any IP): a deposit hold in the answer reveals "this number has no-shows", so the
    // number of probes per phone is bounded. Invalid numbers fall through to the booking's own 400.
    // The bucket key is an HMAC of the E.164 (server secret), never the bare number or an unsalted hash.
    const phone = normalizePhone(body.client.phone);
    let hit: { subject: string; windowStart?: Date | undefined } | undefined;
    if (phone && !routeRateLimitDisabled()) {
      const subject = createHmac('sha256', requireLinkSecret()).update(phone).digest('hex');
      const decision = await rateLimiter.consume('bookingPhone', subject);
      if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);
      hit = { subject, windowStart: decision.windowStart };
    }
    // Idempotent replays and requests that fail validation (400) are given their hit back: only real
    // attempts count towards the probe budget.
    const refund = () =>
      hit ? rateLimiter.refund('bookingPhone', hit.subject, hit.windowStart).catch(() => {}) : undefined;
    try {
      const result = await book(
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
      if (result.replay) await refund();
      return result;
    } catch (error) {
      if (error instanceof AppError && error.status === 400) await refund();
      throw error;
    }
  },
};
