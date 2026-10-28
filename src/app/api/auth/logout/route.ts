import { clearSessionCookie } from '@/server/http/cookies';
import { withRoute } from '@/server/http/withRoute';
import { authService } from '@/server/services/auth';

export const dynamic = 'force-dynamic';

export const POST = withRoute({ auth: 'session' }, async ({ ctx }) => {
  await authService.logout(ctx);
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie() } });
});
