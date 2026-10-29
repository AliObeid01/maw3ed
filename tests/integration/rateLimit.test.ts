import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { createLoginGuard } from '@/server/services/loginGuard';
import { createRateLimiter } from '@/server/services/rateLimit';
import { RATE_POLICIES } from '@/server/services/rateLimitPolicies';
import { sha256Hex } from '@/server/services/crypto';
import { rateLimitRepo } from '@/server/repositories/rateLimit.repo';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
});

const T0 = new Date('2026-11-01T10:00:00.000Z');
const tryLogin = (email: string, password: string, ip?: string) =>
  call(login, '/api/auth/login', {
    body: { email, password },
    headers: ip ? { 'x-vercel-forwarded-for': ip } : undefined,
  });

describe('rateLimitRepo.hit (atomic fixed window)', () => {
  it('30 concurrent hits against limit 10: exactly 10 are allowed, counts are 1..30', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => rateLimitRepo.hit('k:concurrent', 600, 10, T0)),
    );
    expect(results.filter((r) => !r.limited)).toHaveLength(10);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    const rows = await pg.query(`SELECT count FROM "RateLimitBucket" WHERE key = 'k:concurrent'`);
    expect(rows.rows).toEqual([{ count: 30 }]);
  });

  it('retryAfterSec is the time left in the window; the next window starts fresh', async () => {
    for (let i = 0; i < 3; i++) await rateLimitRepo.hit('k:w', 600, 2, T0);
    const late = new Date(T0.getTime() + 100_000); // 10:01:40, window 10:00-10:10
    const limited = await rateLimitRepo.hit('k:w', 600, 2, late);
    expect(limited.limited).toBe(true);
    expect(limited.retryAfterSec).toBe(500);
    const next = await rateLimitRepo.hit('k:w', 600, 2, new Date(T0.getTime() + 600_000));
    expect(next).toMatchObject({ count: 1, limited: false });
  });
});

describe('rate limiter service', () => {
  it('two separate instances over the same database share one budget', async () => {
    const a = createRateLimiter({ now: () => T0 });
    const b = createRateLimiter({ now: () => T0 });
    const limit = RATE_POLICIES.slugCheck.limit;
    for (let i = 0; i < limit; i++) {
      const who = i % 2 ? a : b;
      expect((await who.consume('slugCheck', '9.9.9.9')).limited).toBe(false);
    }
    expect((await a.consume('slugCheck', '9.9.9.9')).limited).toBe(true);
    expect((await b.consume('slugCheck', '9.9.9.9')).limited).toBe(true);
    expect((await b.consume('slugCheck', '8.8.8.8')).limited).toBe(false);
  });

  it('fails open when the store throws', async () => {
    const down = () => Promise.reject(new Error('db down'));
    const broken = createRateLimiter({ store: { hit: down, refund: down, clear: down } });
    expect(await broken.consume('signup', '1.1.1.1')).toMatchObject({ limited: false });
    await expect(broken.clear('signup', '1.1.1.1')).resolves.toBeUndefined();
  });
});

describe('login guard', () => {
  it('locks after 5 attempts per email+ip, then rolls over with the injected clock', async () => {
    let now = T0;
    const guard = createLoginGuard(createRateLimiter({ now: () => now }));
    for (let i = 0; i < 5; i++) await guard.attempt('Victim@Example.test', '7.7.7.7');
    await expect(guard.attempt('victim@example.test', '7.7.7.7')).rejects.toMatchObject({
      status: 429,
      code: 'TOO_MANY_ATTEMPTS',
    });
    now = new Date(T0.getTime() + 15 * 60_000);
    await expect(guard.attempt('victim@example.test', '7.7.7.7')).resolves.toBeUndefined();
  });

  it('an attacker IP does not lock the victim out from another IP', async () => {
    const guard = createLoginGuard(createRateLimiter({ now: () => T0 }));
    for (let i = 0; i < 5; i++) await guard.attempt('victim@example.test', '6.6.6.6');
    await expect(guard.attempt('victim@example.test', '6.6.6.6')).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.attempt('victim@example.test', '5.5.5.5')).resolves.toBeUndefined();
  });

  it('per-IP budget: 20 attempts across many emails, then that IP is blocked for all', async () => {
    const guard = createLoginGuard(createRateLimiter({ now: () => T0 }));
    for (let i = 0; i < 20; i++) await guard.attempt(`user${i}@example.test`, '4.4.4.4');
    await expect(guard.attempt('fresh@example.test', '4.4.4.4')).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.attempt('fresh@example.test', '3.3.3.3')).resolves.toBeUndefined();
  });

  it('a success clears the email+ip bucket and refunds its ip and email hits (ticket)', async () => {
    const guard = createLoginGuard(createRateLimiter({ now: () => T0 }));
    for (let i = 0; i < 4; i++) await guard.attempt('a@example.test', '2.2.2.2');
    const ticket = await guard.attempt('a@example.test', '2.2.2.2');
    await guard.succeeded('a@example.test', '2.2.2.2', ticket);
    for (let i = 0; i < 5; i++) await guard.attempt('a@example.test', '2.2.2.2');
    const ip = await pg.query(`SELECT count FROM "RateLimitBucket" WHERE key = 'loginIp:2.2.2.2'`);
    expect(ip.rows[0].count).toBe(5 - 1 + 5);
    const em = await pg.query(`SELECT count FROM "RateLimitBucket" WHERE key = $1`, [
      `loginEmail:${sha256Hex('a@example.test')}`,
    ]);
    expect(em.rows[0].count).toBe(5 - 1 + 5);
  });

  it('a success only clears its own email+ip bucket', async () => {
    const guard = createLoginGuard(createRateLimiter({ now: () => T0 }));
    for (let i = 0; i < 5; i++) await guard.attempt('v@example.test', '1.2.3.4');
    for (let i = 0; i < 5; i++) await guard.attempt('v@example.test', '1.2.3.5');
    await guard.succeeded('v@example.test', '1.2.3.5');
    await expect(guard.attempt('v@example.test', '1.2.3.5')).resolves.toBeUndefined();
    await expect(guard.attempt('v@example.test', '1.2.3.4')).rejects.toMatchObject({ status: 429 });
  });

  it('never stores a raw email in a key', async () => {
    const guard = createLoginGuard(createRateLimiter({ now: () => T0 }));
    await guard.attempt('Secret.Person@Example.test', '1.1.1.1');
    const keys = (await pg.query(`SELECT key FROM "RateLimitBucket"`)).rows.map((r) => r.key);
    expect(keys.join(' ')).not.toMatch(/secret|example/i);
    expect(keys).toContain(`loginEmailIp:${sha256Hex('secret.person@example.test')}:1.1.1.1`);
  });
});

