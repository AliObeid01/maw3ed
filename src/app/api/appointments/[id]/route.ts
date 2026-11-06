import { AppointmentParams } from '@/server/contracts/booking';
import { ok, withRoute } from '@/server/http/withRoute';
import { appointmentsService } from '@/server/services/appointments';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF', 'PRACTITIONER'], params: AppointmentParams },
  async ({ ctx, params }) => ok(await appointmentsService.get(ctx, params.id)),
);
