import { describe, expect, it } from 'vitest';
import {
  buildSentryOptions,
  resolveSentryConfig,
  serverObservabilityEnv,
} from '@/lib/observability/config';
import { createEventGate, eventFingerprint } from '@/lib/observability/gate';

const DSN = 'https://abc123@o1.ingest.de.sentry.io/42';

describe('resolveSentryConfig: enabled only in production with a DSN', () => {
  it('is inert without a DSN, whatever the environment', () => {
    for (const vercelEnv of [undefined, 'production', 'preview', 'development']) {
      expect(resolveSentryConfig({ vercelEnv })).toEqual({ enabled: false, reason: 'no-dsn' });
      expect(resolveSentryConfig({ dsn: '  ', vercelEnv })).toEqual({
        enabled: false,
        reason: 'no-dsn',
      });
    }
  });

  it('never enables previews, development or an unset environment (local)', () => {
    for (const vercelEnv of ['preview', 'development', undefined, '', 'Production']) {
      expect(resolveSentryConfig({ dsn: DSN, vercelEnv })).toEqual({
        enabled: false,
        reason: 'not-production',
      });
    }
  });

  it('rejects a malformed or non-https DSN instead of throwing', () => {
    expect(resolveSentryConfig({ dsn: 'not a url', vercelEnv: 'production' })).toEqual({
      enabled: false,
      reason: 'invalid-dsn',
    });
    expect(resolveSentryConfig({ dsn: 'http://k@host/1', vercelEnv: 'production' })).toEqual({
      enabled: false,
      reason: 'invalid-dsn',
    });
  });

  it('enables production with a DSN and carries the release', () => {
    expect(resolveSentryConfig({ dsn: DSN, vercelEnv: 'production', release: 'deadbeef' })).toEqual(
      {
        enabled: true,
        dsn: DSN,
        environment: 'production',
        release: 'deadbeef',
      },
    );
    expect(resolveSentryConfig({ dsn: DSN, vercelEnv: 'production' })).toEqual({
      enabled: true,
      dsn: DSN,
      environment: 'production',
    });
  });

  it('reads the server inputs from SENTRY_DSN, VERCEL_ENV, VERCEL_GIT_COMMIT_SHA', () => {
    expect(
      serverObservabilityEnv({
        SENTRY_DSN: DSN,
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_SHA: 'abc',
      }),
    ).toEqual({ dsn: DSN, vercelEnv: 'production', release: 'abc' });
    expect(resolveSentryConfig(serverObservabilityEnv({ NODE_ENV: 'production' })).enabled).toBe(
      false,
    );
  });
});

describe('buildSentryOptions: errors only, no personal data', () => {
  const config = resolveSentryConfig({ dsn: DSN, vercelEnv: 'production', release: 'abc' });
  if (!config.enabled) throw new Error('fixture');
  const opts = () => buildSentryOptions(config, { maxEvents: 50, now: () => 0 });

  it('turns off tracing, PII and client reports and samples every error', () => {
    const o = opts();
    expect(o).toMatchObject({
      dsn: DSN,
      environment: 'production',
      release: 'abc',
      sendDefaultPii: false,
      sampleRate: 1,
      tracesSampleRate: 0,
      sendClientReports: false,
    });
    expect(o).not.toHaveProperty('replaysSessionSampleRate');
    expect(o).not.toHaveProperty('profilesSampleRate');
    expect(o).not.toHaveProperty('enableLogs');
  });

  it('scrubs, drops noise, and dedupes identical events', () => {
    const o = opts();
    const ev = () => ({
      message: 'x',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom a@b.io',
            stacktrace: { frames: [{ filename: '/a.js', lineno: 1 }] },
          },
        ],
      },
    });
    const first = o.beforeSend(ev());
    expect(first?.exception?.values?.[0]?.value).toBe('boom [email]');
    expect(o.beforeSend(ev())).toBeNull(); // identical
    expect(
      o.beforeSend({
        exception: { values: [{ type: 'Error', value: 'ResizeObserver loop limit exceeded' }] },
      }),
    ).toBeNull();
  });

  it('caps events per page load', () => {
    const o = buildSentryOptions(config, { maxEvents: 3, now: () => 0 });
    const results = Array.from({ length: 6 }, (_, i) =>
      o.beforeSend({ exception: { values: [{ type: 'Error', value: `e${i}` }] } }),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe('createEventGate', () => {
  it('lets a repeat through again after the window', () => {
    let t = 0;
    const gate = createEventGate({ maxEvents: 5, windowMs: 1000, now: () => t });
    expect(gate.allow('a')).toBe(true);
    expect(gate.allow('a')).toBe(false);
    t = 1500;
    expect(gate.allow('a')).toBe(true);
  });

  it('fingerprints by type, message and top frame', () => {
    const e = (value: string, line: number) => ({
      exception: {
        values: [
          { type: 'Error', value, stacktrace: { frames: [{ filename: 'a.js', lineno: line }] } },
        ],
      },
    });
    expect(eventFingerprint(e('x', 1))).toBe(eventFingerprint(e('x', 1)));
    expect(eventFingerprint(e('x', 1))).not.toBe(eventFingerprint(e('x', 2)));
    expect(eventFingerprint(e('x', 1))).not.toBe(eventFingerprint(e('y', 1)));
  });
});
