import { randomUUID } from 'node:crypto';
import { reportError } from '@/server/observability/report';
import { isOwnerConnectorEnabled } from '@/server/mcp/ownerConfig';
import { rateLimiter, routeRateLimitDisabled } from '@/server/services/rateLimit';
import type { RatePolicyName } from '@/server/services/rateLimitPolicies';
import { OAuthError } from '@/server/services/oauth';
import { clientIp, UNKNOWN_IP } from './clientIp';
import { AppError, mapError } from './errors';
import { childLogger, type Logger } from './logger';
import { readLimitedText } from './withRoute';

/**
 * Shared plumbing of the OAuth protocol routes (/api/oauth/*) and the well-known documents. These routes speak the
 * OAuth wire format (`{ error, error_description }`, form bodies), not the app's `{ error: { code } }` envelope, so
 * they do not use withRoute. They share its rules: kill switch first (404), per-IP limit, size cap, no tokens in
 * logs, never an unexpected detail in the answer.
 */
export const OAUTH_HEADERS = {
  'cache-control': 'no-store',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
} as const;

export const notFoundResponse = () =>
  new Response('Not Found', {
    status: 404,
    headers: { ...OAUTH_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  });

export const oauthJson = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...OAUTH_HEADERS, ...extra } });

const MAX_FORM_BYTES = 8 * 1024;
const MAX_JSON_BYTES = 16 * 1024;

/** application/x-www-form-urlencoded body as a flat record. A repeated parameter is a malformed request. */
export async function readForm(req: Request): Promise<Record<string, string>> {
  const type = (req.headers.get('content-type') ?? '').trim();
  if (!/^application\/x-www-form-urlencoded\s*(;|$)/i.test(type))
    throw new OAuthError('invalid_request', 'Send the body as application/x-www-form-urlencoded.');
  let text: string;
  try {
    text = await readLimitedText(req, MAX_FORM_BYTES);
  } catch (error) {
    if (error instanceof AppError && error.status === 413)
      throw new OAuthError('invalid_request', 'The request body is too large.');
    throw error;
  }
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of new URLSearchParams(text)) {
    if (k in out) throw new OAuthError('invalid_request', `The parameter ${k.slice(0, 40)} is repeated.`);
    if (v.length > 2048) throw new OAuthError('invalid_request', `The parameter ${k.slice(0, 40)} is too long.`);
    out[k] = v;
  }
  return out;
}

export async function readJsonBody(req: Request): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test((req.headers.get('content-type') ?? '').trim()))
    throw new OAuthError('invalid_client_metadata', 'Send the request as application/json.');
  let text: string;
  try {
    text = await readLimitedText(req, MAX_JSON_BYTES);
  } catch (error) {
    if (error instanceof AppError && error.status === 413)
      throw new OAuthError('invalid_client_metadata', 'The request body is too large.');
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OAuthError('invalid_client_metadata', 'The body is not valid JSON.');
  }
}

export interface OAuthRouteCtx {
  requestId: string;
  logger: Logger;
  ip: string;
}

/**
 * Wrap one OAuth endpoint. POST runs `fn`; every other method is 404 while the feature is off and 405 while on.
 * `policy` is a per-IP budget (skipped for an unknown address, and by the test switch like every route limit).
 */
export function oauthRoute(
  opts: { policy: RatePolicyName; path: string; allow?: 'POST' | 'GET' },
  fn: (req: Request, ctx: OAuthRouteCtx) => Promise<Response>,
) {
  const method = opts.allow ?? 'POST';
  return async (req: Request): Promise<Response> => {
    if (!isOwnerConnectorEnabled()) return notFoundResponse();
    if (req.method !== method)
      return new Response(null, { status: 405, headers: { ...OAUTH_HEADERS, allow: method } });
    const requestId = randomUUID();
    const ip = clientIp(req);
    const logger = childLogger({ requestId });
    try {
      if (ip !== UNKNOWN_IP && !routeRateLimitDisabled()) {
        const decision = await rateLimiter.consume(opts.policy, ip);
        if (decision.limited)
          return oauthJson(
            { error: 'temporarily_unavailable', error_description: 'Too many requests. Try again later.' },
            429,
            { 'retry-after': String(decision.retryAfterSec) },
          );
      }
      return await fn(req, { requestId, logger, ip });
    } catch (error) {
      if (error instanceof OAuthError) {
        // Reasons are logged without any request value (no code, token, verifier or redirect).
        logger.info({ path: opts.path, error: error.error }, 'oauth request refused');
        return oauthJson({ error: error.error, error_description: error.description }, error.status);
      }
      const mapped = mapError(error);
      if (mapped.unexpected || mapped.status >= 500)
        reportError(error, { route: opts.path, requestId, method: req.method });
      logger.error({ path: opts.path, status: mapped.status }, 'oauth request failed');
      return oauthJson({ error: 'server_error', error_description: 'Try again in a minute.' }, 500);
    }
  };
}

/** Every method answers 404 while the feature is off; used by the page-less well-known documents. */
export function wellKnown(build: () => unknown) {
  const handler = async (req: Request): Promise<Response> => {
    if (!isOwnerConnectorEnabled()) return notFoundResponse();
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return new Response(null, { status: 405, headers: { ...OAUTH_HEADERS, allow: 'GET, HEAD' } });
    // Public, static metadata: readable by browser based MCP clients; it names no secret and changes only with APP_URL.
    return Response.json(build(), {
      headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' },
    });
  };
  return handler;
}
