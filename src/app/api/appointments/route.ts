import {
  AppointmentsQuery,
  BookingBody,
  OptionalIdempotencyHeaders,
} from '@/server/contracts/booking';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { appointmentsService } from '@/server/services/appointments';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: AppointmentsQuery },
  async ({ ctx, query }) => ok(await appointmentsService.list(ctx, query)),
);

export const POST = withRoute(
  {
    auth: 'session',
    roles: ['OWNER', 'STAFF'],
    headers: OptionalIdempotencyHeaders,
    body: BookingBody,
  },
  async ({ ctx, headers, body }) => {
    const { replay, ...result } = await appointmentsService.book(
      ctx,
      body,
      headers['idempotency-key'],
    );
    return replay ? ok(result) : created(result);
  },
);
