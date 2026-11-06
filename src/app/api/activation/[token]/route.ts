import { ActivateBody, ActivationParams } from '@/server/contracts/staffLogin';
import { sessionCookie } from '@/server/http/cookies';
import { json, ok, withRoute } from '@/server/http/withRoute';
import { staffLoginService } from '@/server/services/staffLogin';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'activationIp' }, params: ActivationParams },
  async ({ params }) => ok(await staffLoginService.preview(params.token)),
);

export const POST = withRoute(
  {
    auth: 'public',
    rateLimit: { policy: 'activationIp' },
    params: ActivationParams,
    body: ActivateBody,
  },
  async ({ ctx, params, body }) => {
    const { info, token, expiresAt } = await staffLoginService.activate(ctx, params.token, body);
    return json(info, 200, {
      'Set-Cookie': sessionCookie(token, expiresAt),
      'Cache-Control': 'no-store',
    });
  },
);
