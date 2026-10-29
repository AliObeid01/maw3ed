import {
  BookingBody,
  RequiredIdempotencyHeaders,
  SlugParams,
} from '@/server/contracts/booking';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { publicBookingService } from '@/server/services/publicBooking';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'public', params: SlugParams, headers: RequiredIdempotencyHeaders, body: BookingBody },
  async ({ ctx, params, headers, body }) => {
    const { replay, ...result } = await publicBookingService.book(
      ctx,
      params.slug,
      body,
      headers['idempotency-key'],
    );
    return replay ? ok(result) : created(result);
  },
);
