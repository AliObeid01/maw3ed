import { describe, expect, it } from 'vitest';
import {
  beforeBreadcrumb,
  beforeSend,
  isNoiseEvent,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  scrubUrl,
  scrubValue,
} from '@/lib/observability/scrub';

describe('scrubString: personal data', () => {
  it('replaces email addresses', () => {
    expect(scrubString('failed for lina.k+test@example.co.uk now')).toBe('failed for [email] now');
    expect(scrubString('a@b.io,c@d.io')).toBe('[email],[email]');
  });

  it.each([
    ['+96171123456', '[phone]'],
    ['+961 3 123 456', '[phone]'],
    ['+961 71 123 456', '[phone]'],
    ['00961 71 123 456', '[phone]'],
    ['961 71 123 456', '[phone]'],
    ['03 123 456', '[phone]'],
    ['03123456', '[phone]'],
    ['71 123 456', '[phone]'],
    ['71-123-456', '[phone]'],
    ['76123456', '[phone]'],
    ['81 123 456', '[phone]'],
    ['01 234 567', '[phone]'],
    ['+44 20 7946 0958', '[phone]'],
    ['٠٣ ١٢٣ ٤٥٦', '[phone]'],
  ])('redacts the phone %s', (input, out) => {
    expect(scrubString(input)).toBe(out);
    expect(scrubString(`call ${input}, please`)).toBe(`call ${out}, please`);
  });

  it('redacts long opaque tokens but not ids or words', () => {
    const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6-_Q7';
    expect(scrubString(`bad token ${token} given`)).toBe('bad token [token] given');
    expect(scrubString('x'.repeat(40))).toBe('[token]');
    expect(scrubString('clx1abc2def3ghi4jkl5mno6p')).toBe('clx1abc2def3ghi4jkl5mno6p'); // 25-char id
    expect(scrubString('booking.confirm.title')).toBe('booking.confirm.title');
  });

  it('keeps booking times, prices, dates, counts and Arabic digits that are not phones', () => {
    for (const keep of [
      'Booked at 09:30 for 45 min',
      'Deposit $15 or 15.50 USD',
      '1,250,000 LBP',
      '2026-11-08T09:30:00.000Z',
      '2026-11-08',
      '08-11-2026',
      '08/11/2026',
      '12345',
      '1234567',
      'الساعة 5 مساء',
      'لديك 3 مواعيد في 12 يوم',
      'الموعد رقم 12345 الساعة ٠٩:٣٠',
      'تم الحجز بسعر 15$ لمدة 45 دقيقة',
      'v10.78.0 build 4821',
      'port 3800',
    ]) {
      expect(scrubString(keep)).toBe(keep);
    }
  });

  it('is fast and bounded on very long strings', () => {
    const long = 'a'.repeat(2_000_000);
    const t = Date.now();
    const out = scrubString(long);
    expect(Date.now() - t).toBeLessThan(500);
    expect(out.length).toBeLessThan(5000);
    const hostile = '1'.repeat(200_000) + '@' + 'x'.repeat(100_000);
    expect(() => scrubString(hostile)).not.toThrow();
  });
});

describe('scrubUrl and token routes', () => {
  it.each([
    ['https://maw3ed.com/l/AbCdEf123?lang=ar#x', 'https://maw3ed.com/l/[token]'],
    ['/l/abc123', '/l/[token]'],
    ['/o/abc123', '/o/[token]'],
    ['/o/abc123/leave?x=1', '/o/[token]/leave'],
    ['/pay/abc123', '/pay/[token]'],
    ['/invite/abc123', '/invite/[token]'],
    ['/verify-email/abc123', '/verify-email/[token]'],
    ['/reset-password/abc123', '/reset-password/[token]'],
    ['/activate/abc123', '/activate/[token]'],
    ['/activate/abc123?lang=ar', '/activate/[token]'],
    ['/api/activation/abc123', '/api/activation/[token]'],
    ['https://maw3ed.com/api/activation/AbC123_-x', 'https://maw3ed.com/api/activation/[token]'],
    ['/b/studio-nour?service=hc&phone=71123456', '/b/studio-nour'],
    ['http://localhost:3000/b/studio-nour/?lang=ar', 'http://localhost:3000/b/studio-nour/'],
    ['/api/staff/clx1abc2def3ghi4jkl5mno6p?x=1', '/api/staff/clx1abc2def3ghi4jkl5mno6p'],
  ])('%s -> %s', (input, out) => {
    expect(scrubUrl(input)).toBe(out);
  });

  it('templates token segments inside free text too (messages, breadcrumbs)', () => {
    expect(scrubString('GET /l/AbCdEf123 failed')).toBe('GET /l/[token] failed');
    expect(scrubString('see https://x.test/o/zzz/leave?a=b now')).toBe(
      'see https://x.test/o/[token]/leave now',
    );
  });

  it('never throws on garbage', () => {
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl('::::???###')).toEqual(expect.any(String));
  });
});

