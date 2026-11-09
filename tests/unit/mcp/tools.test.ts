import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';
import type { HitResult } from '@/server/repositories/rateLimit.repo';
import type { AssistantService } from '@/server/services/assistant';
import { LIMITER_DOWN_MESSAGE, phoneSubject, spend } from '@/server/services/assistantLimits';
import { createRateLimiter, type RateLimitStore } from '@/server/services/rateLimit';
import { RATE_POLICIES } from '@/server/services/rateLimitPolicies';
import { callTool } from '@/server/mcp/tools';

const T0 = new Date('2026-11-10T10:00:00.000Z');
const silent = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() }) as never;

function memStore(fail = false) {
  const rows = new Map<string, number>();
  const store: RateLimitStore = {
    async hit(key, windowSec, limit, now, amount = 1): Promise<HitResult> {
      if (fail) throw new Error('db down');
      const ms = windowSec * 1000;
      const start = new Date(Math.floor(now.getTime() / ms) * ms);
      const id = `${key}|${start.toISOString()}`;
      const count = (rows.get(id) ?? 0) + amount;
      rows.set(id, count);
      return {
        windowStart: start,
        count,
        limited: count > limit,
        retryAfterSec: Math.max(1, Math.ceil((start.getTime() + ms - now.getTime()) / 1000)),
      };
    },
    async refund(key, windowStart) {
      const id = `${key}|${windowStart.toISOString()}`;
      rows.set(id, Math.max(0, (rows.get(id) ?? 0) - 1));
    },
    async clear() {},
  };
  return store;
}

const limiterOf = (store: RateLimitStore) =>
  createRateLimiter({ now: () => T0, store, logger: silent(), timeoutMs: 200 });

function fakeService() {
  return {
    search: vi.fn(async () => ({ businesses: [] })),
    getBusiness: vi.fn(async () => ({ business: { name: 'Studio' } })),
    freeTimes: vi.fn(),
    prepare: vi.fn(),
    createBooking: vi.fn(async () => ({
      reference: 'ABC123',
      localLabel: 'Wed 11 Nov, 10:00',
      timezone: 'Asia/Beirut',
      status: 'BOOKED',
      alreadyBooked: false,
    })),
    joinWaitlist: vi.fn(),
    linkView: vi.fn(async () => ({ resultMeaning: 'The appointment is cancelled.' })),
  } as unknown as AssistantService;
}

const base = (over: Record<string, unknown> = {}) => ({
  requestId: 'req-12345678',
  logger: silent(),
  service: fakeService(),
  limiter: limiterOf(memStore()),
  ...over,
});

const text = (r: { content: { text: string }[] }) => r.content[0]!.text;

