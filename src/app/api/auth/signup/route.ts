import { SignupBody } from '@/server/contracts/auth';
import { sessionCookie } from '@/server/http/cookies';
import { json, withRoute } from '@/server/http/withRoute';
import { authService } from '@/server/services/auth';

export const dynamic = 'force-dynamic';

export const POST = withRoute({ auth: 'public', body: SignupBody }, async ({ ctx, body }) => {
  const { info, token, expiresAt } = await authService.signup(ctx, body);
  return json(info, 201, { 'Set-Cookie': sessionCookie(token, expiresAt) });
});
