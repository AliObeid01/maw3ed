import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenAction = 'view' | 'confirm' | 'cancel' | 'claim' | 'pay';

const ACTIONS: readonly string[] = ['view', 'confirm', 'cancel', 'claim', 'pay'];

/** Exactly one of `a` (appointment id) or `o` (waitlist offer id) is set. `exp` is epoch seconds. */
export type TokenPayload =
  | { a: string; o?: undefined; act: TokenAction; exp: number }
  | { o: string; a?: undefined; act: TokenAction; exp: number };

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_action' };

const b64url = (buf: Buffer): string => buf.toString('base64url');

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error('Link token secret must be at least 32 characters');
}

/** Offers are claimed with an offer id; every other action refers to an appointment. */
function subjectMatchesAction(payload: { a?: string; o?: string }, act: TokenAction): boolean {
  return act === 'claim' ? payload.o !== undefined : payload.a !== undefined;
}

export function signToken(payload: TokenPayload, secret: string): string {
  assertSecret(secret);
  if (!subjectMatchesAction(payload, payload.act))
    throw new Error('Token subject does not match its action');
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${b64url(mac(body, secret))}`;
}

function parsePayload(body: string): TokenPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const hasA = typeof r.a === 'string' && r.a.length > 0;
  const hasO = typeof r.o === 'string' && r.o.length > 0;
  if (hasA === hasO) return null;
  if (typeof r.act !== 'string' || !ACTIONS.includes(r.act)) return null;
  if (typeof r.exp !== 'number' || !Number.isFinite(r.exp)) return null;
  const act = r.act as TokenAction;
  if (
    !subjectMatchesAction(
      { a: hasA ? (r.a as string) : undefined, o: hasO ? (r.o as string) : undefined },
      act,
    )
  )
    return null;
  return hasA ? { a: r.a as string, act, exp: r.exp } : { o: r.o as string, act, exp: r.exp };
}

/** Order: structure, signature (constant time), expiry, action. Expired when now >= exp. */
export function verifyToken(
  token: string,
  secret: string,
  now: Date,
  expectedAct: TokenAction,
): VerifyResult {
  assertSecret(secret);
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];
  if (!body || !sig || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return { ok: false, reason: 'malformed' };
  }
  const given = Buffer.from(sig, 'base64url');
  if (b64url(given) !== sig) return { ok: false, reason: 'bad_signature' };
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const payload = parsePayload(body);
  if (!payload) return { ok: false, reason: 'malformed' };
  // Written so an Invalid Date (NaN) fails closed as expired.
  if (!(Math.floor(now.getTime() / 1000) < payload.exp)) return { ok: false, reason: 'expired' };
  if (payload.act !== expectedAct) return { ok: false, reason: 'wrong_action' };
  return { ok: true, payload };
}

/** Appointment links expire at the appointment start (epoch seconds). */
export function expiryFor(startAt: Date): number {
  return Math.floor(startAt.getTime() / 1000);
}

/** Waitlist offer links expire at the offer's `expiresAt` (epoch seconds). */
export function offerExpiryFor(expiresAt: Date): number {
  return Math.floor(expiresAt.getTime() / 1000);
}
