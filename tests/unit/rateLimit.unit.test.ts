import { describe, expect, it, vi } from 'vitest';
import { AppError, mapError } from '@/server/http/errors';
import type { HitResult } from '@/server/repositories/rateLimit.repo';
import { sha256Hex } from '@/server/services/crypto';
import { createLoginGuard, emailHash, emailIpSubject } from '@/server/services/loginGuard';
import {
  FAIL_OPEN_EVENT,
  createRateLimiter,
  rateKey,
  type RateLimitStore,
} from '@/server/services/rateLimit';
import { RATE_POLICIES } from '@/server/services/rateLimitPolicies';
import {
  ARGON2_CONCURRENCY,
  configurePasswordForTests,
  hashPassword,
  verifyPassword,
  type Hasher,
} from '@/server/services/password';
import { createSemaphore } from '@/server/services/semaphore';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) as never;

/** In-memory store with the same semantics as the Postgres one. */
function memStore() {
  const rows = new Map<string, number>();
  const hits: { key: string; amount: number }[] = [];
  const store: RateLimitStore = {
    async hit(key, windowSec, limit, now, amount = 1): Promise<HitResult> {
      const ms = windowSec * 1000;
      const start = new Date(Math.floor(now.getTime() / ms) * ms);
      const id = `${key}|${start.toISOString()}`;
      const count = (rows.get(id) ?? 0) + amount;
      rows.set(id, count);
      hits.push({ key, amount });
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
    async clear(key) {
      for (const id of rows.keys()) if (id.startsWith(`${key}|`)) rows.delete(id);
    },
  };
  return { store, rows, hits };
}

describe('key format', () => {
  it('rateKey is policy:subject and the login subjects never contain the raw email', () => {
    expect(rateKey('slots', '1.2.3.4')).toBe('slots:1.2.3.4');
    const h = sha256Hex('victim@example.test');
    expect(emailHash('  Victim@Example.TEST ')).toBe(h);
    expect(emailIpSubject('Victim@Example.test', '1.2.3.4')).toBe(`${h}:1.2.3.4`);
    expect(rateKey('loginEmailIp', emailIpSubject('v@example.test', '9.9.9.9'))).not.toContain(
      'example',
    );
  });
});

describe('soft policies (N5): memory first, Postgres only past 50% of the limit', () => {
  const limit = RATE_POLICIES.slots.limit;

  it('normal visitors cause no writes; crossing 50% catches Postgres up; limit+1 is 429', async () => {
    const { store, hits } = memStore();
    const l = createRateLimiter({ now: () => T0, store });
    const half = Math.ceil(limit * 0.5);
    for (let i = 1; i < half; i++) expect((await l.consume('slots', 'ip')).limited).toBe(false);
    expect(hits).toHaveLength(0);
    await l.consume('slots', 'ip'); // reaches 50%: one catch-up write of `half`
    expect(hits).toEqual([{ key: 'slots:ip', amount: half }]);
    for (let i = half + 1; i <= limit; i++)
      expect((await l.consume('slots', 'ip')).limited).toBe(false);
    const over = await l.consume('slots', 'ip');
    expect(over.limited).toBe(true);
    expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it('once limited, a flood costs no more writes until the window ends', async () => {
    const { store, hits } = memStore();
    let now = T0;
    const l = createRateLimiter({ now: () => now, store });
    for (let i = 0; i <= limit; i++) await l.consume('slots', 'ip');
    const writes = hits.length;
    for (let i = 0; i < 50; i++) expect((await l.consume('slots', 'ip')).limited).toBe(true);
    expect(hits).toHaveLength(writes);
    now = new Date(T0.getTime() + 10 * 60_000); // next window
    expect((await l.consume('slots', 'ip')).limited).toBe(false);
  });

  it('concurrent requests never re-send the same backlog: exactly `limit` are allowed', async () => {
    const { store, hits } = memStore();
    const l = createRateLimiter({ now: () => T0, store });
    const results = await Promise.all(
      Array.from({ length: limit + 40 }, () => l.consume('slots', 'ip')),
    );
    expect(results.filter((r) => !r.limited)).toHaveLength(limit);
    expect(hits.reduce((n, h) => n + h.amount, 0)).toBeLessThanOrEqual(limit + 40);
  });

  it('mutating policies always write', async () => {
    const { store, hits } = memStore();
    const l = createRateLimiter({ now: () => T0, store });
    await l.consume('bookingCreate', 'ip');
    await l.consume('signup', 'ip');
    expect(hits).toHaveLength(2);
  });
});

describe('store failures (N2)', () => {
  const throwing: RateLimitStore = {
    hit: () => Promise.reject(new Error('db down')),
    refund: () => Promise.reject(new Error('db down')),
    clear: () => Promise.reject(new Error('db down')),
  };
  const hanging: RateLimitStore = {
    hit: () => new Promise(() => undefined),
    refund: () => new Promise(() => undefined),
    clear: () => new Promise(() => undefined),
  };

  for (const [name, store] of [
    ['throwing', throwing],
    ['hanging', hanging],
  ] as const) {
    it(`route limits fail open with a ${name} store, log the alert event and count it`, async () => {
      const log = logger();
      const l = createRateLimiter({ store, logger: log, timeoutMs: 20 });
      const started = Date.now();
      expect(await l.consume('signup', '1.1.1.1')).toMatchObject({ limited: false });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(l.failOpenCount()).toBe(1);
      expect(
        (log as unknown as { error: ReturnType<typeof vi.fn> }).error.mock.calls[0]![0],
      ).toMatchObject({
        event: FAIL_OPEN_EVENT,
        policy: 'signup',
      });
    });

    it(`the login guard falls back to per-instance memory counters with a ${name} store`, async () => {
      const l = createRateLimiter({ store, logger: logger(), timeoutMs: 20, now: () => T0 });
      const guard = createLoginGuard(l);
      for (let i = 0; i < 5; i++) await guard.attempt('a@example.test', '1.1.1.1');
      await expect(guard.attempt('a@example.test', '1.1.1.1')).rejects.toMatchObject({
        status: 429,
        code: 'TOO_MANY_ATTEMPTS',
      });
      await expect(guard.attempt('a@example.test', '2.2.2.2')).resolves.toBeDefined();
    });
  }
});

describe('login guard (unit, in-memory store)', () => {
  const setup = () => {
    const m = memStore();
    return { ...m, guard: createLoginGuard(createRateLimiter({ now: () => T0, store: m.store })) };
  };

  it('N10: a locked pair is rejected without spending the shared per-IP budget', async () => {
    const { guard, rows } = setup();
    for (let i = 0; i < 5; i++) await guard.attempt('locked@example.test', '7.7.7.7');
    const ipKey = [...rows.keys()].find((k) => k.startsWith('loginIp:7.7.7.7'))!;
    const before = rows.get(ipKey);
    for (let i = 0; i < 50; i++)
      await expect(guard.attempt('locked@example.test', '7.7.7.7')).rejects.toMatchObject({
        status: 429,
      });
    expect(rows.get(ipKey)).toBe(before);
    // Another account on the same NAT still has its budget.
    await expect(guard.attempt('other@example.test', '7.7.7.7')).resolves.toBeDefined();
  });

  it('B1b: 30 attempts per email from rotating IPs, then the 31st is 429 from any IP', async () => {
    const { guard } = setup();
    for (let i = 0; i < 30; i++) await guard.attempt('v@example.test', `10.0.${i}.1`);
    await expect(guard.attempt('v@example.test', '10.9.9.9')).rejects.toMatchObject({
      status: 429,
      code: 'TOO_MANY_ATTEMPTS',
      data: { retryAfterSec: expect.any(Number) },
    });
  });

  it('B1b: a successful login refunds the email bucket, so the owner keeps working', async () => {
    const { guard } = setup();
    for (let i = 0; i < 29; i++) await guard.attempt('v@example.test', `10.0.${i}.1`);
    for (let i = 0; i < 5; i++) {
      const ticket = await guard.attempt('v@example.test', '203.0.113.5'); // owner, count 30 then refunded
      await guard.succeeded('v@example.test', '203.0.113.5', ticket);
    }
  });

  it('unknown address: per-IP budget is skipped, email-keyed limits still apply', async () => {
    const { guard, rows } = setup();
    for (let i = 0; i < 25; i++) await guard.attempt(`u${i}@example.test`, 'unknown');
    expect([...rows.keys()].some((k) => k.startsWith('loginIp:'))).toBe(false);
    for (let i = 0; i < 5; i++) await guard.attempt('same@example.test', 'unknown');
    await expect(guard.attempt('same@example.test', 'unknown')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('N4: a refund after the window rolled over decrements the ORIGINAL window only', async () => {
    const m = memStore();
    let now = T0;
    const l = createRateLimiter({ now: () => now, store: m.store });
    const first = await l.consume('loginIp', '5.5.5.5');
    await l.consume('loginIp', '5.5.5.5');
    now = new Date(T0.getTime() + 15 * 60_000); // next window
    const second = await l.consume('loginIp', '5.5.5.5');
    await l.refund('loginIp', '5.5.5.5', first.windowStart);
    const byWindow = Object.fromEntries([...m.rows].map(([k, v]) => [k.split('|')[1], v]));
    expect(byWindow[first.windowStart!.toISOString()]).toBe(1);
    expect(byWindow[second.windowStart!.toISOString()]).toBe(1);
  });
});

describe('argon2 gate (N1)', () => {
  const slowHasher = (ms: number) => {
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
    };
    const hasher: Hasher = {
      hash: async () => (await work(), 'hash'),
      verify: async () => (await work(), false),
    };
    return { hasher, peak: () => peak };
  };

  it('never runs more than 3 hashes at once, dummy-hash path included, and all callers finish', async () => {
    const s = slowHasher(20);
    configurePasswordForTests({ hasher: s.hasher });
    try {
      await Promise.all([
        ...Array.from({ length: 6 }, () => hashPassword('x')),
        ...Array.from({ length: 6 }, () => verifyPassword('x', 'real-hash')),
        ...Array.from({ length: 6 }, () => verifyPassword('x', null)),
      ]);
      expect(s.peak()).toBeLessThanOrEqual(ARGON2_CONCURRENCY);
      expect(s.peak()).toBe(ARGON2_CONCURRENCY);
    } finally {
      configurePasswordForTests();
    }
  });

  it('waiting longer than the budget is 503 SERVICE_BUSY with Retry-After 2', async () => {
    const s = slowHasher(200);
    configurePasswordForTests({ hasher: s.hasher, gate: createSemaphore(1, 30) });
    try {
      const busy = hashPassword('a');
      const rejected = await hashPassword('b').then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(rejected).toBeInstanceOf(AppError);
      const mapped = mapError(rejected);
      expect(mapped.status).toBe(503);
      expect(mapped.body.error.code).toBe('SERVICE_BUSY');
      expect(mapped.headers).toEqual({ 'Retry-After': '2' });
      await busy; // the running one still completes and frees the slot
      await expect(hashPassword('c')).resolves.toBe('hash');
    } finally {
      configurePasswordForTests();
    }
  });
});
