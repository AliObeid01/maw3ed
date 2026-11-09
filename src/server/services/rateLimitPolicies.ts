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
  /**
   * GET /api/public/categories, and GET /api/public/directory when it computes slots (include=nextFree or when).
   * Costlier than a plain read (a batched load plus the slot engine for up to 12 to 36 businesses), so a lower
   * cap than `directory`; a plain directory read is counted by `directory` only.
   */
  directoryLive: { windowSec: 10 * MIN, limit: 60 },
  /**
   * PUT /api/business/logo, per ip. Each upload decodes and re-encodes an image (CPU), so far fewer than a
   * normal write: a salon replaces its logo a handful of times, never 10 in an hour.
   */
  logoUpload: { windowSec: 60 * MIN, limit: 10 },
  /**
   * GET /api/public/{slug}/logo, per ip. Cached for a year by the browser and the CDN when the url carries the
   * version, so this only counts real origin hits. A directory page shows up to 12 logos and Explore pages through
   * them: 600 per 10 minutes is about 50 full pages, far above browsing, below a scraping loop.
   */
  logoRead: { windowSec: 10 * MIN, limit: 600 },
  /** GET /api/links/* and GET /api/offers/* */
  linkRead: { windowSec: 10 * MIN, limit: 120 },
  /**
   * GET /api/links/{token}/outcome. The My bookings screen asks once per past entry (up to 20 stored on a device,
   * and Complete/Rebook cards re-ask on focus), alongside a few link reads. 300 per 10 minutes per ip leaves room
   * for a few page loads (20 + 20 + 20 outcome reads) and for several clients behind one NAT, yet a token-guessing
   * loop (each miss costs one HMAC compare) is still capped at 30 per minute.
   */
  linkOutcome: { windowSec: 10 * MIN, limit: 300 },
  /** POST /api/links/{token} and POST /api/offers/{token}/claim */
  linkAct: { windowSec: 10 * MIN, limit: 20 },
  /** GET /api/invites/{token} */
  invitePreview: { windowSec: 10 * MIN, limit: 60 },
  /** POST /api/invites/{token}/accept (new users cost an argon2 hash) */
  inviteAccept: { windowSec: 10 * MIN, limit: 20 },
  /** POST /api/auth/verify-email (a token guess costs one indexed lookup, but nothing needs more than a few) */
  verifyEmail: { windowSec: 10 * MIN, limit: 30 },
  /** POST /api/auth/resend-verification, per ip (each one sends an email) */
  resendVerificationIp: { windowSec: 60 * MIN, limit: 10 },
  /** POST /api/auth/resend-verification, per signed-in user (service-level) */
  resendVerificationUser: { windowSec: 60 * MIN, limit: 3 },
  /** POST /api/auth/forgot-password, per ip (each known address costs an email) */
  forgotIp: { windowSec: 60 * MIN, limit: 10 },
  /** POST /api/auth/forgot-password, per sha256(email), known or not. Past it: same 200, nothing issued or sent. */
  forgotEmail: { windowSec: 60 * MIN, limit: 5 },
  /** POST /api/auth/reset-password (each valid attempt costs an argon2 hash) */
  resetPasswordIp: { windowSec: 10 * MIN, limit: 20 },
  /** POST /api/auth/change-password, per ip */
  changePasswordIp: { windowSec: 10 * MIN, limit: 20 },
  /** POST /api/auth/change-password, per signed-in user: bounds guessing the current password (service-level) */
  changePasswordUser: { windowSec: 15 * MIN, limit: 5 },
  /** POST /api/auth/sign-out-others, per ip (one cheap DELETE; the cap only stops scripted floods) */
  signOutOthersIp: { windowSec: 10 * MIN, limit: 20 },
  /** GET/POST /api/activation/{token}, per ip (the POST costs an argon2 hash) */
  activationIp: { windowSec: 10 * MIN, limit: 20 },
  /** POST /api/staff/{id}/login, per owner (service-level): each call mints a link */
  staffLoginIssue: { windowSec: 60 * MIN, limit: 20 },
  /** Login attempts per (sha256(email), ip). A success clears it. */
  loginEmailIp: { windowSec: 15 * MIN, limit: 5 },
  /** Failed logins per ip across all emails. A success refunds its hit. */
  loginIp: { windowSec: 15 * MIN, limit: 20 },
  /** Attempts per email across all IPs (rotating-IP guessing). Counted before the check, refunded on success. */
  loginEmail: { windowSec: 60 * MIN, limit: 30 },

  // ---- POST /api/mcp (the assistant connector): ALL its numbers, in one place ---------------------------------
  // NEVER per ip: every Claude user arrives from Anthropic's few addresses, so an ip bucket would lock everyone
  // out at once. Keys are global ('all'), per business, per HMAC of a phone / an email / a link token.
  //
  // EMAIL ARITHMETIC. Resend's free tier is about 100 emails a day for ALL tenants (reminders.ts counts it:
  // EMAIL_BUDGET_WARN 80, EMAIL_BUDGET_SKIP_BOOKING 95; H24/H2 reminders have no budget check). One chat booking
  // queues up to 3 emails (1 confirmation + H24 + H2). So at most 20 chat bookings a day = 60 emails, even if every
  // reminder lands on the same day, which leaves 40 of the 100 for real traffic. Waitlist joins send nothing at
  // join time (only a claim-offer email when a slot frees), so 40 a day is at most 40 more offer emails in the
  // worst case but in practice far fewer; the guard below stops chat writes at 80 sent anyway.
  // SHARED FATE: because the daily caps are global, an anonymous caller CAN use them up and make chat booking
  // unavailable for everyone until the next UTC day. Accepted for the rollout (the alternative is starving real
  // reminders); MCP_ENABLED is the emergency stop. Tune the numbers here.

  /** Valid read calls (search_businesses, get_business, get_free_times, prepare_booking, get_booking), whole connector. */
  mcpRead: { windowSec: 10 * MIN, limit: 600 },
  /** Malformed or invalid calls (bad arguments, bad tokens, not found): bounds junk, never touches the write buckets. */
  mcpInvalid: { windowSec: 10 * MIN, limit: 300 },
  /** Business-scoped reads (get_business, get_free_times, prepare_booking), per business. */
  mcpReadBusiness: { windowSec: 10 * MIN, limit: 300 },
  /** create_booking, whole connector: 10 an hour. */
  mcpBookHour: { windowSec: 60 * MIN, limit: 10 },
  /** create_booking, whole connector: 20 a day (20 x 3 emails = 60 of ~100). */
  mcpBookDay: { windowSec: 24 * 60 * MIN, limit: 20 },
  /** join_waitlist, whole connector: 20 an hour. */
  mcpWaitHour: { windowSec: 60 * MIN, limit: 20 },
  /** join_waitlist, whole connector: 40 a day. */
  mcpWaitDay: { windowSec: 24 * 60 * MIN, limit: 40 },
  /** create_booking, per business: 8 a day (the real cap on filling one business's free slots). */
  mcpBookBusinessDay: { windowSec: 24 * 60 * MIN, limit: 8 },
  /** create_booking and join_waitlist, per HMAC of the normalized phone: 5 an hour. */
  mcpPhone: { windowSec: 60 * MIN, limit: 5 },
  /** Same, 3 a day. */
  mcpPhoneDay: { windowSec: 24 * 60 * MIN, limit: 3 },
  /** create_booking, per HMAC of the lowercased email: 2 a day (a victim's inbox cannot be flooded by rotating phones). */
  mcpEmail: { windowSec: 24 * 60 * MIN, limit: 2 },
  /** join_waitlist, per HMAC of the lowercased email: 3 a day (offer emails). */
  mcpEmailWait: { windowSec: 24 * 60 * MIN, limit: 3 },
  /** get_booking, confirm_booking, cancel_booking, per HMAC of the link token: 20 an hour. */
  mcpLinkToken: { windowSec: 60 * MIN, limit: 20 },
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
  'directoryLive',
  'linkRead',
  'linkOutcome',
  'logoRead',
]);
export const SOFT_THRESHOLD = 0.5;