describe('arguments are validated strictly', () => {
  it('rejects an unknown field with an actionable isError result and does not call the service', async () => {
    const deps = base();
    const r = await callTool('get_business', { slug: 'studio-nour', admin: true }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Invalid input for get_business/);
    expect(text(r)).toMatch(/admin: Unknown field, remove it \(allowed: slug\)/);
    expect(deps.service.getBusiness).not.toHaveBeenCalled();
  });

  it('rejects missing and badly typed fields naming each field', async () => {
    const r = await callTool('create_booking', { name: 5, phone: '1', extra: 1 }, base());
    expect(r.isError).toBe(true);
    for (const f of ['confirmationToken', 'name', 'email', 'extra']) expect(text(r)).toContain(f);
  });

  it('rejects arguments that are not an object', async () => {
    for (const args of ['x', 5, [1], null]) {
      const r = await callTool('search_businesses', args, base());
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it('caps limit and days in the schema', async () => {
    expect((await callTool('search_businesses', { limit: 11 }, base())).isError).toBe(true);
    expect(
      (await callTool('get_free_times', { slug: 'a', serviceId: 'b', days: 8 }, base())).isError,
    ).toBe(true);
  });

  it('accepts a valid call and returns text plus structuredContent', async () => {
    const r = await callTool('search_businesses', { query: 'nour', limit: 3 }, base());
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ businesses: [] });
  });
});

describe('rate limits', () => {
  it('global bucket: the call after 600 per 10 minutes is a clear try-again result', async () => {
    const deps = base();
    for (let i = 0; i < RATE_POLICIES.mcpGlobal.limit; i++)
      expect((await callTool('search_businesses', {}, deps)).isError).toBeUndefined();
    const r = await callTool('search_businesses', {}, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Try again in \d+ minutes?/);
  });

  it('write bucket: 120 writes per 10 minutes, reads keep working', async () => {
    const deps = base();
    for (let i = 0; i < RATE_POLICIES.mcpWrite.limit; i++)
      expect((await callTool('cancel_booking', { token: 'x.y' }, deps)).isError).toBeUndefined();
    const r = await callTool('cancel_booking', { token: 'x.y' }, deps);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Try again in/);
    expect((await callTool('get_booking', { token: 'x.y' }, deps)).isError).toBeUndefined();
  });

  it('limiter store down: reads fail OPEN, writes fail CLOSED with an actionable message', async () => {
    const deps = base({ limiter: limiterOf(memStore(true)) });
    expect((await callTool('search_businesses', {}, deps)).isError).toBeUndefined();
    const w = await callTool('confirm_booking', { token: 'x.y' }, deps);
    expect(w.isError).toBe(true);
    expect(text(w)).toBe(LIMITER_DOWN_MESSAGE);
    expect(deps.service.linkView).not.toHaveBeenCalled();
  });

  it('spend(): open mode lets traffic through, closed mode refuses, limited throws RATE_LIMITED', async () => {
    const down = limiterOf(memStore(true));
    await expect(spend(down, 'mcpPhone', 'p', 'open')).resolves.toBeDefined();
    await expect(spend(down, 'mcpPhone', 'p', 'closed')).rejects.toMatchObject({ status: 503 });
    const ok = limiterOf(memStore());
    for (let i = 0; i < RATE_POLICIES.mcpPhone.limit; i++) await spend(ok, 'mcpPhone', 'p', 'closed');
    await expect(spend(ok, 'mcpPhone', 'p', 'closed')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // another phone has its own bucket
    await expect(spend(ok, 'mcpPhone', 'other', 'closed')).resolves.toBeDefined();
  });

  it('spend(): a refund gives the hit back', async () => {
    const ok = limiterOf(memStore());
    for (let i = 0; i < RATE_POLICIES.mcpBookBusiness.limit; i++) {
      const s = await spend(ok, 'mcpBookBusiness', 'b', 'closed');
      await s.refund();
    }
    await expect(spend(ok, 'mcpBookBusiness', 'b', 'closed')).resolves.toBeDefined();
  });

  it('the connector policies exist with the documented numbers and none is keyed by ip', () => {
    expect(RATE_POLICIES.mcpGlobal).toEqual({ windowSec: 600, limit: 600 });
    expect(RATE_POLICIES.mcpWrite).toEqual({ windowSec: 600, limit: 120 });
    expect(RATE_POLICIES.mcpPhone).toEqual({ windowSec: 3600, limit: 5 });
    expect(RATE_POLICIES.mcpBookBusiness).toEqual({ windowSec: 3600, limit: 60 });
    expect(RATE_POLICIES.mcpReadBusiness).toEqual({ windowSec: 600, limit: 300 });
  });

  it('the phone subject is a keyed hash, never the number', () => {
    const s = phoneSubject('x'.repeat(40), '+96171234567');
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toContain('96171234567');
  });
});

describe('errors are actionable, never generic', () => {
  const failing = (error: unknown) => {
    const service = fakeService();
    (service.getBusiness as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    return base({ service });
  };

  it('NOT_FOUND names what was not found', async () => {
    const r = await callTool('get_business', { slug: 'nope' }, failing(AppError.notFound('No listed business has that slug.')));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Not found. No listed business has that slug.');
  });

  it('SLOT_TAKEN carries the fresh times', async () => {
    const e = AppError.conflict('SLOT_TAKEN', { freeTimes: [{ localLabel: 'Wed 11 Nov, 11:00' }], timezone: 'Asia/Beirut' }, 'That time was just taken.');
    const r = await callTool('get_business', { slug: 'a' }, failing(e));
    expect(text(r)).toMatch(/SLOT_TAKEN/);
    expect(JSON.stringify(r.structuredContent)).toContain('Wed 11 Nov, 11:00');
  });

  it('an unexpected failure is a plain retry message, with no internals', async () => {
    const r = await callTool('get_business', { slug: 'a' }, failing(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2')));
    expect(r.isError).toBe(true);
    expect(text(r)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.1/);
    expect(text(r)).toMatch(/Try again in a minute/);
    expect(text(r)).not.toMatch(/Internal Server Error/i);
  });
});

describe('logging carries no personal data', () => {
  it('logs tool, outcome, duration and request id only', async () => {
    const info = vi.fn();
    const logger = { info, error: vi.fn(), warn: vi.fn() } as never;
    const args = {
      confirmationToken: 'SECRETTOKEN-abcdefghijklmnop.SIG',
      name: 'Rana Haddad',
      phone: '+96171234567',
      email: 'rana@example.test',
    };
    await callTool('create_booking', args, base({ logger }));
    expect(info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(info.mock.calls);
    for (const secret of ['SECRETTOKEN', 'Rana', 'Haddad', '96171234567', 'rana@example.test'])
      expect(logged, secret).not.toContain(secret);
    expect(info.mock.calls[0]![0]).toMatchObject({ tool: 'create_booking', outcome: 'ok', requestId: 'req-12345678' });
    expect(typeof info.mock.calls[0]![0].durationMs).toBe('number');
  });
});
