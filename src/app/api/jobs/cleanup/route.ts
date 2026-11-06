import { NoQuery } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { runCleanup } from '@/server/services/cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cron (daily): purge dead sessions, stale invites, used or expired email tokens, old staff activation links and old rate-limit buckets. Idempotent. */
export const POST = withRoute({ auth: 'cron', query: NoQuery }, async ({ ctx }) =>
  ok(await runCleanup(ctx.logger)),
);
