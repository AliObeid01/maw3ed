/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tool results */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { normalizePhone } from '@/server/domain/phone';
import { createLogger } from '@/server/http/logger';
import { callTool } from '@/server/mcp/tools';
import { createAssistantService, defaultAssistantDeps } from '@/server/services/assistant';
import { phoneSubject } from '@/server/services/assistantLimits';
import { rateLimiter } from '@/server/services/rateLimit';
import { RATE_POLICIES, type RatePolicyName } from '@/server/services/rateLimitPolicies';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { at, newPhone, newScenario, newTenant, NOW, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { unique } from './helpers/api';

// PR-15a review fixes: every limit of the assistant connector, against the real Postgres limiter.

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let budgetUsed = 0;
const logger = createLogger({ level: 'silent' });
const secret = () => process.env.LINK_SECRET!;
let seq = 0;

/** Projected email load per UTC day (yyyy-MM-dd) for the guard tests; days not listed have no load. */
let dayLoad: Record<string, number> = {};
let loadFails = false;
const service = createAssistantService({
  ...defaultAssistantDeps,
  emailsSentToday: async () => budgetUsed,
  emailLoadOnDay: async (dayStart) => {
    if (loadFails) throw new Error('count failed');
    return dayLoad[dayStart.toISOString().slice(0, 10)] ?? 0;
  },
});

async function tool(name: string, args: Record<string, unknown>) {
  const r = await callTool(name, args, { requestId: `req-${++seq}-abcdefgh`, logger, service });
  return { isError: r.isError === true, text: r.content[0]!.text, data: (r.structuredContent ?? {}) as any };
}
const slot = (hhmm: string) => at(hhmm);
const who = (over: Record<string, unknown> = {}) => ({
  name: 'Rana Haddad',
  phone: newPhone(),
  email: `rana-${unique()}@example.test`,
  ...over,
});
const prep = async (hhmm: string) => {
  const p = await tool('prepare_booking', { slug: a.slug, serviceId: scn.serviceId, staffId: scn.staffIds[0], startAt: slot(hhmm) });
  expect(p.isError, p.text).toBe(false);
  return p.data.confirmationToken as string;
};
const book = async (hhmm: string, w = who(), token?: string) =>
  tool('create_booking', { confirmationToken: token ?? (await prep(hhmm)), ...w });
const waitArgs = (w = who()) => ({ slug: a.slug, serviceId: scn.serviceId, dateFrom: '2026-11-05', dateTo: '2026-11-07', ...w });

const emailSubject = (email: string) =>
  createHmac('sha256', secret()).update(`mcp-email:${email.trim().toLowerCase()}`).digest('hex');
const ALL: RatePolicyName[] = [
  'mcpRead', 'mcpInvalid', 'mcpReadBusiness', 'mcpBookHour', 'mcpBookDay', 'mcpWaitHour', 'mcpWaitDay',
  'mcpBookBusinessDay', 'mcpPhone', 'mcpPhoneDay', 'mcpEmail', 'mcpEmailWait', 'mcpLinkToken',
];
const fill = async (policy: RatePolicyName, subject: string, n = RATE_POLICIES[policy].limit) => {
  for (let i = 0; i < n; i++) await rateLimiter.consume(policy, subject);
};
const buckets = async () =>
  Number((await pg.query(`SELECT coalesce(sum(count),0) AS n FROM "RateLimitBucket"`)).rows[0].n);

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  scn = await newScenario(prisma, a, { staff: 2 });
  await pg.query(`UPDATE "Business" SET listed = true, category = 'barbers', area = 'beirut' WHERE id = $1`, [a.businessId]);
});
afterEach(async () => {
  budgetUsed = 0;
  dayLoad = {};
  loadFails = false;
  await pg.query(`DELETE FROM "RateLimitBucket"`);
  await pg.query(`DELETE FROM "ReminderJob"`);
  await pg.query(`DELETE FROM "Appointment"`);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});