describe('scrubValue: keys, nesting, cycles', () => {
  it('redacts values under password/secret/authorization-like keys at any depth', () => {
    const out = scrubValue({
      password: 'hunter2',
      nested: { Authorization: 'Bearer abc', deep: [{ clientSecret: 'x', ok: 'fine' }] },
      cookie: 'a=b',
      'x-csrf-token': 'zzz',
      apiKey: 'k',
      phone: '71123456',
      email: 'a@b.io',
    }) as Record<string, unknown>;
    expect(out).toEqual({
      password: '[redacted]',
      nested: { Authorization: '[redacted]', deep: [{ clientSecret: '[redacted]', ok: 'fine' }] },
      cookie: '[redacted]',
      'x-csrf-token': '[redacted]',
      apiKey: '[redacted]',
      phone: '[redacted]',
      email: '[redacted]',
    });
  });

  it('scrubs strings inside arrays and nested objects', () => {
    expect(scrubValue({ list: ['mail a@b.io', 3, null, { p: 'ring 03 123 456' }] })).toEqual({
      list: ['mail [email]', 3, null, { p: 'ring [phone]' }],
    });
  });

  it('survives circular references', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    const out = scrubValue(a) as Record<string, unknown>;
    expect(out.name).toBe('x');
    expect(out.self).toBe('[circular]');
  });

  it('bounds depth and array length', () => {
    let deep: Record<string, unknown> = { leaf: 'a@b.io' };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    expect(JSON.stringify(scrubValue(deep))).not.toContain('a@b.io');
    const big = scrubValue(Array.from({ length: 1000 }, (_, i) => i)) as unknown[];
    expect(big.length).toBeLessThanOrEqual(101);
  });

  it('keeps primitives and handles hostile objects without throwing', () => {
    expect(scrubValue(5)).toBe(5);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(undefined)).toBeUndefined();
    const hostile = {
      get boom(): string {
        throw new Error('getter');
      },
    };
    expect(() => scrubValue(hostile)).not.toThrow();
    expect(() =>
      scrubValue({ [Symbol('s')]: 1, f: () => 1, d: new Date(0), e: new Error('e a@b.io') }),
    ).not.toThrow();
    expect(JSON.stringify(scrubValue(new Error('e a@b.io')))).not.toContain('a@b.io');
  });
});

