import { slugProblem } from '@/server/contracts/slug';
import type { RoleName } from '@/server/http/auth';
import { parseLoginIdentifier } from '@/server/domain/loginIdentifier';
import { UNKNOWN_IP } from '@/server/http/clientIp';
import { AppError, fromDbError } from '@/server/http/errors';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { accountRepo } from '@/server/repositories/account.repo';
import { businessRepo } from '@/server/repositories/business.repo';
import { membershipRepo } from '@/server/repositories/membership.repo';
import { userRepo } from '@/server/repositories/user.repo';
import { loginGuard, type LoginGuard } from './loginGuard';
import { hashPassword, verifyPassword } from './password';
import { emailVerificationService } from './emailVerification';
import { sessionService } from './session';

export interface SessionInfo {
  user: {
    id: string;
    name: string;
    /** Null for phone-only accounts (staff logins). */
    email: string | null;
    phone: string | null;
    emailVerified: boolean;
  };
  business: { id: string; slug: string; name: string; timezone: string };
  role: RoleName;
}

/** What a route needs to answer and to set the cookie. */
export interface SignedIn {
  info: SessionInfo;
  token: string;
  expiresAt: Date;
}

export const toSessionInfo = (
  user: {
    id: string;
    name: string;
    email: string | null;
    phone?: string | null;
    emailVerifiedAt: Date | null;
  },
  business: { id: string; slug: string; name: string; timezone: string },
  role: RoleName,
): SessionInfo => ({
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    emailVerified: user.emailVerifiedAt !== null,
  },
  business: {
    id: business.id,
    slug: business.slug,
    name: business.name,
    timezone: business.timezone,
  },
  role,
});

export interface AuthDeps {
  now: () => Date;
  guard: LoginGuard;
}
const defaultDeps: AuthDeps = { now: () => new Date(), guard: loginGuard };

export interface SignupInput {
  businessName: string;
  slug: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
}

export const authService = {
  async slugCheck(
    slug: string,
  ): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken' }> {
    const problem = slugProblem(slug);
    if (problem) return { available: false, reason: problem };
    if (await businessRepo.slugExists(slug)) return { available: false, reason: 'taken' };
    return { available: true };
  },

  async signup(
    ctx: RouteContext,
    input: SignupInput,
    deps: AuthDeps = defaultDeps,
  ): Promise<SignedIn> {
    const problem = slugProblem(input.slug);
    if (problem)
      throw AppError.validation({
        slug:
          problem === 'reserved'
            ? 'This address is reserved.'
            : 'Use 3-40 lowercase letters, digits or hyphens.',
      });
    if (await businessRepo.slugExists(input.slug))
      throw AppError.conflict('SLUG_TAKEN', undefined, 'That booking address is already taken.');
    // Email enumeration at signup is an accepted trade-off.
    if (await userRepo.findByEmail(input.email))
      throw AppError.conflict(
        'EMAIL_TAKEN',
        undefined,
        'An account with this email already exists.',
      );

    const passwordHash = await hashPassword(input.password);
    const session = sessionService.issue(deps.now());
    try {
      const { business, user } = await accountRepo.createBusinessWithOwner({
        business: { slug: input.slug, name: input.businessName, timezone: input.timezone },
        owner: { name: input.ownerName, email: input.email, passwordHash },
        sessionTokenHash: session.tokenHash,
        sessionExpiresAt: session.expiresAt,
      });
      ctx.logger.info({ businessId: business.id, userId: user.id }, 'business signed up');
      // Soft verification: the account works now; a failed send never fails the signup (Resend is in the banner).
      await emailVerificationService.sendForNewAccount(
        ctx,
        { id: user.id, email: input.email },
        business,
        deps.now(),
      );
      return {
        info: toSessionInfo(user, business, 'OWNER'),
        token: session.token,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      // Lost a race on a unique key: say which one.
      if (fromDbError(error)?.code === 'CONFLICT') {
        if (await businessRepo.slugExists(input.slug))
          throw AppError.conflict(
            'SLUG_TAKEN',
            undefined,
            'That booking address is already taken.',
          );
        throw AppError.conflict(
          'EMAIL_TAKEN',
          undefined,
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  },

  /**
   * Wrong email and wrong password are indistinguishable: same status, body and (roughly) the same time,
   * because a missing user is verified against a dummy hash. A user in several businesses is signed into
   * the most recently created membership (business switching is out of scope for now).
   */
  async login(
    ctx: RouteContext,
    input: { identifier?: string; email?: string; password: string },
    deps: AuthDeps = defaultDeps,
  ): Promise<SignedIn> {
    const now = deps.now();
    const ip = ctx.ip ?? UNKNOWN_IP;
    // E-mail or phone, whichever the person typed. The guard key is the canonical form, so every spelling of
    // one phone number shares one bucket; unparsable text is an unknown account (dummy hash, same 401).
    const raw = (input.identifier ?? input.email ?? '').trim();
    const parsed = parseLoginIdentifier(raw);
    const guardKey = parsed?.value ?? raw.toLowerCase();
    const ticket = await deps.guard.attempt(guardKey, ip);

    const user = parsed ? await userRepo.findByIdentifier(parsed) : null;
    const valid = await verifyPassword(input.password, user?.passwordHash);
    const membership = valid && user ? await membershipRepo.findLatestForUser(user.id) : null;
    if (!user || !valid || !membership) {
      ctx.logger.warn('login failed');
      throw AppError.invalidCredentials();
    }
    const verifiedHash = user.passwordHash;
    if (!verifiedHash) throw AppError.invalidCredentials(); // fail closed (cannot happen after a true verify)
    // F36: the session is inserted under a User row lock and only if the verified hash is still current.
    const session = await sessionService.createVerified(
      membership.businessId,
      user.id,
      verifiedHash,
      now,
    );
    if (!session) {
      ctx.logger.warn('login rejected: password or membership changed during login');
      throw AppError.invalidCredentials();
    }
    // Only a login that really produced a session clears the failure counters.
    await deps.guard.succeeded(guardKey, ip, ticket);
    ctx.logger.info({ businessId: membership.businessId, userId: user.id }, 'login');
    return {
      info: toSessionInfo(user, membership.business, membership.role),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  },

  async logout(ctx: SessionContext): Promise<void> {
    await sessionService.destroy(ctx.businessId, ctx.sessionId);
    ctx.logger.info('logout');
  },

  /** Any role. Ends every other session of the caller (all businesses); this one stays. */
  async signOutOthers(ctx: SessionContext): Promise<{ removed: number }> {
    const removed = await accountRepo.deleteOtherSessions(ctx.userId, ctx.sessionId);
    ctx.logger.info({ removed }, 'signed out other sessions');
    return { removed };
  },

  /** For server components: cookie token -> everything the dashboard shell needs, or null. */
  async current(token: string) {
    const resolved = await sessionService.resolve(token);
    if (!resolved) return null;
    const [user, business] = await Promise.all([
      userRepo.findById(resolved.userId),
      businessRepo.findById(resolved.businessId),
    ]);
    if (!user || !business) return null;
    return {
      userId: user.id,
      userName: user.name,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerifiedAt !== null,
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      timezone: business.timezone,
      role: resolved.role,
    };
  },

  async me(ctx: SessionContext): Promise<SessionInfo> {
    const [user, business] = await Promise.all([
      userRepo.findById(ctx.userId),
      businessRepo.findById(ctx.businessId),
    ]);
    if (!user || !business) throw AppError.unauthenticated();
    return toSessionInfo(user, business, ctx.role);
  },
};
