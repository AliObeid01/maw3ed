import { AppointmentParams, ContactBody } from '@/server/contracts/booking';
import { ok, withRoute } from '@/server/http/withRoute';
import { appointmentsService } from '@/server/services/appointments';

export const dynamic = 'force-dynamic';

export const PATCH = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: AppointmentParams, body: ContactBody },
  async ({ ctx, params, body }) =>
    ok(await appointmentsService.updateContact(ctx, params.id, body)),
);
