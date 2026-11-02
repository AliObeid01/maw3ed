import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProductionEnv } from '../../../scripts/lib/productionEnv.mjs';
import { cleanSourceMaps, findPublicSourceMapLeaks } from '../../../scripts/lib/cleanSourcemaps.mjs';
import {
  describeUploadFailure,
  resolveSourcemapUpload,
  sentryUrlFromDsn,
  sourcemapBuildOptions,
} from '../../../scripts/lib/sourcemapUpload.mjs';
import { sanitizeCodePath, scrubEvent } from '@/lib/observability/scrub';

const TOKEN = 'sntrys_eyJpYXQiOjE3NjI3MzUyMDAuMTIzLCJ1cmwiOiJodHRwczovL3NlbnRyeS5pbyJ9_secretsecret';
const full = {
  SENTRY_AUTH_TOKEN: TOKEN,
  SENTRY_ORG: 'maw3ed-01',
  SENTRY_PROJECT: 'maw3ed',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: '82dc3a2e1f',
  NEXT_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.de.sentry.io/42',
};

describe('resolveSourcemapUpload: enabled only with all three variables in production', () => {
  it('is inert with nothing configured, silently', () => {
    expect(resolveSourcemapUpload({})).toEqual({ enabled: false, reason: 'not-configured', warnings: [] });
    expect(resolveSourcemapUpload({ VERCEL_ENV: 'production' }).enabled).toBe(false);
  });

  it('is enabled with all three in production, EU region from the DSN', () => {
    expect(resolveSourcemapUpload(full)).toEqual({
      enabled: true,
      reason: 'enabled',
      warnings: [],
      sentryUrl: 'https://de.sentry.io',
      org: 'maw3ed-01',
      project: 'maw3ed',
      release: '82dc3a2e1f',
    });
  });

  it('never uploads outside production, even fully configured', () => {
    for (const VERCEL_ENV of ['preview', 'development', undefined, '', 'Production']) {
      const r = resolveSourcemapUpload({ ...full, VERCEL_ENV });
      expect(r.enabled).toBe(false);
      expect(r.reason).toBe('not-production');
      expect(r.warnings).toEqual([]);
    }
  });

  it('warns on a partial set (names only, never values) and does not upload', () => {
    for (const drop of ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
      const env: Record<string, string | undefined> = { ...full };
      delete env[drop];
      const r = resolveSourcemapUpload(env);
      expect(r.enabled).toBe(false);
      expect(r.reason).toBe('partial');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(`missing: ${drop}`);
      const text = r.warnings.join(' ');
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('maw3ed-01');
    }
    // Blank values count as missing.
    expect(resolveSourcemapUpload({ ...full, SENTRY_ORG: '  ' }).reason).toBe('partial');
  });

  it('region: SENTRY_URL wins when it is an https origin, else the DSN region, else the SDK default', () => {
    expect(resolveSourcemapUpload({ ...full, SENTRY_URL: 'https://us.sentry.io/' }).sentryUrl).toBe('https://us.sentry.io');
    const bad = resolveSourcemapUpload({ ...full, SENTRY_URL: 'http://x.test/path' });
    expect(bad.sentryUrl).toBe('https://de.sentry.io');
    expect(bad.warnings[0]).toMatch(/SENTRY_URL/);
    expect(resolveSourcemapUpload({ ...full, NEXT_PUBLIC_SENTRY_DSN: undefined }).sentryUrl).toBeUndefined();
    expect(sentryUrlFromDsn('https://k@o9.ingest.us.sentry.io/1')).toBe('https://us.sentry.io');
    expect(sentryUrlFromDsn('https://k@o9.ingest.sentry.io/1')).toBeUndefined();
    expect(sentryUrlFromDsn('not a url')).toBeUndefined();
  });
});

describe('sourcemapBuildOptions', () => {
  it('inert: disables source maps and prints nothing', () => {
    const warn = vi.fn();
    const o = sourcemapBuildOptions({}, warn);
    expect(o.sourcemaps).toEqual({ disable: true });
    expect(o.release).toEqual({ create: false, finalize: false });
    expect(o).not.toHaveProperty('authToken');
    expect(warn).not.toHaveBeenCalled();
  });

  it('partial: disables source maps and warns once without values', () => {
    const warn = vi.fn();
    const o = sourcemapBuildOptions({ SENTRY_AUTH_TOKEN: TOKEN, VERCEL_ENV: 'production' }, warn);
    expect(o.sourcemaps).toEqual({ disable: true });
    expect(o).not.toHaveProperty('authToken');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toContain(TOKEN);
  });

  it('enabled: uploads, deletes the maps, keeps the commit as release and warns (not throws) on failure', () => {
    const warn = vi.fn();
    const o = sourcemapBuildOptions(full, warn);
    expect(o.authToken).toBe(TOKEN);
    expect(o.org).toBe('maw3ed-01');
    expect(o.project).toBe('maw3ed');
    expect(o.sentryUrl).toBe('https://de.sentry.io');
    expect(o.sourcemaps).toEqual({ deleteSourcemapsAfterUpload: true });
    expect(o.release).toEqual({ name: '82dc3a2e1f', create: false, finalize: false });
    expect(warn).not.toHaveBeenCalled();
    expect(() => o.errorHandler!(new Error(`401 Unauthorized for token ${TOKEN}`))).not.toThrow();
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toMatch(/upload failed/);
    expect(line).toMatch(/build continues/);
    expect(line).not.toContain(TOKEN);
    expect(line).toContain('[hidden]');
  });

  it('describeUploadFailure caps the length and tolerates non-errors', () => {
    expect(describeUploadFailure('x'.repeat(900)).length).toBeLessThanOrEqual(303);
    expect(describeUploadFailure(undefined)).toBe('');
    expect(describeUploadFailure(new Error('a\n\n b'), [TOKEN])).toBe('a b');
  });
});

