import { activationExpiry } from '@/server/domain/activation';
import { normalizePhone } from '@/server/domain/phone';
import { whatsappUrl } from '@/server/domain/whatsapp';
import { getServerEnv } from '@/server/env';
import { requireRole } from '@/server/http/auth';
import { AppError, fromDbError } from '@/server/http/errors';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { renderStaffLoginMessage } from '@/server/i18n/emailRender';
import { businessRepo } from '@/server/repositories/business.repo';
import { StaffNotFoundError, staffRepo } from '@/server/repositories/staff.repo';
import {
  ActivationGoneError,
  LoginNotAllowedError,
  PhoneInUseError,
  StaffInactiveError,
  staffLoginRepo,
} from '@/server/repositories/staffLogin.repo';
import { toSessionInfo, type SignedIn } from './auth';
import { newOpaqueToken, sha256Hex } from './crypto';
import { hashPassword } from './password';
import { rateLimiter, type RateLimiter } from './rateLimit';
import { sessionService } from './session';

interface Deps {
  now: () => Date;
  limiter: RateLimiter;
  appUrl: () => string;
}
const defaults: Deps = {
  now: () => new Date(),
  limiter: rateLimiter,
  appUrl: () => getServerEnv().APP_URL,
};

/** The one public answer for every unusable link. */
const linkInvalid = () => AppError.notFound('This link is not valid or has expired.');
const phoneInUse = () =>
  AppError.conflict('PHONE_IN_USE', undefined, 'This phone number already belongs to another account.');

export const staffLoginService = {
  /**
   * OWNER only. Mints the one-time link (replacing any open one) and returns it with the wa.me URL. The token
   * exists only in this response and in the link; the database holds its sha256. Never logged.
   */
  async createLink(
    ctx: SessionContext,
    staffId: string,
    input: { phone?: string },
    deps: Deps = defaults,
  ) {
    requireRole(ctx, 'OWNER');
    const decision = await deps.limiter.consume('staffLoginIssue', ctx.userId);
    if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw AppError.validation({ phone: 'Enter a valid phone number.' });
    const business = await businessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const staff = await staffRepo.findById(ctx.businessId, staffId);
    if (!staff) throw AppError.notFound();
    // A first link needs a number; a reset keeps the number the person already has.
    if (!phone && staff.loginStatus !== 'ACTIVE')
      throw AppError.validation({ phone: 'Enter the phone number.' });
    const appUrl = deps.appUrl().replace(/\/+$/, '');

    const token = newOpaqueToken();
    let issued;
    try {
      issued = await staffLoginRepo.issueLink(ctx.businessId, staffId, {
        phone,
        tokenHash: sha256Hex(token),
        expiresAt: activationExpiry(deps.now()),
      });
    } catch (error) {
      if (error instanceof StaffNotFoundError) throw AppError.notFound();
      if (error instanceof LoginNotAllowedError)
        throw AppError.conflict(
          'LOGIN_NOT_ALLOWED',
          undefined,
          'This person signs in with their own account.',
        );
      if (error instanceof StaffInactiveError)
        throw AppError.conflict('STAFF_INACTIVE', undefined, 'Reactivate this person first.');
      if (error instanceof PhoneInUseError || fromDbError(error)?.code === 'CONFLICT')
        throw phoneInUse();
      throw error;
    }
    const url = `${appUrl}/activate/${token}`;
    const text = renderStaffLoginMessage({
      locale: business.locale,
      businessName: business.name,
      staffName: staff.displayName,
      url,
      phone: issued.phone,
    });
    ctx.logger.info(
      {
        businessId: ctx.businessId,
        staffMemberId: staffId,
        activationTokenId: issued.id,
        reset: issued.reset,
      },
      'staff login link created',
    );
    return {
      url,
      whatsappUrl: whatsappUrl(issued.phone, text),
      phone: issued.phone,
      expiresAt: issued.expiresAt.toISOString(),
      reset: issued.reset,
    };
  },

  /** OWNER only. Idempotent: no login to remove is still ok. */
  async turnOff(ctx: SessionContext, staffId: string, deps: Deps = defaults): Promise<{ ok: true }> {
    requireRole(ctx, 'OWNER');
    try {
      const removed = await staffLoginRepo.turnOff(ctx.businessId, staffId, deps.now());
      ctx.logger.info(
        { businessId: ctx.businessId, staffMemberId: staffId, removed },
        'staff login turned off',
      );
    } catch (error) {
      if (error instanceof StaffNotFoundError) throw AppError.notFound();
      throw error;
    }
    return { ok: true };
  },

  /** Public. Nothing but "usable" or the same 404. */
  async preview(token: string, deps: Deps = defaults): Promise<{ ok: true }> {
    if (!(await staffLoginRepo.isUsable(sha256Hex(token), deps.now()))) throw linkInvalid();
    return { ok: true };
  },

  /** Public, single use. The password is hashed only after the link is known to be usable. */
  async activate(
    ctx: RouteContext,
    token: string,
    input: { password: string },
    deps: Deps = defaults,
  ): Promise<SignedIn> {
    const now = deps.now();
    const tokenHash = sha256Hex(token);
    if (!(await staffLoginRepo.isUsable(tokenHash, now))) throw linkInvalid();
    const passwordHash = await hashPassword(input.password);
    const session = sessionService.issue(now);
    try {
      const { user, business } = await staffLoginRepo.activate({
        tokenHash,
        now,
        passwordHash,
        sessionTokenHash: session.tokenHash,
        sessionExpiresAt: session.expiresAt,
      });
      ctx.logger.info({ businessId: business.id, userId: user.id }, 'staff login activated');
      return {
        info: toSessionInfo(user, business, 'PRACTITIONER'),
        token: session.token,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      if (error instanceof ActivationGoneError || fromDbError(error)?.code === 'CONFLICT')
        throw linkInvalid();
      throw error;
    }
  },
};
