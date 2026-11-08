import { z } from 'zod';
import { errorResponses, registry } from './registry';
import { SLUG_FORMAT } from './slug';

/** Base64 text: 3 MiB of image is 4 MiB of text; a little slack lets the service answer IMAGE_TOO_LARGE for a file just over 3 MB. */
export const LOGO_BASE64_MAX_CHARS = 4 * 1024 * 1024 + 64;
/** Request body cap for the upload route: the base64 text plus the JSON envelope. */
export const LOGO_BODY_MAX_BYTES = LOGO_BASE64_MAX_CHARS + 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const PutLogoBody = registry.register(
  'PutLogoBody',
  z
    .object({
      image: z
        .string()
        .min(1)
        .max(LOGO_BASE64_MAX_CHARS)
        .regex(BASE64, 'Send the image as base64 text without a data: prefix.')
        .openapi({
          description:
            'PNG, JPEG or WebP, base64 without a `data:` prefix, at most 3 MB decoded. The server detects the real type from the bytes, removes all metadata, centre-crops to a square and stores a 256x256 WebP.',
        }),
    })
    .strict(),
);

export const LogoDto = registry.register(
  'Logo',
  z.object({
    logoUrl: z.string().nullable().openapi({
      description: 'Relative URL of the public logo, versioned: `/api/public/<slug>/logo?v=<hash>`.',
    }),
  }),
);

export const LogoParams = z
  .object({
    slug: z.string().trim().toLowerCase().max(80).regex(SLUG_FORMAT, 'Not a valid slug.'),
  })
  .strict();
export const LogoQuery = z.object({ v: z.string().max(80).optional() }).strict();
export const LogoHeaders = z.object({ 'if-none-match': z.string().max(400).optional() });

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const security = [{ session: [] }];

registry.registerPath({
  method: 'put',
  path: '/api/business/logo',
  summary: 'Upload or replace the business logo (owner)',
  description:
    'JSON body with the image as base64 (max 4 MiB of text, 3 MB of image). Rejects SVG, GIF, AVIF, TIFF and anything that is not a real PNG, JPEG or WebP (UNSUPPORTED_IMAGE), unreadable or oversized-pixel images (INVALID_IMAGE) and files over 3 MB (IMAGE_TOO_LARGE). Per-IP limit: 10 uploads per hour.',
  tags: ['setup'],
  security,
  request: { body: { content: json(PutLogoBody) } },
  responses: {
    200: { description: 'Stored', content: json(LogoDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    413: { description: 'PAYLOAD_TOO_LARGE' },
    429: { description: 'RATE_LIMITED (Retry-After header)' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/business/logo',
  summary: 'Remove the business logo (owner). Idempotent',
  tags: ['setup'],
  security,
  responses: {
    204: { description: 'Removed (or there was none)' },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/public/{slug}/logo',
  summary: 'The business logo as image/webp (public, no cookies)',
  description:
    'Served for any existing business, listed or not (the logo is public branding). ETag = sha256 of the stored bytes, `If-None-Match` answers 304. `Cache-Control: public, max-age=31536000, immutable` when `?v=` is a prefix (8+ characters) of the current hash, otherwise `public, max-age=300, stale-while-revalidate=86400`. `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src \'none\'; sandbox`. 404 when the business has no logo.',
  tags: ['public'],
  request: { params: LogoParams, query: LogoQuery },
  responses: {
    200: {
      description: 'The image',
      content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
    },
    304: { description: 'Not modified' },
    400: errorResponses[400],
    404: errorResponses[404],
    429: { description: 'RATE_LIMITED (Retry-After header)' },
  },
});
