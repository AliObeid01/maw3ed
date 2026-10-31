/* eslint-disable @typescript-eslint/no-explicit-any -- test helper: response bodies are untyped JSON */
type Json = Record<string, any>;
import { POST as signupPost } from '@/app/api/auth/signup/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { newClient } from './db';

type Handler = (
  req: Request,
  args?: { params?: Promise<Record<string, string>> },
) => Promise<Response>;

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export async function call(handler: Handler, path: string, opts: CallOptions = {}) {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined && !headers['content-type'])
    headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(
    req,
    opts.params ? { params: Promise.resolve(opts.params) } : undefined,
  );
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Json) : undefined,
    /** `maw3ed_session=<token>` from Set-Cookie, ready to send back; '' when the cookie was cleared. */
    cookie: sessionCookieFrom(res),
    setCookie: res.headers.get('set-cookie') ?? undefined,
  };
}

export function sessionCookieFrom(res: Response): string | undefined {
  const header = res.headers.get('set-cookie');
  const match = header?.match(/maw3ed_session=([^;]*)/);
  if (!match) return undefined;
  return match[1] ? `maw3ed_session=${match[1]}` : '';
}

let counter = 0;
export const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export const PASSWORD = 'correct-horse-battery';

export function signupBody(over: Record<string, unknown> = {}) {
  const u = unique();
  return {
    businessName: `Biz ${u}`,
    slug: `biz-${u}`,
    timezone: 'Asia/Beirut',
    ownerName: 'Owner',
    email: `owner-${u}@example.test`,
    password: PASSWORD,
    ...over,
  };
}

/**
 * Sign up a fresh business through the real route (owner verified unless `verified: false`). New businesses are FREE (one bookable staff member), so
 * the helper upgrades them to PRO unless `plan: 'FREE'` is passed; tests that create several bookable staff
 * then exercise their own logic, and plan-limit tests ask for FREE explicitly.
 */
export async function signup(over: Record<string, unknown> = {}) {
  const { plan = 'PRO', verified = true, ...rest } = over;
  const body = signupBody(rest);
  const res = await call(signupPost, '/api/auth/signup', { body });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (plan === 'PRO' || verified) {
    const pg = newClient();
    await pg.connect();
    try {
      if (plan === 'PRO')
        await pg.query(`UPDATE "Business" SET plan = 'PRO' WHERE slug = $1`, [body.slug]);
      // Soft email verification gates inviting and listing; most tests are about something else.
      if (verified)
        await pg.query(`UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1`, [body.email]);
    } finally {
      await pg.end();
    }
  }
  // Tests that ask for a verified owner are about something else: take only THIS signup's verification mail
  // out of the fake outbox (other mails, e.g. earlier ones in the same test, stay countable).
  if (verified) {
    const calls = fakeEmailProvider.calls;
    for (let i = calls.length - 1; i >= 0; i--)
      if (calls[i]!.to === body.email && calls[i]!.text.includes('/verify-email/')) calls.splice(i, 1);
  }
  return { body, res, cookie: res.cookie as string, info: res.body as Json };
}
