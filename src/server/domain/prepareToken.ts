import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The MCP "prepare" token: a signed, short-lived promise that one slot was offered for one service at one
 * moment. No database row. It is NOT a link token: it is signed with a key derived from the link secret for
 * this purpose only (`maw3ed.mcp.prepare.v1`), and its payload has no appointment/offer subject, so a link
 * token of any act can never verify as a prepare token and a prepare token can never verify as a link token.
 * Pure: `now` is injected.
 */
export const PREPARE_TTL_SEC = 10 * 60;

export interface PreparePayload {
  /** businessId */
  b: string;
  /** serviceId */
  s: string;
  /** staffId, or null for "anyone" */
  p: string | null;
  /** startAt, ISO 8601 UTC */
  t: string;
  /** epoch seconds */
  exp: number;
}

export type PrepareVerifyResult =
  | { ok: true; payload: PreparePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 700;
const PURPOSE = 'maw3ed.mcp.prepare.v1';

function key(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error('Link token secret must be at least 32 characters');
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

const mac = (body: string, secret: string) =>
  createHmac('sha256', key(secret)).update(`prepare.${body}`).digest();

export function signPrepareToken(payload: PreparePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ act: 'prepare', ...payload }), 'utf8').toString(
    'base64url',
  );
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

export function verifyPrepareToken(token: string, secret: string, now: Date): PrepareVerifyResult {
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig))
    return { ok: false, reason: 'malformed' };
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(body, secret);
  if (
    given.toString('base64url') !== sig ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  )
    return { ok: false, reason: 'bad_signature' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  if (
    r.act !== 'prepare' ||
    typeof r.b !== 'string' ||
    typeof r.s !== 'string' ||
    !(r.p === null || typeof r.p === 'string') ||
    typeof r.t !== 'string' ||
    typeof r.exp !== 'number' ||
    !Number.isFinite(r.exp)
  )
    return { ok: false, reason: 'malformed' };
  // Written so an Invalid Date (NaN) fails closed as expired.
  if (!(Math.floor(now.getTime() / 1000) < r.exp)) return { ok: false, reason: 'expired' };
  return { ok: true, payload: { b: r.b, s: r.s, p: r.p, t: r.t, exp: r.exp } };
}