describe('scrubEvent', () => {
  const event = () => ({
    event_id: 'abc',
    message: 'Booking failed for lina@example.com',
    user: { id: 'u1', email: 'lina@example.com', ip_address: '1.2.3.4' },
    server_name: 'vercel-host',
    transaction: '/l/AbCdEf123',
    request: {
      url: 'https://maw3ed.com/l/AbCdEf123?lang=ar',
      method: 'POST',
      query_string: 'phone=71123456',
      cookies: { session: 'secret' },
      data: { name: 'Lina', phone: '71123456' },
      headers: {
        cookie: 'session=abc',
        authorization: 'Bearer x',
        'x-cron-secret': 'zzz',
        'x-csrf-token': 'q',
        'user-agent': 'UA/1.0',
        'accept-language': 'ar',
        referer: 'https://maw3ed.com/o/tok123',
      },
      env: { REMOTE_ADDR: '1.2.3.4' },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'password=hunter2 for +96171123456 at /pay/ABCDEF',
          stacktrace: {
            frames: [
              {
                filename: 'https://maw3ed.com/_next/static/chunks/a.js?x=1',
                function: 'f',
                vars: { email: 'a@b.io' },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      {
        category: 'console',
        level: 'error',
        message: 'oops a@b.io',
        data: { arguments: ['a@b.io'] },
      },
      { category: 'ui.click', message: 'button.pay', data: {} },
      { category: 'fetch', data: { url: '/api/x?token=abc' } },
      { category: 'navigation', data: { from: '/l/abc', to: '/o/def' } },
    ],
    extra: { who: 'a@b.io', password: 'p' },
    contexts: { custom: { phone: '03 123 456', ok: 1 } },
    tags: { route: '/api/staff/[id]', requestId: 'req-12345678', note: 'a@b.io' },
  });

  it('removes the user, cookies, body, query string and sensitive headers', () => {
    const out = scrubEvent(event())!;
    const json = JSON.stringify(out);
    expect(out.user).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.env).toBeUndefined();
    expect(out.request?.headers).toEqual({ 'user-agent': 'UA/1.0' });
    expect(out.request?.url).toBe('https://maw3ed.com/l/[token]');
    expect(out.transaction).toBe('/l/[token]');
    for (const leak of [
      'lina@example.com',
      'hunter2',
      '96171123456',
      'AbCdEf123',
      'ABCDEF',
      'secret',
      '71123456',
      'a@b.io',
      '03 123 456',
      '1.2.3.4',
      'x-cron',
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(out.message).toBe('Booking failed for [email]');
  });

  it('keeps useful diagnostics: stack, route tag, request id', () => {
    const out = scrubEvent(event())!;
    expect(out.tags).toMatchObject({ route: '/api/staff/[id]', requestId: 'req-12345678' });
    const frame = out.exception!.values![0]!.stacktrace!.frames![0]!;
    expect(frame.filename).toBe('https://maw3ed.com/_next/static/chunks/a.js');
    expect(frame.function).toBe('f');
    expect(frame.vars).toBeUndefined();
  });

  it('keeps only navigation breadcrumbs, without data; console output is dropped entirely', () => {
    const out = scrubEvent(event())!;
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs![0]!.category).toBe('navigation');
    expect(out.breadcrumbs![0]!.data).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('oops');
  });

  it('tells Sentry never to infer the IP address, and keeps the trace ids intact', () => {
    const out = scrubEvent({
      ...event(),
      sdk: { name: 'sentry.javascript.nextjs', settings: { infer_ip: 'auto' } },
      contexts: { trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) } },
    } as never) as unknown as {
      sdk: { settings: { infer_ip: string } };
      contexts: { trace: { trace_id: string } };
    };
    expect(out.sdk.settings.infer_ip).toBe('never');
    expect(out.contexts.trace.trace_id).toBe('a'.repeat(32));
  });

  it('keeps request ids (uuid) readable', () => {
    const id = '6339d5a4-5d68-4c57-95e2-ef6169d57fcf';
    expect(scrubString(`failed ${id}`)).toBe(`failed ${id}`);
  });

  it('does not mutate its input', () => {
    const e = event();
    const copy = JSON.stringify(e);
    scrubEvent(e);
    expect(JSON.stringify(e)).toBe(copy);
  });
});

describe('breadcrumbs', () => {
  it('keeps only navigation: console (any level), fetch, xhr and ui crumbs are dropped', () => {
    expect(
      scrubBreadcrumb({ category: 'console', level: 'error', message: 'Booking for Rana Haddad' }),
    ).toBeNull();
    expect(scrubBreadcrumb({ category: 'console', level: 'log', message: 'x' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'xhr', data: { url: '/api/a?b=c' } })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'input[name=phone]' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'navigation', data: { to: '/l/abc' } })).toEqual({
      category: 'navigation',
    });
    expect(beforeBreadcrumb({ category: 'fetch' })).toBeNull();
  });
});

describe('noise', () => {
  const withValue = (value: string, type = 'Error') => ({
    exception: { values: [{ type, value }] },
  });
  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured with keys: code, message',
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
    'The user aborted a request.',
    'Failed to fetch',
    'Load failed',
  ])('drops %s', (msg) => {
    expect(isNoiseEvent(withValue(msg))).toBe(true);
    expect(beforeSend(withValue(msg))).toBeNull();
  });

  it('drops AbortError by type and redirect digests', () => {
    expect(isNoiseEvent(withValue('x', 'AbortError'))).toBe(true);
    expect(
      isNoiseEvent({
        exception: {
          values: [{ type: 'Error', value: 'x', digest: 'NEXT_REDIRECT;replace;/a;307;' } as never],
        },
      }),
    ).toBe(true);
  });

  it('drops events whose stack is only browser extensions, keeps mixed stacks', () => {
    const frames = (...names: string[]) => ({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            stacktrace: { frames: names.map((filename) => ({ filename })) },
          },
        ],
      },
    });
    expect(isNoiseEvent(frames('chrome-extension://abc/content.js'))).toBe(true);
    expect(isNoiseEvent(frames('moz-extension://abc/c.js', 'chrome-extension://abc/d.js'))).toBe(
      true,
    );
    expect(
      isNoiseEvent(frames('chrome-extension://abc/c.js', 'https://maw3ed.com/_next/a.js')),
    ).toBe(false);
    expect(isNoiseEvent(frames('https://maw3ed.com/_next/a.js'))).toBe(false);
  });

  it('keeps ordinary errors', () => {
    expect(isNoiseEvent(withValue('Cannot read properties of undefined'))).toBe(false);
    expect(beforeSend(withValue('Cannot read properties of undefined'))).not.toBeNull();
  });
});

describe('beforeSend never throws: it drops the event instead', () => {
  it('returns null when scrubbing blows up', () => {
    const evil = {
      get message(): string {
        throw new Error('boom');
      },
    };
    expect(beforeSend(evil as never)).toBeNull();
  });
});
