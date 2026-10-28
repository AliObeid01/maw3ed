import { ok, withRoute } from '@/server/http/withRoute';
import { healthService } from '@/server/services/health';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'public' }, async () => ok(await healthService.check()));
