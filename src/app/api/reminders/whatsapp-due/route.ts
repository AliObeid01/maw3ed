import { ok, withRoute } from '@/server/http/withRoute';
import { whatsappRemindersService } from '@/server/services/whatsappReminders';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER', 'STAFF'] }, async ({ ctx }) =>
  ok(await whatsappRemindersService.due(ctx)),
);
