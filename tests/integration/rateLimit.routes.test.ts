import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as slugCheck } from '@/app/api/auth/slug-check/route';
import { POST as signupRoute } from '@/app/api/auth/signup/route';
import { GET as inviteGet } from '@/app/api/invites/[token]/route';
import { POST as inviteAccept } from '@/app/api/invites/[token]/accept/route';
import { GET as linkGet, POST as linkPost } from '@/app/api/links/[token]/route';
import { GET as offerGet } from '@/app/api/offers/[token]/route';
import { POST as offerClaim } from '@/app/api/offers/[token]/claim/route';
import { GET as directory } from '@/app/api/public/directory/route';
import { GET as publicPage } from '@/app/api/public/[slug]/route';
import { POST as bookings } from '@/app/api/public/[slug]/bookings/route';
import { GET as slots } from '@/app/api/public/[slug]/slots/route';
import { POST as waitlistJoin } from '@/app/api/public/[slug]/waitlist/route';
import { rateLimitRepo } from '@/server/repositories/rateLimit.repo';
import { RATE_POLICIES, type RatePolicyName } from '@/server/services/rateLimitPolicies';
import { call, type CallOptions } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let savedFlag: string | undefined;
beforeAll(async () => {
  savedFlag = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED; // route-level limits ON for this file
  // Fixed windows: pin the clock mid-window so a burst can never straddle a window boundary.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T10:05:00.000Z') });
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  vi.useRealTimers();
  if (savedFlag === undefined) delete process.env.RATE_LIMIT_DISABLED;
  else process.env.RATE_LIMIT_DISABLED = savedFlag;
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
});

type Handler = Parameters<typeof call>[0];
interface Case {
  policy: RatePolicyName;
  handler: Handler;
  path: string;
  opts?: CallOptions;
}

// Deliberately invalid requests: every route limits BEFORE parsing/DB work, so they still count.
const CASES: Case[] = [
  {
    policy: 'bookingCreate',
    handler: bookings,
    path: '/api/public/some-slug/bookings',
    opts: { method: 'POST', params: { slug: 'some-slug' }, body: {} },
  },
  {
    policy: 'waitlistJoin',
    handler: waitlistJoin,
    path: '/api/public/some-slug/waitlist',
    opts: { method: 'POST', params: { slug: 'some-slug' }, body: {} },
  },
  { policy: 'signup', handler: signupRoute, path: '/api/auth/signup', opts: { body: {} } },
  { policy: 'slugCheck', handler: slugCheck, path: '/api/auth/slug-check' },
  {
    policy: 'slots',
    handler: slots,
    path: '/api/public/some-slug/slots',
    opts: { params: { slug: 'some-slug' } },
  },
  {
    policy: 'publicPage',
    handler: publicPage,
    path: '/api/public/no-such-business',
    opts: { params: { slug: 'no-such-business' } },
  },
  { policy: 'directory', handler: directory, path: '/api/public/directory' },
  {
    policy: 'linkRead',
    handler: linkGet,
    path: '/api/links/nope',
    opts: { params: { token: 'nope' } },
  },
  {
    policy: 'linkRead',
    handler: offerGet,
    path: '/api/offers/nope',
    opts: { params: { token: 'nope' } },
  },
  {
    policy: 'linkAct',
    handler: linkPost,
    path: '/api/links/nope',
    opts: { method: 'POST', params: { token: 'nope' }, body: {} },
  },
  {
    policy: 'linkAct',
    handler: offerClaim,
    path: '/api/offers/nope/claim',
    opts: { method: 'POST', params: { token: 'nope' }, body: {} },
  },
  {
    policy: 'invitePreview',
    handler: inviteGet,
    path: '/api/invites/nope',
    opts: { params: { token: 'nope' } },
  },
  {
    policy: 'inviteAccept',
    handler: inviteAccept,
    path: '/api/invites/nope/accept',
    opts: { method: 'POST', params: { token: 'nope' }, body: {} },
  },
];

const withIp = (c: Case, ip: string): CallOptions => ({
  ...c.opts,
  headers: { ...c.opts?.headers, 'x-vercel-forwarded-for': ip },
});

/** Fire `n` requests in chunks of 10 (the app pool is small; a starved limiter fails open by design). */
async function burst(c: Case, ip: string, n: number) {
  let limited = 0;
  for (let sent = 0; sent < n; sent += 10) {
    const out = await Promise.all(
      Array.from({ length: Math.min(10, n - sent) }, () => call(c.handler, c.path, withIp(c, ip))),
    );
    limited += out.filter((r) => r.status === 429).length;
  }
  return limited;
}

describe('per-IP route limits (L6)', () => {
  for (const c of CASES) {
    const { limit } = RATE_POLICIES[c.policy];
    it(`${c.policy} ${c.path}: request ${limit + 1} from one IP is 429 with Retry-After, other IPs are fine`, async () => {
      expect(await burst(c, '203.0.113.7', limit)).toBe(0);
      // Even a body that would be rejected with 415/400 gets the 429 first: no parsing happens.
      const limited = await call(c.handler, c.path, {
        ...withIp(c, '203.0.113.7'),
        body: undefined,
        headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'content-type': 'text/plain' },
      });
      expect(limited.status).toBe(429);
      expect(limited.body!.error.code).toBe('RATE_LIMITED');
      expect(limited.body!.error.fields).toEqual({});
      expect(limited.body!.error.data.retryAfterSec).toBeGreaterThan(0);
      expect(limited.body!.error.data.retryAfterSec).toBeLessThanOrEqual(
        RATE_POLICIES[c.policy].windowSec,
      );
      expect(limited.headers.get('retry-after')).toBe(
        String(limited.body!.error.data.retryAfterSec),
      );
      expect(limited.headers.get('x-request-id')).toBeTruthy();

      const other = await call(c.handler, c.path, withIp(c, '203.0.113.8'));
      expect(other.status).not.toBe(429);
    }, 120_000);
  }

  it('GET links and GET offers share one read budget; claim and link POST share one act budget', async () => {
    const read = RATE_POLICIES.linkRead.limit;
    const links = CASES.find((c) => c.handler === linkGet)!;
    const offers = CASES.find((c) => c.handler === offerGet)!;
    expect(await burst(links, '198.51.100.1', read)).toBe(0);
    expect((await call(offers.handler, offers.path, withIp(offers, '198.51.100.1'))).status).toBe(
      429,
    );
  });

  it('fails open: when the limiter store errors the request is still served', async () => {
    const spy = vi.spyOn(rateLimitRepo, 'hit').mockRejectedValue(new Error('store down'));
    try {
      const res = await call(slugCheck, '/api/auth/slug-check', { query: { slug: 'free-name-1' } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ available: true });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('without any client address header, requests share the "unknown" bucket', async () => {
    const c = CASES.find((x) => x.policy === 'slugCheck')!;
    const limit = RATE_POLICIES.slugCheck.limit;
    const run = () => call(c.handler, c.path, { query: { slug: 'abc-def' } });
    let limited = 0;
    for (let sent = 0; sent <= limit; sent += 10) {
      const n = Math.min(10, limit + 1 - sent);
      limited += (await Promise.all(Array.from({ length: n }, run))).filter(
        (r) => r.status === 429,
      ).length;
    }
    expect(limited).toBe(1);
  });
});
