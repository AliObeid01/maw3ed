import { json, withRoute } from '@/server/http/withRoute';
import { authService } from '@/server/services/auth';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session' }, async ({ ctx }) =>
  json(await authService.me(ctx), 200, { 'Cache-Control': 'no-store' }),
);
