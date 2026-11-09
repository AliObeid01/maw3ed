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
  if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);
  return {
    refund: () => limiter.refund(policy, subject, decision.windowStart).catch(() => {}),
  };
}

/** Bucket subject for a phone: an HMAC of the E.164 (server secret), never the bare number. */
export const phoneSubject = (secret: string, e164: string) =>
  createHmac('sha256', secret).update(`mcp-phone:${e164}`).digest('hex');
