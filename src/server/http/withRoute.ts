import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  assertCronSecret,
  resolveSession,
  resolveToken,
  type RoleName,
  type TokenIdentity,
} from './auth';
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
  token?: TokenIdentity;
}

/** Context after a `session` guard: identity is guaranteed. */
export type SessionContext = RouteContext & { businessId: string; userId: string; role: RoleName };

export interface RouteConfig {
  auth: AuthMode;
  /** Only meaningful for `session`. Wrong role -> 403. */
  roles?: readonly RoleName[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface HandlerArgs<C extends RouteConfig> {
  req: Request;
  ctx: C['auth'] extends 'session' ? SessionContext : RouteContext;
  params: Out<C['params']>;
  query: Out<C['query']>;
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

    /** Never log the raw error object: Prisma/pg messages can embed query parameters. */
    const finish = (res: Response, error?: unknown) => {
      res.headers.set('x-request-id', requestId);
      const entry = {
        method: req.method,
        path: url.pathname,
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
        const session = await resolveSession(req);
        if (config.roles && !config.roles.includes(session.role)) throw AppError.forbidden();
        Object.assign(ctx, session);
        ctx.logger = childLogger({
          requestId,
          businessId: session.businessId,
          userId: session.userId,
        });
      }

      const rawParams = routeArgs?.params ? await routeArgs.params : {};
      const params = parse(config.params, rawParams, 'params');
      const query = parse(config.query, queryToObject(url), 'query');
      const body = config.body ? parse(config.body, await readBody(req), 'body') : undefined;

      if (config.auth === 'token') {
        ctx.token = await resolveToken(req, params ?? rawParams);
        ctx.businessId = ctx.token.businessId;
        ctx.logger = childLogger({ requestId, businessId: ctx.businessId });
      }

      const res = await handler({ req, ctx, params, query, body } as HandlerArgs<C>);
      return finish(res);
    } catch (error) {
      const mapped = mapError(error);
      return finish(json(mapped.body, mapped.status), mapped.unexpected ? error : undefined);
    }
  };
}
