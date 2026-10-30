/**
 * Every rate-limit number in one place. Fixed windows, keyed per policy + client IP (see clientIp()).
 *
 * Limits are deliberately generous: clients behind one carrier NAT, a salon's wifi or a shared office
 * share one IP. They stop floods and scripted abuse, not a busy front desk. Fixed windows allow up to
 * 2x the limit across a window boundary; that is accepted.
 */
export type RatePolicyName = keyof typeof RATE_POLICIES;
const MIN = 60;

export const RATE_POLICIES = {
  /** POST /api/public/{slug}/bookings */
  bookingCreate: { windowSec: 10 * MIN, limit: 30 },
  /**
   * POST /api/public/{slug}/bookings, per normalized phone number (any IP). Bounds how fast anyone can probe
   * whether a number has a no-show history (the deposit hold is visible in the answer).
   */
  bookingPhone: { windowSec: 15 * MIN, limit: 6 },
  /** POST /api/public/{slug}/waitlist */
  waitlistJoin: { windowSec: 10 * MIN, limit: 10 },
  /** POST /api/auth/signup (each one costs an argon2 hash) */
  signup: { windowSec: 60 * MIN, limit: 10 },
  /** GET /api/auth/slug-check */
  slugCheck: { windowSec: 10 * MIN, limit: 60 },
  /** GET /api/public/{slug}/slots */
  slots: { windowSec: 10 * MIN, limit: 300 },
  /** GET /api/public/{slug} */
  publicPage: { windowSec: 10 * MIN, limit: 300 },
  /** GET /api/public/directory */
  directory: { windowSec: 10 * MIN, limit: 120 },
  /** GET /api/links/* and GET /api/offers/* */
  linkRead: { windowSec: 10 * MIN, limit: 120 },
  /** POST /api/links/{token} and POST /api/offers/{token}/claim */
  linkAct: { windowSec: 10 * MIN, limit: 20 },
  /** GET /api/invites/{token} */
  invitePreview: { windowSec: 10 * MIN, limit: 60 },
  /** POST /api/invites/{token}/accept (new users cost an argon2 hash) */
  inviteAccept: { windowSec: 10 * MIN, limit: 20 },
  /** Login attempts per (sha256(email), ip). A success clears it. */
  loginEmailIp: { windowSec: 15 * MIN, limit: 5 },
  /** Failed logins per ip across all emails. A success refunds its hit. */
  loginIp: { windowSec: 15 * MIN, limit: 20 },
  /** Attempts per email across all IPs (rotating-IP guessing). Counted before the check, refunded on success. */
  loginEmail: { windowSec: 60 * MIN, limit: 30 },
} as const;

/**
 * Cacheable read policies: counted per instance in memory first, and Postgres is only written once an
 * instance has seen SOFT_THRESHOLD of the limit for that ip+window (normal visitors cause no writes).
 * Everything else (every POST, signup, slug-check, logins) always writes.
 */
export const SOFT_POLICIES: ReadonlySet<RatePolicyName> = new Set([
  'slots',
  'publicPage',
  'directory',
  'linkRead',
]);
export const SOFT_THRESHOLD = 0.5;
