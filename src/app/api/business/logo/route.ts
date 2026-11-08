import { LOGO_BODY_MAX_BYTES, PutLogoBody } from '@/server/contracts/logo';
import { noContent, ok, withRoute } from '@/server/http/withRoute';
import { logoService } from '@/server/services/logoService';

export const dynamic = 'force-dynamic';

/**
 * Owner only. The image travels as base64 inside the usual JSON envelope (so the JSON content-type and Origin
 * checks of withRoute apply unchanged); the body cap is raised to 4 MiB for this route only.
 */
export const PUT = withRoute(
  {
    auth: 'session',
    roles: ['OWNER'],
    body: PutLogoBody,
    maxBodyBytes: LOGO_BODY_MAX_BYTES,
    rateLimit: { policy: 'logoUpload' },
  },
  async ({ ctx, body }) => ok(await logoService.put(ctx, body.image)),
);

export const DELETE = withRoute({ auth: 'session', roles: ['OWNER'] }, async ({ ctx }) => {
  await logoService.remove(ctx);
  return noContent();
});
