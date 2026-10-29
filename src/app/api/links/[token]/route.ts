import { LinkActionBody, LinkParams } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { linksService } from '@/server/services/links';

export const dynamic = 'force-dynamic';

const acts = ['view', 'confirm', 'cancel'] as const;

export const GET = withRoute(
  { auth: 'token', rateLimit: { policy: 'linkRead' }, acts, params: LinkParams },
  async ({ ctx }) => {
    const token = ctx.token!;
    return ok(await linksService.get({ businessId: token.businessId, logger: ctx.logger }, token));
  },
);

export const POST = withRoute(
  {
    auth: 'token',
    rateLimit: { policy: 'linkAct' },
    acts,
    params: LinkParams,
    body: LinkActionBody,
  },
  async ({ ctx, body }) => {
    const token = ctx.token!;
    return ok(
      await linksService.act(
        { businessId: token.businessId, logger: ctx.logger },
        token,
        body.action,
      ),
    );
  },
);
