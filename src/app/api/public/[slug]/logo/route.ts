import { LogoHeaders, LogoParams, LogoQuery } from '@/server/contracts/logo';
import { withRoute } from '@/server/http/withRoute';
import { logoService } from '@/server/services/logoService';

export const dynamic = 'force-dynamic';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=300, stale-while-revalidate=86400';

/**
 * Public, no cookies, no auth. The image is the stored 256x256 WebP; the hash is the ETag. The page-wide CSP is
 * not applied to /api, so the response carries its own locked-down policy (the image can never run anything).
 */
export const GET = withRoute(
  {
    auth: 'public',
    rateLimit: { policy: 'logoRead' },
    params: LogoParams,
    query: LogoQuery,
    headers: LogoHeaders,
  },
  async ({ params, query, headers }) => {
    const logo = await logoService.serve(params.slug, {
      v: query.v,
      ifNoneMatch: headers['if-none-match'],
    });
    const common = {
      ETag: logo.etag,
      'Cache-Control': logo.immutable ? IMMUTABLE : SHORT,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (logo.status === 'notModified') return new Response(null, { status: 304, headers: common });
    return new Response(new Uint8Array(logo.bytes), {
      status: 200,
      headers: {
        ...common,
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Content-Length': String(logo.bytes.byteLength),
      },
    });
  },
);
