/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies from the real API */
import { expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { JOURNEY_APP_URL, JOURNEY_URL, OUTBOX_FILE } from './journeyEnv';

/**
 * Helpers for the real-stack waitlist journey (tests/e2e/waitlistJourney.spec.ts): plain HTTP to the real
 * server, the email outbox the server's Resend stub writes, and direct SQL for assertions. No page.route anywhere.
 */

export const PASSWORD = 'correct-horse-battery';

// ---- HTTP ---------------------------------------------------------------------------------------------

export interface ApiResult {
  status: number;
  body: any;
  cookie: string | undefined;
}

export async function api(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${JOURNEY_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  const match = res.headers.get('set-cookie')?.match(/((?:__Host-)?maw3ed_session)=([^;]*)/);
  return { status: res.status, body, cookie: match?.[2] ? `${match[1]}=${match[2]}` : undefined };
}

/** The cron routes, called exactly as Vercel Cron does (x-cron-secret). */
export const cron = (job: 'reminders' | 'waitlist-expiry') =>
  api(`/api/jobs/${job}`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  });

// ---- Seeding through the real API ------------------------------------------------------------------------

let counter = 0;
export const uniqueTag = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface Business {
  slug: string;
  name: string;
  timezone: string;
  ownerEmail: string;
  cookie: string;
  staffId: string;
  staffName: string;
  services: Record<string, { id: string; name: string }>;
}

/** Sign up a business, then add services, one bookable staff member who offers them all, and weekly hours. */
export async function createBusiness(opts: {
  name: string;
  timezone: string;
  services: string[];
}): Promise<Business> {
  const tag = uniqueTag();
  const ownerEmail = `owner-${tag}@example.test`;
  const slug = `f26-${tag}`;
  const signup = await api('/api/auth/signup', {
    body: {
      businessName: opts.name,
      slug,
      timezone: opts.timezone,
      ownerName: 'Lina Owner',
      email: ownerEmail,
      password: PASSWORD,
    },
  });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  const cookie = signup.cookie!;
  const services: Business['services'] = {};
  for (const name of opts.services) {
    const r = await api('/api/services', {
      cookie,
      body: { name, durationMin: 30, bufferMin: 0, price: 15 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    services[name] = { id: r.body.id, name };
  }
  // Signup already made the owner a bookable staff member (the FREE plan allows exactly one): use that person.
  const list = await api('/api/staff', { cookie });
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const staff = { body: list.body.staff.find((m: any) => m.bookable) };
  expect(staff.body, JSON.stringify(list.body)).toBeTruthy();
  const staffName: string = staff.body.displayName;
  const assigned = await api(`/api/staff/${staff.body.id}/services`, {
    method: 'PUT',
    cookie,
    body: { serviceIds: Object.values(services).map((x) => x.id) },
  });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
  const hours = await api(`/api/staff/${staff.body.id}/hours`, {
    method: 'PUT',
    cookie,
    body: {
      intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startLocal: '09:00',
        endLocal: '17:00',
      })),
    },
  });
  expect(hours.status, JSON.stringify(hours.body)).toBe(200);
  return {
    slug,
    name: opts.name,
    timezone: opts.timezone,
    ownerEmail,
    cookie,
    staffId: staff.body.id,
    staffName,
    services,
  };
}

/** A valid Lebanese mobile number, unique per call, as typed into the form (the +961 code is the form default). */
export function newPhone() {
  const n = String(Math.floor(Math.random() * 900_000) + 100_000);
  return { typed: `71 ${n.slice(0, 3)} ${n.slice(3)}`, e164: `+96171${n}` };
}

// ---- Email outbox --------------------------------------------------------------------------------------

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  /** True when the provider saw this idempotency key before (a real provider would not deliver it again). */
  duplicate: boolean;
  providerMessageId: string;
}

export function resetOutbox() {
  writeFileSync(OUTBOX_FILE, '');
}

export function outbox(): Mail[] {
  if (!existsSync(OUTBOX_FILE)) return [];
  return readFileSync(OUTBOX_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Mail);
}

/** Delivered (non-duplicate) mails to one address. */
export const mailsTo = (address: string) =>
  outbox().filter((m) => m.to.toLowerCase() === address.toLowerCase() && !m.duplicate);

export const offerMailsTo = (address: string) =>
  mailsTo(address).filter((m) => m.idempotencyKey.startsWith('waitlist-offer-'));

export async function waitForMail(
  label: string,
  find: () => Mail | undefined,
  timeout = 15_000,
): Promise<Mail> {
  await expect.poll(() => Boolean(find()), { message: `email: ${label}`, timeout }).toBe(true);
  return find()!;
}

const decode = (token: string) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
      a?: string;
      o?: string;
      act?: string;
      exp?: number;
    };
  } catch {
    return {};
  }
};

/** Every link in the email text that points at this app, as { path, token payload }. */
export function linksIn(mail: Mail) {
  const origin = JOURNEY_APP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...mail.text.matchAll(new RegExp(`${origin}(/[^\\s]+)`, 'g'))].map((m) => {
    const path = m[1]!;
    const token = /^\/(?:l|o)\/([A-Za-z0-9_.-]+)/.exec(path)?.[1] ?? '';
    return { path, token, payload: decode(token) };
  });
}

/** The path (on the journey server) of the one link with this action; throws when it is missing. */
export function linkFor(mail: Mail, act: 'confirm' | 'cancel' | 'claim' | 'leave'): string {
  const hit = linksIn(mail).find((l) => l.payload.act === act);
  if (!hit)
    throw new Error(`no ${act} link in "${mail.subject}": ${linksIn(mail).map((l) => l.path)}`);
  return hit.path;
}

// ---- SQL -----------------------------------------------------------------------------------------------

export async function withDb<T>(
  fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>,
) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.end();
  }
}

export const sql = (text: string, params: unknown[] = []) => withDb((q) => q(text, params));
