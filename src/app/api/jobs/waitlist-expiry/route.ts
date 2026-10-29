import { NoQuery } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { runWaitlistExpiry } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cron: expire due offers and offer each freed slot to the next batch (idempotent). */
export const POST = withRoute({ auth: 'cron', query: NoQuery }, async ({ ctx }) =>
  ok(await runWaitlistExpiry(ctx.logger)),
);