describe('the numbers live in one table', () => {
  it('has the documented values (email arithmetic: 20 bookings a day x up to 3 emails = 60 of the 100/day Resend free tier)', () => {
    expect(RATE_POLICIES.mcpEmail).toEqual({ windowSec: 86400, limit: 2 });
    expect(RATE_POLICIES.mcpBookHour).toEqual({ windowSec: 3600, limit: 10 });
    expect(RATE_POLICIES.mcpBookDay).toEqual({ windowSec: 86400, limit: 20 });
    expect(RATE_POLICIES.mcpWaitHour).toEqual({ windowSec: 3600, limit: 20 });
    expect(RATE_POLICIES.mcpWaitDay).toEqual({ windowSec: 86400, limit: 40 });
    expect(RATE_POLICIES.mcpBookBusinessDay).toEqual({ windowSec: 86400, limit: 8 });
    expect(RATE_POLICIES.mcpPhone).toEqual({ windowSec: 3600, limit: 5 });
    expect(RATE_POLICIES.mcpPhoneDay).toEqual({ windowSec: 86400, limit: 3 });
    expect(RATE_POLICIES.mcpInvalid).toEqual({ windowSec: 600, limit: 300 });
    expect(RATE_POLICIES.mcpRead).toEqual({ windowSec: 600, limit: 600 });
    expect(RATE_POLICIES.mcpLinkToken).toEqual({ windowSec: 3600, limit: 20 });
    expect(ALL.every((p) => p in RATE_POLICIES)).toBe(true);
  });
});

describe('per email: 2 per day, refunded on failure', () => {
  it('the third booking for one email (different phones) is RATE_LIMITED; another email is fine', async () => {
    const email = `victim-${unique()}@example.test`;
    expect((await book('07:00', who({ email }))).isError).toBe(false);
    expect((await book('07:30', who({ email: email.toUpperCase() }))).isError).toBe(false);
    const third = await book('08:00', who({ email: `  ${email}  ` }));
    expect(third.isError).toBe(true);
    expect(third.data.code).toBe('RATE_LIMITED');
    expect((await book('08:00', who())).isError).toBe(false);
  });

  it('failures give the hit back: five SLOT_TAKEN attempts do not use up the email', async () => {
    const email = `victim-${unique()}@example.test`;
    const first = await book('09:00');
    expect(first.isError).toBe(false);
    const stale = await prep('09:30');
    // take the slot behind the token's back
    expect((await book('09:30', who(), stale)).isError).toBe(false);
    for (let i = 0; i < 5; i++) {
      const r = await book('09:30', who({ email }), stale);
      expect(r.data.code).toBe('SLOT_TAKEN');
    }
    expect((await book('10:00', who({ email }))).isError).toBe(false);
    expect((await book('10:30', who({ email }))).isError).toBe(false);
    expect((await book('11:00', who({ email }))).data.code).toBe('RATE_LIMITED');
  });

  it('a validation failure (bad phone) does not use up the email', async () => {
    const email = `victim-${unique()}@example.test`;
    for (let i = 0; i < 4; i++) {
      const r = await book('11:30', who({ email, phone: '12' }));
      expect(r.isError).toBe(true);
    }
    expect((await book('11:30', who({ email }))).isError).toBe(false);
  });

  it('an idempotent replay (same token and phone) does not count twice', async () => {
    const w = who();
    const token = await prep('12:00');
    expect((await book('12:00', w, token)).isError).toBe(false);
    for (let i = 0; i < 3; i++) {
      const r = await book('12:00', w, token);
      expect(r.isError, r.text).toBe(false);
      expect(r.data.alreadyBooked).toBe(true);
    }
    // the email was counted once: one more booking is still allowed, the next is not
    expect((await book('12:30', who({ email: w.email }))).isError).toBe(false);
    expect((await book('13:00', who({ email: w.email }))).data.code).toBe('RATE_LIMITED');
  });

  it('join_waitlist has its own per-email budget (3 a day), separate from bookings', async () => {
    const email = `wl-${unique()}@example.test`;
    for (let i = 0; i < RATE_POLICIES.mcpEmailWait.limit; i++)
      expect((await tool('join_waitlist', waitArgs(who({ email })))).isError).toBe(false);
    expect((await tool('join_waitlist', waitArgs(who({ email })))).data.code).toBe('RATE_LIMITED');
    expect((await book('13:00', who({ email }))).isError).toBe(false);
  });
});

