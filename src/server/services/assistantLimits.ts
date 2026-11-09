import { createHmac } from 'node:crypto';
import { AppError } from '@/server/http/errors';
import type { RateLimiter } from './rateLimit';
import type { RatePolicyName } from './rateLimitPolicies';

/**
 * Rate limits of the assistant connector (policies `mcp*`). Never keyed by ip: every Claude user arrives from
 * Anthropic's few addresses. Fail behaviour when the Postgres limiter itself errors or times out:
 *  - reads fail OPEN (the limiter's own behaviour; the failure is logged as `rate_limit_fail_open`),
 *  - writes fail CLOSED: a booking is refused with an actionable "try again in a few minutes" error.
 */
export type AssistantLimiter = Pick<RateLimiter, 'consume' | 'refund' | 'failOpenCount'>;

export interface Spent {
  refund: () => Promise<void>;
}

export const LIMITER_DOWN_MESSAGE =
  'Booking is paused for a few minutes while Maw3ed checks its safety limits. Try again in a few minutes.';

/** Count one hit against `policy`. Throws RATE_LIMITED (429) when over the limit. `closed`: fail closed. */
export async function spend(
  limiter: AssistantLimiter,
  policy: RatePolicyName,
  subject: string,
  mode: 'open' | 'closed',
): Promise<Spent> {
  const before = limiter.failOpenCount();
  const decision = await limiter.consume(policy, subject);
  if (mode === 'closed' && limiter.failOpenCount() > before)
    throw new AppError(503, 'SERVICE_BUSY', LIMITER_DOWN_MESSAGE, {}, { retryAfterSec: 120 });
  if (decision.limited) {
    // The refused attempt is not a use: give its hit back so refusals leave the counts exactly where they were.
    await limiter.refund(policy, subject, decision.windowStart).catch(() => {});
    throw AppError.rateLimited(decision.retryAfterSec);
  }
  return {
    refund: () => limiter.refund(policy, subject, decision.windowStart).catch(() => {}),
  };
}

/** Bucket subject for a phone: an HMAC of the E.164 (server secret), never the bare number. */
export const phoneSubject = (secret: string, e164: string) =>
  createHmac('sha256', secret).update(`mcp-phone:${e164}`).digest('hex');

/** Bucket subject for an email: an HMAC of the trimmed, lowercased address. Never the address. */
export const emailSubject = (secret: string, email: string) =>
  createHmac('sha256', secret).update(`mcp-email:${email.trim().toLowerCase()}`).digest('hex');

/** Bucket subject for a link token: an HMAC of the token text (the token itself is a bearer secret). */
export const tokenSubject = (secret: string, token: string) =>
  createHmac('sha256', secret).update(`mcp-token:${token}`).digest('hex');

export interface SpendItem {
  policy: RatePolicyName;
  subject: string;
}

/**
 * Spend several buckets in order. If one is limited (or the limiter is down in `closed` mode), everything spent
 * so far is given back and the error is thrown, so a refused call costs nothing. `refund()` gives back all.
 */
export async function spendMany(
  limiter: AssistantLimiter,
  items: SpendItem[],
  mode: 'open' | 'closed',
): Promise<Spent> {
  const spent: Spent[] = [];
  const refund = async () => {
    for (const s of spent) await s.refund();
  };
  try {
    for (const item of items) spent.push(await spend(limiter, item.policy, item.subject, mode));
  } catch (error) {
    await refund();
    throw error;
  }
  return { refund };
}
