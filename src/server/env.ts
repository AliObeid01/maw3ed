import { z } from 'zod';
import { AppError } from '@/server/http/errors';
import { rootLogger } from '@/server/http/logger';

export interface ServerEnv {
  /** Public origin without a trailing slash. Production: https only, no localhost fallback. */
  APP_URL: string;
  /** HMAC secret for signed links; undefined only outside production when unset. */
  LINK_SECRET: string | undefined;
}

const DEV_APP_URL = 'http://localhost:3000';

const schema = z
  .object({
    NODE_ENV: z.string().optional(),
    APP_URL: z.string().trim().optional(),
    LINK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === 'production';
    if (env.APP_URL) {
      let url: URL | undefined;
      try {
        url = new URL(env.APP_URL);
      } catch {
        /* reported below */
      }
      if (!url || !/^https?:$/.test(url.protocol) || (prod && url.protocol !== 'https:'))
        ctx.addIssue({
          code: 'custom',
          path: ['APP_URL'],
          message: prod ? 'APP_URL must be a valid https URL.' : 'APP_URL must be a valid URL.',
        });
    } else if (prod) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL is required.' });
    }
    if (env.LINK_SECRET !== undefined && env.LINK_SECRET !== '' && env.LINK_SECRET.length < 32)
      ctx.addIssue({
        code: 'custom',
        path: ['LINK_SECRET'],
        message: 'LINK_SECRET must be at least 32 characters.',
      });
    else if (prod && !env.LINK_SECRET)
      ctx.addIssue({ code: 'custom', path: ['LINK_SECRET'], message: 'LINK_SECRET is required.' });
  });

export const misconfiguredError = () =>
  new AppError(500, 'SERVER_MISCONFIGURED', 'The server is not configured correctly.');

let cached: ServerEnv | undefined;

/**
 * Validated server configuration, evaluated lazily (never at import time, so `next build` works without
 * env) and cached once valid. A failure is never cached, so fixing the environment takes effect on the
 * next call. Throws a 500 SERVER_MISCONFIGURED AppError whose public message names no values.
 */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    rootLogger.error({ invalid: names }, 'server environment is misconfigured');
    throw misconfiguredError();
  }
  const env: ServerEnv = {
    APP_URL: (parsed.data.APP_URL || DEV_APP_URL).replace(/\/+$/, ''),
    LINK_SECRET: parsed.data.LINK_SECRET || undefined,
  };
  if (source === process.env) cached = env;
  return env;
}

/** The link-signing secret, or a SERVER_MISCONFIGURED error. */
export function requireLinkSecret(env: ServerEnv = getServerEnv()): string {
  if (!env.LINK_SECRET) {
    rootLogger.error({ invalid: 'LINK_SECRET' }, 'server environment is misconfigured');
    throw misconfiguredError();
  }
  return env.LINK_SECRET;
}

/** Test seam: forget the cached environment. */
export function resetServerEnv(): void {
  cached = undefined;
}
