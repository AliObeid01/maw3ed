import pino, { type Logger } from 'pino';

export type { Logger };

const SECRET_KEYS = ['token', 'tokenHash', 'passwordHash', 'password', 'secret'];
const HEADER_KEYS = ['cookie', 'authorization', 'set-cookie', 'x-cron-secret'];

/** Redact secrets at the top level and up to two levels deep (e.g. `req.headers.cookie`, `err.meta.token`). */
export const REDACT_PATHS = [
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  ...HEADER_KEYS.flatMap((k) => [`headers["${k}"]`, `*.headers["${k}"]`, `*.*.headers["${k}"]`]),
];

export function createLogger(
  opts: { level?: string; destination?: pino.DestinationStream } = {},
): Logger {
  return pino(
    {
      level:
        opts.level ??
        process.env.LOG_LEVEL ??
        (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
      base: { app: 'maw3ed' },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    opts.destination,
  );
}

export const rootLogger: Logger = createLogger();

export function childLogger(bindings: {
  requestId: string;
  businessId?: string;
  [key: string]: unknown;
}): Logger {
  return rootLogger.child(bindings);
}