describe('global, per business and per phone caps', () => {
  it('create_booking: 10 per hour and 20 per day across all callers', async () => {
    await fill('mcpBookHour', 'all');
    const hour = await book('07:00');
    expect(hour.data.code).toBe('RATE_LIMITED');
    expect(hour.text).toMatch(/Try again in \d+ minutes?/);
    await pg.query(`DELETE FROM "RateLimitBucket"`);
    await fill('mcpBookDay', 'all');
    expect((await book('07:00')).data.code).toBe('RATE_LIMITED');
  });

  it('join_waitlist: 20 per hour and 40 per day across all callers', async () => {
    await fill('mcpWaitHour', 'all');
    expect((await tool('join_waitlist', waitArgs())).data.code).toBe('RATE_LIMITED');
    await pg.query(`DELETE FROM "RateLimitBucket"`);
    await fill('mcpWaitDay', 'all');
    expect((await tool('join_waitlist', waitArgs())).data.code).toBe('RATE_LIMITED');
  });

  it('per business: 8 bookings a day', async () => {
    await fill('mcpBookBusinessDay', a.businessId);
    expect((await book('07:00')).data.code).toBe('RATE_LIMITED');
  });

  it('per phone: 5 an hour and 3 a day', async () => {
    const w = who();
    const subject = phoneSubject(secret(), normalizePhone(w.phone)!);
    await fill('mcpPhone', subject);
    expect((await book('07:00', w)).data.code).toBe('RATE_LIMITED');
    await pg.query(`DELETE FROM "RateLimitBucket"`);
    await fill('mcpPhoneDay', subject);
    expect((await book('07:00', w)).data.code).toBe('RATE_LIMITED');
  });

  it('one limited bucket gives back what the earlier buckets spent', async () => {
    const w = who();
    const token = await prep('07:00');
    await fill('mcpBookDay', 'all'); // the last bucket to be spent
    const before = await buckets();
    expect((await book('07:00', w, token)).data.code).toBe('RATE_LIMITED');
    expect(await buckets()).toBe(before);
    expect(
      Number((await pg.query(`SELECT count(*) FROM "RateLimitBucket" WHERE key = $1 AND count > 0`, [`mcpEmail:${emailSubject(w.email)}`])).rows[0].count),
    ).toBe(0);
  });
});

describe('email budget guard', () => {
  it('refuses create_booking and join_waitlist once today\'s sent emails reach 80, and writes nothing', async () => {
    const token = await prep('07:00');
    budgetUsed = 80;
    const before = await buckets();
    const b = await book('07:00', who(), token);
    expect(b.isError).toBe(true);
    expect(b.data.code).toBe('CHAT_BOOKING_UNAVAILABLE');
    expect(b.text).toMatch(/temporarily unavailable.*booking page/i);
    const w = await tool('join_waitlist', waitArgs());
    expect(w.data.code).toBe('CHAT_BOOKING_UNAVAILABLE');
    expect(await buckets()).toBe(before);
    expect(Number((await pg.query(`SELECT count(*) FROM "Appointment" WHERE "startAt" = $1`, [slot('07:00')])).rows[0].count)).toBe(0);
    budgetUsed = 79;
    expect((await book('07:00')).isError).toBe(false);
  });
});

