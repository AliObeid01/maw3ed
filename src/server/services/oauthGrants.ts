import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { listGrants, revokeGrantForBusiness } from './oauth';

/** The owner's connected apps. OWNER only; a grant of another business is 404 like every foreign id. */
export const oauthGrantsService = {
  async list(ctx: SessionContext) {
    requireRole(ctx, 'OWNER');
    return listGrants(ctx.businessId);
  },
  async revoke(ctx: SessionContext, grantId: string) {
    requireRole(ctx, 'OWNER');
    if (!(await revokeGrantForBusiness(ctx.businessId, grantId))) throw AppError.notFound();
  },
};
