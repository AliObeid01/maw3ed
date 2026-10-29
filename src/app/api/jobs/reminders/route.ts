import { NoQuery } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { defaultReminderDeps, runReminders } from '@/server/services/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = withRoute({ auth: 'cron', query: NoQuery }, async ({ ctx }) =>
  ok(await runReminders(defaultReminderDeps(ctx.logger))),
);
