import { ExportQuery } from '@/server/contracts/outcomes';
import { withRoute } from '@/server/http/withRoute';
import { pilotService } from '@/server/services/pilot';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER'], query: ExportQuery },
  async ({ ctx, query }) => {
    const { body, filename } = await pilotService.exportCsv(ctx, query);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  },
);
