import { ReminderParams } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { whatsappRemindersService } from '@/server/services/whatsappReminders';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: ReminderParams },
  async ({ ctx, params }) => ok(await whatsappRemindersService.markSent(ctx, params.id)),
);
