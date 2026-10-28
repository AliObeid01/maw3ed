import { AcceptInviteBody, TokenParams } from '@/server/contracts/auth';
import { sessionCookie } from '@/server/http/cookies';
import { json, withRoute } from '@/server/http/withRoute';
import { invitesService } from '@/server/services/invites';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'public', params: TokenParams, body: AcceptInviteBody },
  async ({ ctx, params, body }) => {
    const { info, token, expiresAt } = await invitesService.accept(ctx, params.token, body);
    return json(info, 200, {
      'Set-Cookie': sessionCookie(token, expiresAt),
      'Cache-Control': 'no-store',
    });
  },
);
