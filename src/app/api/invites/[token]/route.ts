import { TokenParams } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { invitesService } from '@/server/services/invites';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'public', params: TokenParams }, async ({ params }) =>
  json(await invitesService.preview(params.token), 200, { 'Cache-Control': 'no-store' }),
);
