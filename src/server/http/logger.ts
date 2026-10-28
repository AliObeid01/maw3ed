import pino, { type Logger } from 'pino';

export type { Logger };

export const rootLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { app: 'maw3ed' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-cron-secret"]',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
});

export function childLogger(bindings: {
  requestId: string;
  businessId?: string;
  [key: string]: unknown;
}): Logger {
  return rootLogger.child(bindings);
}
