import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  assertCronSecret,
  resolveSession,
  resolveToken,
  type RoleName,
  type TokenIdentity,
} from './auth';
import type { TokenAction } from '@/server/domain/tokens';
import { sessionCookie } from './cookies';
import { AppError, mapError, safeError, zodFields } from './errors';
import { childLogger, type Logger } from './logger';

export type AuthMode = 'public' | 'session' | 'token' | 'cron';

export interface RouteContext {
  requestId: string;
  logger: Logger;
  /** From the session (or the signed token). Never from the body or query. */
  businessId?: string;
  userId?: string;
  role?: RoleName;
  sessionId?: string;
  token?: TokenIdentity;
}

/** Context after a `session` guard: identity is guaranteed. */
export type SessionContext = RouteContext & {
  businessId: string;
  userId: string;
  role: RoleName;
  sessionId: string;
};

export interface RouteConfig {
  auth: AuthMode;
  /** Only meaningful for `session`. Wrong role -> 403. */
  roles?: readonly RoleName[];
  /** Only meaningful for `token`: the link actions this route accepts. Anything else -> 404. */
  acts?: readonly TokenAction[];
  params?: z.ZodType;
  query?: z.ZodType;
  /** Parsed from lower-cased request headers. Not `.strict()`: requests carry many unrelated headers. */
  headers?: z.ZodType;
  body?: z.ZodType;
}

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerArgs<C extends RouteConfig> {
  req: Request;
  ctx: C['auth'] extends 'session' ? SessionContext : RouteContext;
  params: Out<C['params']>;
  query: Out<C['query']>;
  headers: Out<C['headers']>;
  body: Out<C['body']>;
}

type NextRouteArgs = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>;
};

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers });
export const ok = (data: unknown) => json(data, 200);
export const created = (data: unknown) => json(data, 201);
export const noContent = () => new Response(null, { status: 204 });

function parse<S extends z.ZodType | undefined>(schema: S, value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = zodFields(result.error);
    throw AppError.validation(fields, `Invalid ${where}.`);
  }
  return result.data;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Null-prototype object, and prototype-ish keys are dropped, so a query cannot pollute anything. */
function queryToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(url.searchParams.keys())) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return out;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Replace each dynamic segment value in the path with its `[name]`. */
export function routeTemplate(pathname: string, params: Record<string, string | string[]>) {
  const decode = (seg: string) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  };
  let out = pathname;
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      const joined = value.join('/');
      if (joined) out = out.replace(joined, `[...${name}]`);
      continue;
    }
    if (!value) continue;
    out = out
      .split('/')
      .map((seg) => (seg === value || decode(seg) === value ? `[${name}]` : seg))
      .join('/');
  }
  return out;
}

/** Mutating routes with a JSON body require `Content-Type: application/json` (blocks form/text/plain CSRF). */
function assertJsonContentType(req: Request) {
  if (!MUTATING.has(req.method)) return;
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type.trim()))
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request as application/json.');
}

/**
 * Session-authenticated mutations: a present `Origin` must match this request's host or APP_URL's host.
 * An absent Origin (non-browser clients, same-site navigations) passes; SameSite=Lax covers the rest.
 */
function assertSameOrigin(req: Request, url: URL) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get('origin');
  if (origin === null) return;
  const allowed = new Set([url.host]);
  const forwarded = req.headers.get('x-forwarded-host');
  if (forwarded) allowed.add(forwarded);
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  } catch {
    /* ignore a malformed APP_URL */
  }
  let originHost: string | undefined;
  try {
    originHost = new URL(origin).host;
  } catch {
    /* "null" and garbage origins are rejected below */
  }
  if (!originHost || !allowed.has(originHost))
    throw AppError.forbidden('Cross-origin request blocked.');
}

export const MAX_BODY_BYTES = 64 * 1024;

/** Read the body as text, refusing more than MAX_BODY_BYTES (content-length first, then the real bytes). */
async function readLimitedText(req: Request): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw AppError.payloadTooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw AppError.payloadTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req: Request): Promise<unknown> {
  const text = await readLimitedText(req);
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw AppError.validation({ _: 'Body must be valid JSON.' }, 'Invalid body.');
  }
}

/**
 * Wrap a route handler: request id and logger, auth guard, Zod parsing (strict schemas reject unknown
 * fields), one-handler execution, and mapping of every thrown error to `{ error: { code, message, fields } }`.
 */
export function withRoute<C extends RouteConfig>(
  config: C,
  handler: (args: HandlerArgs<C>) => Promise<Response> | Response,
) {
  return async (req: Request, routeArgs?: NextRouteArgs): Promise<Response> => {
    const started = performance.now();
    const incoming = req.headers.get('x-request-id');
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const url = new URL(req.url);
    const ctx: RouteContext = { requestId, logger: childLogger({ requestId }) };
    const rawParams: Record<string, string | string[]> = routeArgs?.params
      ? await Promise.resolve(routeArgs.params).catch(() => ({}))
      : {};
    // Log the route template (/api/invites/[token]/accept), never a path that carries a token.
    const logPath = routeTemplate(url.pathname, rawParams);
    let refresh: { token: string; expiresAt: Date } | undefined;

    /** Never log the raw error object: Prisma/pg messages can embed query parameters. */
    const finish = (res: Response, error?: unknown) => {
      res.headers.set('x-request-id', requestId);
      if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'no-store');
      const entry = {
        method: req.method,
        path: logPath,
        status: res.status,
        durationMs: Math.round(performance.now() - started),
        businessId: ctx.businessId,
      };
      if (error) ctx.logger.error({ ...entry, err: safeError(error) }, 'request failed');
      else ctx.logger.info(entry, 'request');
      return res;
    };

    try {
      if (config.auth === 'cron') {
        assertCronSecret(req);
      } else if (config.auth === 'session') {
        assertSameOrigin(req, url);
        const session = await resolveSession(req);
        if (config.roles && !config.roles.includes(session.role)) throw AppError.forbidden();
        refresh = session.refresh;
        Object.assign(ctx, {
          userId: session.userId,
          businessId: session.businessId,
          role: session.role,
          sessionId: session.sessionId,
        });
        ctx.logger = childLogger({
          requestId,
          businessId: session.businessId,
          userId: session.userId,
        });
      }

      const params = parse(config.params, rawParams, 'params');
      const query = parse(config.query, queryToObject(url), 'query');
      const headers = parse(config.headers, Object.fromEntries(req.headers.entries()), 'headers');
      if (config.body) assertJsonContentType(req);
      const body = config.body ? parse(config.body, await readBody(req), 'body') : undefined;

      if (config.auth === 'token') {
        ctx.token = await resolveToken(
          ((params ?? rawParams) as Record<string, unknown>).token,
          config.acts ?? [],
        );
        ctx.businessId = ctx.token.businessId;
        ctx.logger = childLogger({ requestId, businessId: ctx.businessId });
      }

      const res = await handler({ req, ctx, params, query, headers, body } as HandlerArgs<C>);
      // Sliding session: re-issue the cookie so the browser expiry moves with the database one.
      if (refresh && !res.headers.has('set-cookie'))
        res.headers.append('set-cookie', sessionCookie(refresh.token, refresh.expiresAt));
      return finish(res);
    } catch (error) {
      const mapped = mapError(error);
      return finish(json(mapped.body, mapped.status), mapped.unexpected ? error : undefined);
    }
  };
}
