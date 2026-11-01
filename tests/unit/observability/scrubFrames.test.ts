import { describe, expect, it } from 'vitest';
import { sanitizeCodePath, scrubEvent, scrubString } from '@/lib/observability/scrub';
import { signToken } from '@/server/domain/tokens';

const SECRET = 'unit-test-link-secret-0123456789abcdefghij';
const token = () =>
  signToken({ a: 'clx1abc2def3ghi4jkl5mno6p', act: 'view', exp: 1893456000 }, SECRET);

const PNPM =
  '/var/task/node_modules/.pnpm/next@16.4.3_@babel+core@7.28.0_react-dom@19.3.1_react@19.3.1/node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js';

describe('sanitizeCodePath (stack frame locations only)', () => {
  it.each([
    PNPM,
    'next.dist.compiled.next-server:app-route-turbo.runtime.prod',
    '[root-of-the-server]__0_i1bceaayymk._',
    '/var/task/.next/server/chunks/_0tpbar9p8em7e._.js',
    'node:internal/async_local_storage/async_hooks',
  ])('leaves %s unchanged', (p) => {
    expect(sanitizeCodePath(p)).toBe(p);
  });

  it('replaces home directories', () => {
    expect(sanitizeCodePath('C:\\Users\\rana\\dev\\maw3ed\\src\\a.ts')).toBe(
      'C:/Users/[user]/dev/maw3ed/src/a.ts',
    );
    expect(sanitizeCodePath('C:/Users/rana/dev/a.ts')).toBe('C:/Users/[user]/dev/a.ts');
    expect(sanitizeCodePath('/Users/rana/dev/a.ts')).toBe('/[user]/dev/a.ts');
    expect(sanitizeCodePath('/home/rana/dev/a.ts')).toBe('/[user]/dev/a.ts');
  });

  it('strips query strings and fragments', () => {
    expect(sanitizeCodePath('/var/task/a.js?v=1#x')).toBe('/var/task/a.js');
  });

  it('templates signed tokens and secret-link routes', () => {
    const t = token();
    expect(sanitizeCodePath(`https://x.test/l/${t}`)).toBe('https://x.test/l/[token]');
    expect(sanitizeCodePath(`/var/task/${t}/a.js`)).toBe('/var/task/[token]/a.js');
    expect(sanitizeCodePath('/o/abc123/leave')).toBe('/o/[token]/leave');
  });

  it('caps length', () => {
    expect(sanitizeCodePath('a'.repeat(900)).length).toBeLessThanOrEqual(503);
  });
});

describe('privacy regression: other fields still use the full scrubber', () => {
  const pnpmLike = 'next@16.4.3_@babel+core@7.28.0_react@19.3.1';
  it('message, breadcrumb-ish strings and tags are scrubbed', () => {
    expect(scrubString(pnpmLike)).toContain('[email]');
    const ev = scrubEvent({
      exception: { values: [{ type: 'Error', value: `boom rana@x.com 71 123 456 ${pnpmLike}` }] },
      tags: { note: 'rana@x.com' },
      breadcrumbs: [{ category: 'navigation', message: 'rana@x.com' }],
    } as never) as unknown as {
      exception: { values: { value: string }[] };
      tags: { note: string };
    };
    expect(ev.exception.values[0]!.value).not.toContain('rana@x.com');
    expect(ev.exception.values[0]!.value).toContain('[phone]');
    expect(ev.exception.values[0]!.value).toContain('[email]');
    expect(ev.tags.note).toBe('[email]');
  });
});

describe('scrubEvent on a production-shaped event', () => {
  it('keeps frames and tags, drops source context, adds no fields, no user ip/email/id', () => {
    const frames = [
      {
        function: 'handler',
        module: 'next.dist.compiled.next-server:app-route-turbo.runtime.prod',
        filename: PNPM,
        abs_path: PNPM,
        lineno: 12,
        colno: 3,
        in_app: false,
        data: { x: 1 },
        context_line: 'const secret = "a@b.com"',
        pre_context: ['a'],
        post_context: ['b'],
      },
      { module: '[root-of-the-server]__0_i1bceaayymk._', filename: '/var/task/.next/server/chunks/_0tpbar9p8em7e._.js', lineno: 1 },
      { filename: 'node:internal/async_local_storage/async_hooks', function: 'run' },
    ];
    const event = {
      tags: { runtime: 'node', 'vercel.env': 'production' },
      contexts: { runtime: { name: 'node', version: 'v22.0.0' } },
      user: { ip_address: '1.2.3.4', email: 'a@b.com', id: '7', geo: { country_code: 'LB' } },
      sdk: { name: 'sentry.javascript.nextjs', version: '11.10.0' },
      exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames } }] },
    };
    const out = scrubEvent(event as never) as unknown as Record<string, unknown> & {
      exception: { values: { stacktrace: { frames: Record<string, unknown>[] } }[] };
    };
    const got = out.exception.values[0]!.stacktrace.frames;
    expect(got[0]).toEqual({
      function: 'handler',
      module: 'next.dist.compiled.next-server:app-route-turbo.runtime.prod',
      filename: PNPM,
      abs_path: PNPM,
      lineno: 12,
      colno: 3,
      in_app: false,
    });
    expect(got[1]!.module).toBe('[root-of-the-server]__0_i1bceaayymk._');
    expect(got[1]!.filename).toBe('/var/task/.next/server/chunks/_0tpbar9p8em7e._.js');
    expect(got[2]!.filename).toBe('node:internal/async_local_storage/async_hooks');
    expect(out.tags).toEqual(event.tags);
    expect(out.user).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(['contexts', 'exception', 'sdk', 'tags']);
  });
});
