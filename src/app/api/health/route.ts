import { json, withRoute } from '@/server/http/withRoute';
import { healthService } from '@/server/services/health';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'public' }, async () =>
  json(await healthService.check(), 200, { 'Cache-Control': 'no-store' }),
);
