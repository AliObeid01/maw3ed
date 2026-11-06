import { StaffLoginBody, StaffLoginParams } from '@/server/contracts/staffLogin';
import { ok, withRoute } from '@/server/http/withRoute';
import { staffLoginService } from '@/server/services/staffLogin';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], params: StaffLoginParams, body: StaffLoginBody },
  async ({ ctx, params, body }) => {
    const link = await staffLoginService.createLink(ctx, params.id, body);
    // The response carries a bearer secret: never cache it.
    return Response.json(link, { headers: { 'Cache-Control': 'no-store' } });
  },
);

export const DELETE = withRoute(
  { auth: 'session', roles: ['OWNER'], params: StaffLoginParams },
  async ({ ctx, params }) => ok(await staffLoginService.turnOff(ctx, params.id)),
);