describe('productionEnv: source maps are all-or-nothing and never required', () => {
  const good = {
    DATABASE_URL: 'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db',
    DIRECT_URL: 'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db',
    APP_URL: 'https://maw3ed.example',
    NEXT_PUBLIC_APP_URL: 'https://maw3ed.example',
    LINK_SECRET: 'l'.repeat(40),
    CRON_SECRET: 'c'.repeat(40),
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_x',
    EMAIL_FROM: 'Maw3ed <hello@maw3ed.example>',
    EXPECTED_DB_HOST: 'ep-x.eu-central-1.aws.neon.tech',
    SENTRY_DSN: full.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_DSN: full.NEXT_PUBLIC_SENTRY_DSN,
  };
  it('adds nothing when none or all three are set', () => {
    expect(checkProductionEnv(good)).toEqual({ errors: [], warnings: [] });
    expect(checkProductionEnv({ ...good, ...full })).toEqual({ errors: [], warnings: [] });
  });
  it('only warns when partially set, without printing a value', () => {
    const r = checkProductionEnv({ ...good, SENTRY_AUTH_TOKEN: TOKEN });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/half configured/);
    expect(r.warnings.join(' ')).not.toContain(TOKEN);
  });
});

describe('scrubber keeps symbolicated and bundler frame locations readable', () => {
  it.each([
    'app:///_next/static/chunks/0a1b2c3d4e5f.js',
    'app:///src/components/app/account/AccountView.tsx',
    'webpack://_N_E/./src/server/services/auth.ts',
    'webpack://maw3ed/./src/app/home/page.tsx',
    'webpack-internal:///(rsc)/./src/app/api/auth/change-password/route.ts',
    '/var/task/.next/server/app/api/auth/change-password/route.js',
    './src/lib/observability/scrub.ts',
    'src/app/Users/page.tsx',
  ])('does not mangle %s', (p) => {
    expect(sanitizeCodePath(p)).toBe(p);
  });

  it('keeps symbolicated frames in an event, with line and column', () => {
    const ev = scrubEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: 'app:///src/server/services/auth.ts',
                  abs_path: 'webpack://_N_E/./src/server/services/auth.ts',
                  function: 'authService.signOutOthers',
                  module: 'src.server.services.auth',
                  lineno: 187,
                  colno: 13,
                  in_app: true,
                  context_line: 'const secret = "rana@x.com"',
                },
              ],
            },
          },
        ],
      },
    } as never) as unknown as {
      exception: { values: { stacktrace: { frames: Record<string, unknown>[] } }[] };
    };
    const frame = ev.exception.values[0]!.stacktrace.frames[0]!;
    expect(frame).toEqual({
      filename: 'app:///src/server/services/auth.ts',
      abs_path: 'webpack://_N_E/./src/server/services/auth.ts',
      function: 'authService.signOutOthers',
      module: 'src.server.services.auth',
      lineno: 187,
      colno: 13,
      in_app: true,
    });
  });
});

describe('cleanSourceMaps: nothing public is left', () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('deletes maps and strips sourceMappingURL comments from public assets only', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw3ed-maps-'));
    const w = (rel: string, text: string) => {
      const f = path.join(dir, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    };
    w('static/chunks/a.js', 'console.log(1);\n//# sourceMappingURL=a.js.map\n');
    w('static/chunks/a.js.map', '{}');
    w('static/css/b.css', 'a{b:c}\n/*# sourceMappingURL=b.css.map */\n');
    w('static/css/b.css.map', '{}');
    w('static/chunks/clean.js', 'console.log(2);\n//# debugId=abc\n');
    w('server/chunks/s.js.map', '{}');
    w('server/chunks/s.js', 'x');
    expect(findPublicSourceMapLeaks(dir).length).toBe(4);

    expect(cleanSourceMaps(dir)).toEqual({ deleted: 3, stripped: 2, skipped: 0 });
    expect(findPublicSourceMapLeaks(dir)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'static/chunks/a.js'), 'utf8')).toBe('console.log(1);');
    expect(fs.readFileSync(path.join(dir, 'static/chunks/clean.js'), 'utf8')).toContain('debugId=abc');
    expect(fs.existsSync(path.join(dir, 'server/chunks/s.js.map'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'server/chunks/s.js'))).toBe(true);
  });

  it('is a no-op on a missing folder', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw3ed-maps-'));
    expect(cleanSourceMaps(path.join(dir, 'nope'))).toEqual({ deleted: 0, stripped: 0, skipped: 0 });
  });
});
