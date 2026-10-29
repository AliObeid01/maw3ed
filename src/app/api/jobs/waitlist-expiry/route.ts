import { NoQuery } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';

export const dynamic = 'force-dynamic';

/** Stub: the waitlist task (P2.8) expires offers and offers the next batch here. */
export const POST = withRoute({ auth: 'cron', query: NoQuery }, async () => ok({ expired: 0 }));