describe('invalid calls cannot starve valid ones', () => {
  it('130 garbage confirm/cancel/create calls, then a valid booking still works', async () => {
    for (let i = 0; i < 130; i++) {
      const name = ['confirm_booking', 'cancel_booking', 'create_booking'][i % 3]!;
      const args = name === 'create_booking' ? { confirmationToken: 'x'.repeat(30), ...who() } : { token: `garbage.token${i}` };
      expect((await tool(name, args)).isError).toBe(true);
    }
    expect((await book('07:00')).isError).toBe(false);
    // none of it touched the write buckets
    const rows = (await pg.query(`SELECT key FROM "RateLimitBucket"`)).rows.map((r) => r.key as string);
    expect(rows.some((k) => k.startsWith('mcpBookHour') || k.startsWith('mcpBookDay'))).toBe(true); // the one valid booking
    expect((await pg.query(`SELECT count FROM "RateLimitBucket" WHERE key = 'mcpBookHour:all'`)).rows[0].count).toBe(1);
  });

  it('malformed arguments are counted only in the cheap invalid bucket', async () => {
    for (let i = 0; i < 5; i++) await tool('confirm_booking', { token: 5 as any });
    const rows = (await pg.query(`SELECT key, count FROM "RateLimitBucket"`)).rows;
    expect(rows.map((r) => r.key)).toEqual(['mcpInvalid:all']);
    expect(rows[0].count).toBe(5);
  });

  it('reads and writes have separate budgets', async () => {
    const token = await prep('07:00');
    await fill('mcpRead', 'all');
    expect((await tool('search_businesses', {})).data.code).toBe('RATE_LIMITED');
    expect((await book('07:00', who(), token)).isError).toBe(false);
    await pg.query(`DELETE FROM "RateLimitBucket"`);
    await fill('mcpBookHour', 'all');
    expect((await tool('search_businesses', {})).isError).toBe(false);
  });
});

describe('link tools are limited per token, not per connector', () => {
  it('21 calls with one valid link: the 21st is limited; another link and creating bookings are unaffected', async () => {
    const one = await book('07:00');
    const two = await book('07:30');
    const url = one.data.manageUrl as string;
    for (let i = 0; i < RATE_POLICIES.mcpLinkToken.limit; i++)
      expect((await tool('get_booking', { token: url })).isError, `call ${i + 1}`).toBe(false);
    const over = await tool('cancel_booking', { token: url });
    expect(over.data.code).toBe('RATE_LIMITED');
    expect((await tool('get_booking', { token: two.data.manageUrl })).isError).toBe(false);
    expect((await book('08:00')).isError).toBe(false);
  });

  it('a failed confirm (expired window) gives its hit back', async () => {
    const r = await book('07:00');
    const url = r.data.manageUrl as string;
    vi.setSystemTime(new Date('2026-11-04T08:00:00Z')); // after the appointment start: the link has expired
    try {
      for (let i = 0; i < 25; i++) expect((await tool('confirm_booking', { token: url })).isError).toBe(true);
    } finally {
      vi.setSystemTime(NOW);
    }
    expect((await tool('get_booking', { token: url })).isError).toBe(false);
  });
});

