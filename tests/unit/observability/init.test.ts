import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initClientSentry } from '@/lib/observability/clientInit';
import {
  resetClientReporting,
  reportClientError,
  reportClientMessageOnce,
} from '@/lib/observability/clientReport';
import { initServerSentry } from '@/server/observability/init';
import { isActive } from '@/server/observability/report';

const DSN = 'https://abc123@o1.ingest.de.sentry.io/42';

/** A stand-in for @sentry/nextjs that records every call. */
function fakeSdk() {
  const calls = {
    init: [] as Record<string, unknown>[],
    captured: [] as unknown[],
    messages: [] as string[],
  };
  const sdk = {
    init: (o: Record<string, unknown>) => void calls.init.push(o),
    captureException: (e: unknown) => void calls.captured.push(e),
    captureMessage: (m: string) => void calls.messages.push(m),
    withScope: (fn: (s: { setTags(t: unknown): void }) => void) => fn({ setTags() {} }),
    flush: async () => true,
    onUncaughtExceptionIntegration: () => ({ name: 'OnUncaught' }),
    onUnhandledRejectionIntegration: () => ({ name: 'OnUnhandled' }),
    linkedErrorsIntegration: () => ({ name: 'LinkedErrors' }),
    dedupeIntegration: () => ({ name: 'Dedupe' }),
    globalHandlersIntegration: () => ({ name: 'GlobalHandlers' }),
    breadcrumbsIntegration: () => ({ name: 'Breadcrumbs' }),
  };
  return { sdk, calls };
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  delete (globalThis as Record<string, unknown>).__maw3edSentryActive;
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetClientReporting();
});

describe('server init', () => {
  it.each([
    ['no DSN at all', {}],
    ['no DSN in production', { VERCEL_ENV: 'production' }],
    ['a DSN but a preview deployment', { SENTRY_DSN: DSN, VERCEL_ENV: 'preview' }],
    ['a DSN but local (no VERCEL_ENV)', { SENTRY_DSN: DSN }],
    ['a DSN in development', { SENTRY_DSN: DSN, VERCEL_ENV: 'development' }],
    ['a malformed DSN in production', { SENTRY_DSN: 'nope', VERCEL_ENV: 'production' }],
  ])('is inert with %s: the SDK is not even loaded, nothing is sent', async (_name, env) => {
    const load = vi.fn(async () => fakeSdk().sdk as never);
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    await expect(initServerSentry(env, load)).resolves.toBe('inert');
    expect(load).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isActive()).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('initialises the minimal, errors-only SDK in production with a DSN', async () => {
    const { sdk, calls } = fakeSdk();
    const result = await initServerSentry(
      { SENTRY_DSN: DSN, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abc123' },
      async () => sdk as never,
    );
    expect(result).toBe('enabled');
    expect(calls.init).toHaveLength(1);
    const o = calls.init[0]!;
    expect(o).toMatchObject({
      dsn: DSN,
      environment: 'production',
      release: 'abc123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      defaultIntegrations: false,
      enableOpenTelemetrySetup: false,
    });
    expect((o.integrations as { name: string }[]).map((i) => i.name)).toEqual([
      'OnUncaught',
      'OnUnhandled',
      'LinkedErrors',
      'Dedupe',
    ]);
    expect(typeof o.beforeSend).toBe('function');
    expect(o).not.toHaveProperty('integrations.Http');
    expect(isActive()).toBe(true);
  });

  it('never throws if the SDK fails to load or init', async () => {
    await expect(
      initServerSentry({ SENTRY_DSN: DSN, VERCEL_ENV: 'production' }, async () => {
        throw new Error('chunk');
      }),
    ).resolves.toBe('failed');
    expect(isActive()).toBe(false);
  });
});

describe('client init', () => {
  const win = () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    return {
      addEventListener: (t: string, h: (e: unknown) => void) => void (handlers[t] = h),
      removeEventListener: (t: string) => void delete handlers[t],
      handlers,
    };
  };

  it.each([
    ['no DSN', { vercelEnv: 'production' }],
    ['a DSN in a preview build', { dsn: DSN, vercelEnv: 'preview' }],
    ['a DSN and an unset (local) environment', { dsn: DSN }],
  ])('is inert with %s: no SDK load, no listeners, no reporter', async (_n, env) => {
    const load = vi.fn(async () => fakeSdk().sdk as never);
    const w = win();
    const result = initClientSentry({ env, loadSdk: load, win: w as never, now: () => 0 });
    expect(result).toBe('inert');
    expect(load).not.toHaveBeenCalled();
    expect(Object.keys(w.handlers)).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The report helpers are no-ops: nothing queued, nothing sent.
    reportClientError(new Error('x'));
    reportClientMessageOnce('k', 'warning', 'i18n missing message', {});
  });

  it('loads the SDK lazily, replays early errors, then routes reports to it', async () => {
    const { sdk, calls } = fakeSdk();
    let release: (v: never) => void = () => {};
    const load = vi.fn(() => new Promise<never>((r) => (release = r)));
    const w = win();
    expect(
      initClientSentry({
        env: { dsn: DSN, vercelEnv: 'production', release: 'r1' },
        loadSdk: load,
        win: w as never,
        now: () => 0,
      }),
    ).toBe('loading');
    // Before the SDK arrives: an unhandled error and an i18n report are buffered.
    w.handlers.error!({ error: new Error('early') });
    reportClientMessageOnce('k1', 'warning', 'i18n missing message', { key: 'a' });
    expect(calls.captured).toHaveLength(0);
    release(sdk as never);
    await vi.waitFor(() => expect(calls.init).toHaveLength(1));
    await vi.waitFor(() => expect(calls.captured).toHaveLength(1));
    expect((calls.captured[0] as Error).message).toBe('early');
    expect(calls.messages).toEqual(['i18n missing message']);
    expect(Object.keys(w.handlers)).toHaveLength(0); // the SDK's own handlers take over
    expect(calls.init[0]!).toMatchObject({
      dsn: DSN,
      environment: 'production',
      release: 'r1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      defaultIntegrations: false,
    });
    expect((calls.init[0]!.integrations as { name: string }[]).map((i) => i.name)).toEqual([
      'GlobalHandlers',
      'LinkedErrors',
      'Dedupe',
      'Breadcrumbs',
    ]);
    reportClientError(new Error('later'));
    expect(calls.captured).toHaveLength(2);
  });

  it('survives a failed SDK load', async () => {
    const w = win();
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    initClientSentry({
      env: { dsn: DSN, vercelEnv: 'production' },
      loadSdk: load,
      win: w as never,
      now: () => 0,
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    expect(() => reportClientError(new Error('x'))).not.toThrow();
  });
});