describe('refund window (N4) in Postgres', () => {
  it('a refund after the window rolled over decrements the ORIGINAL window only', async () => {
    const first = await rateLimitRepo.hit('k:r', 600, 10, T0);
    await rateLimitRepo.hit('k:r', 600, 10, T0);
    const second = await rateLimitRepo.hit('k:r', 600, 10, new Date(T0.getTime() + 600_000));
    await rateLimitRepo.refund('k:r', first.windowStart);
    const rows = await pg.query(
      `SELECT "windowStart", count FROM "RateLimitBucket" WHERE key = 'k:r' ORDER BY "windowStart"`,
    );
    expect(rows.rows.map((r) => r.count)).toEqual([1, 1]);
    expect(rows.rows[1].windowStart.getTime()).toBe(second.windowStart.getTime());
  });
});

describe('B1: IPv6 /64 and per-email ceiling through the login route', () => {
  it('rotating inside one /64 does not escape the per-IP budget; a different /64 is not blocked', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await tryLogin('victim@example.test', 'wrong-password-1', `2001:db8:aa:bb:${i}::1`))
          .status,
      ).toBe(401);
    const locked = await tryLogin(
      'victim@example.test',
      'wrong-password-1',
      `2001:db8:aa:bb:ffff::9`,
    );
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
    expect(
      (await tryLogin('victim@example.test', 'wrong-password-1', `2001:db8:aa:cc::1`)).status,
    ).toBe(401);
  });

  it('30 attempts from rotating IPs hit the per-email ceiling; the owner success still works and refunds', async () => {
    const { body } = await signup();
    for (let i = 0; i < 29; i++)
      expect((await tryLogin(body.email, 'wrong-password-1', `10.1.${i}.1`)).status).toBe(401);
    // Owner from their own address: attempt 30 is allowed and, on success, refunded.
    expect((await tryLogin(body.email, PASSWORD, '203.0.113.50')).status).toBe(200);
    expect((await tryLogin(body.email, PASSWORD, '203.0.113.50')).status).toBe(200);
    for (let i = 0; i < 2; i++) await tryLogin(body.email, 'wrong-password-1', `10.2.${i}.1`);
    const over = await tryLogin(body.email, PASSWORD, '203.0.113.51');
    expect(over.status).toBe(429);
    expect(over.body!.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('POST /api/auth/login with the shared limiter', () => {
  it('429 body and Retry-After; a different IP is not locked; per-IP budget across emails', async () => {
    const { body } = await signup();
    for (let i = 0; i < 5; i++)
      expect((await tryLogin(body.email, 'wrong-password-1', '10.0.0.1')).status).toBe(401);
    const locked = await tryLogin(body.email, PASSWORD, '10.0.0.1');
    expect(locked.status).toBe(429);
    expect(locked.body!.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(locked.body!.error.data.retryAfterSec).toBeGreaterThan(0);
    expect(Number(locked.headers.get('retry-after'))).toBe(locked.body!.error.data.retryAfterSec);

    expect((await tryLogin(body.email, PASSWORD, '10.0.0.2')).status).toBe(200);

    for (let i = 0; i < 20; i++)
      expect((await tryLogin(`n${i}@example.test`, 'wrong-password-1', '10.0.0.9')).status).toBe(
        401,
      );
    expect((await tryLogin('n99@example.test', 'wrong-password-1', '10.0.0.9')).status).toBe(429);
    expect((await tryLogin(body.email, PASSWORD, '10.0.0.9')).status).toBe(429);
  });
});