// A booking queues an H24 email due the day BEFORE the start and an H2 email due ON the start day (UTC days, as the
// sender's daily budget counts). Slot at 07:00Z on 4 Nov: H24 lands on 3 Nov, H2 on 4 Nov.
describe('projected email load guard (queued + sent per target day)', () => {
  it('refuses a booking whose H24 day already carries 69 emails (69 + 1 = 70), and says so', async () => {
    const token = await prep('07:00');
    dayLoad = { '2026-11-03': 69 };
    const r = await book('07:00', who(), token);
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe('CHAT_BOOKING_UNAVAILABLE');
    expect(r.text).toBe('Booking by chat is temporarily unavailable for that day. Please use the business booking page instead.');
    expect(Number((await pg.query(`SELECT count(*) FROM "Appointment" WHERE "startAt" = $1`, [slot('07:00')])).rows[0].count)).toBe(0);
  });

  it('refuses when the START day (H2) is the loaded one, allows 68, and a day with no load is unaffected', async () => {
    const token = await prep('07:00');
    dayLoad = { '2026-11-04': 69 };
    expect((await book('07:00', who(), token)).data.code).toBe('CHAT_BOOKING_UNAVAILABLE');
    dayLoad = { '2026-11-04': 68, '2026-11-03': 68 };
    expect((await book('07:00', who(), token)).isError).toBe(false);
    dayLoad = { '2026-11-03': 69, '2026-11-04': 69 };
    const other = await tool('prepare_booking', { slug: a.slug, serviceId: scn.serviceId, staffId: scn.staffIds[0], startAt: '2026-11-09T07:00:00.000Z' });
    expect(other.isError, other.text).toBe(false);
    expect((await tool('create_booking', { confirmationToken: other.data.confirmationToken, ...who() })).isError).toBe(false);
  });

  it('a refused booking spends no limit bucket, and a failing count fails CLOSED', async () => {
    const token = await prep('07:00');
    dayLoad = { '2026-11-03': 70 };
    const before = await buckets();
    expect((await book('07:00', who(), token)).data.code).toBe('CHAT_BOOKING_UNAVAILABLE');
    expect(await buckets()).toBe(before);
    dayLoad = {};
    loadFails = true;
    const r = await book('07:00', who(), token);
    expect(r.isError).toBe(true);
    expect(Number((await pg.query(`SELECT count(*) FROM "Appointment" WHERE "startAt" = $1`, [slot('07:00')])).rows[0].count)).toBe(0);
  });

  it('the repository counts queued (PENDING/SENDING) email jobs due that UTC day plus emails SENT that day, and nothing else', async () => {
    const { reminderJobRepo } = await import('@/server/repositories/reminderJob.repo');
    const mk = async (hhmm: string) => {
      const r = await book(hhmm);
      expect(r.isError, r.text).toBe(false);
      return (await pg.query(`SELECT id FROM "Appointment" WHERE reference = $1`, [r.data.reference])).rows[0].id as string;
    };
    const id1 = await mk('07:00');
    const id2 = await mk('07:30');
    await pg.query(`DELETE FROM "ReminderJob"`);
    const ins = (id: string, kind: string, channel: string, status: string, due: string, sent: string | null) =>
      pg.query(
        `INSERT INTO "ReminderJob" (id, "businessId", "appointmentId", kind, channel, "dueAt", status, "sentAt") VALUES ($1,$2,$3,$4::"ReminderKind",$5::"ReminderChannel",$6,$7::"ReminderStatus",$8)`,
        [`rj${++seq}${unique()}`, a.businessId, id, kind, channel, due, status, sent],
      );
    const D = '2026-11-03T';
    await ins(id1, 'H24', 'EMAIL', 'PENDING', `${D}07:00:00Z`, null); // counts (queued on the day)
    await ins(id1, 'H2', 'EMAIL', 'SENDING', `${D}23:59:00Z`, null); // counts (queued on the day)
    await ins(id2, 'H24', 'EMAIL', 'SENT', `${D}01:00:00Z`, `${D}01:05:00Z`); // counts (sent on the day)
    await ins(id2, 'H2', 'EMAIL', 'PENDING', '2026-11-04T00:00:00Z', null); // next day: no
    await ins(id1, 'BOOKING', 'EMAIL', 'FAILED', `${D}08:00:00Z`, null); // failed: no
    await ins(id2, 'BOOKING', 'EMAIL', 'SKIPPED', `${D}08:00:00Z`, null); // skipped: no
    await ins(id1, 'LATE', 'WHATSAPP', 'PENDING', `${D}08:00:00Z`, null); // other channel: no
    expect(await reminderJobRepo.emailLoadForUtcDay(new Date('2026-11-03T00:00:00Z'), new Date('2026-11-04T00:00:00Z'))).toBe(3);
    expect(await reminderJobRepo.emailLoadForUtcDay(new Date('2026-11-04T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(1);
    expect(await reminderJobRepo.emailLoadForUtcDay(new Date('2026-11-06T00:00:00Z'), new Date('2026-11-07T00:00:00Z'))).toBe(0);
  });
});
