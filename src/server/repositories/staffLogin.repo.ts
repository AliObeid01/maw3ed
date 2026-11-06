import { db } from './db';
import { lockUserPasswordHash } from './user.repo';
import { lockStaff, revokeStaffLogin, StaffNotFoundError } from './staff.repo';

/** The person already signs in as the owner or a receptionist: they keep that login. */
export class LoginNotAllowedError extends Error {}
/** The phone belongs to an account that is not a free practitioner slot (e-mail account, other business, other staff). */
export class PhoneInUseError extends Error {}
/** The staff member is deactivated. */
export class StaffInactiveError extends Error {}
/** Unknown, used, expired, replaced or revoked link, or the world changed under it. One answer for all. */
export class ActivationGoneError extends Error {}

export interface IssuedLink {
  id: string;
  phone: string;
  expiresAt: Date;
  /** True when a login already existed: sessions were revoked and the next use sets a new password. */
  reset: boolean;
}

export const staffLoginRepo = {
  /**
   * Replace the open link of one staff member (at most one open link: unique partial index) in one
   * transaction. When a practitioner login already exists the link belongs to THAT phone (the phone is not
   * changed here) and their sessions are revoked at once.
   */
  issueLink: (
    businessId: string,
    staffId: string,
    data: { phone: string | null; tokenHash: string; expiresAt: Date },
  ): Promise<IssuedLink> =>
    db.$transaction(async (tx) => {
      await lockStaff(tx, businessId, staffId);
      const staff = await tx.staffMember.findFirstOrThrow({
        where: { id: staffId, businessId },
        select: {
          active: true,
          userId: true,
          user: {
            select: { phone: true, memberships: { where: { businessId }, select: { role: true } } },
          },
        },
      });
      if (!staff.active) throw new StaffInactiveError();
      let phone: string;
      let reset = false;
      if (staff.userId) {
        if (staff.user?.memberships[0]?.role !== 'PRACTITIONER' || !staff.user.phone)
          throw new LoginNotAllowedError();
        phone = staff.user.phone;
        reset = true;
      } else {
        if (!data.phone) throw new PhoneInUseError(); // callers validate; defensive
        phone = data.phone;
        const other = await tx.user.findUnique({
          where: { phone },
          select: {
            id: true,
            email: true,
            memberships: { select: { businessId: true } },
            staff: { select: { id: true, businessId: true } },
          },
        });
        if (
          other &&
          (other.email ||
            other.memberships.some((m) => m.businessId !== businessId) ||
            other.staff.some((s) => s.businessId === businessId && s.id !== staffId))
        )
          throw new PhoneInUseError();
      }
      await tx.activationToken.deleteMany({
        where: { businessId, staffMemberId: staffId, usedAt: null },
      });
      const row = await tx.activationToken.create({
        data: {
          businessId,
          staffMemberId: staffId,
          phone,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
        },
      });
      if (reset && staff.userId)
        await tx.session.deleteMany({ where: { businessId, userId: staff.userId } });
      return { id: row.id, phone, expiresAt: row.expiresAt, reset };
    }),

  /** Turn the login off (see revokeStaffLogin). Unknown staff in this business -> StaffNotFoundError. */
  turnOff: (businessId: string, staffId: string, now: Date) =>
    db.$transaction(async (tx) => {
      await lockStaff(tx, businessId, staffId);
      return revokeStaffLogin(tx, businessId, staffId, now);
    }),

  /** Public preview: is this link usable right now? Returns nothing about it. */
  isUsable: async (tokenHash: string, now: Date) =>
    (await db.activationToken.count({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    })) === 1,

  /**
   * Single use. The conditional UPDATE (usedAt IS NULL, not expired) decides the winner; any later failure
   * rolls the claim back. Creates or re-uses the phone User, sets the password, grants the PRACTITIONER
   * membership, links the StaffMember and inserts the session.
   */
  activate: (input: {
    tokenHash: string;
    now: Date;
    passwordHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }) =>
    db.$transaction(async (tx) => {
      const claimed = await tx.activationToken.updateMany({
        where: { tokenHash: input.tokenHash, usedAt: null, expiresAt: { gt: input.now } },
        data: { usedAt: input.now },
      });
      if (claimed.count !== 1) throw new ActivationGoneError();
      const token = await tx.activationToken.findUniqueOrThrow({
        where: { tokenHash: input.tokenHash },
      });
      const { businessId } = token;
      try {
        await lockStaff(tx, businessId, token.staffMemberId);
      } catch (e) {
        if (e instanceof StaffNotFoundError) throw new ActivationGoneError();
        throw e;
      }
      const staff = await tx.staffMember.findFirstOrThrow({
        where: { id: token.staffMemberId, businessId },
        select: {
          active: true,
          userId: true,
          displayName: true,
          user: { select: { phone: true } },
        },
      });
      if (!staff.active) throw new ActivationGoneError();
      if (staff.userId && staff.user?.phone !== token.phone) throw new ActivationGoneError();

      const existing = await tx.user.findUnique({
        where: { phone: token.phone },
        select: {
          id: true,
          email: true,
          memberships: { select: { businessId: true, role: true } },
        },
      });
      let userId: string;
      if (existing) {
        const foreign = existing.memberships.some(
          (m) => m.businessId !== businessId || m.role !== 'PRACTITIONER',
        );
        if (existing.email || foreign) throw new ActivationGoneError();
        if (staff.userId && staff.userId !== existing.id) throw new ActivationGoneError();
        if ((await lockUserPasswordHash(tx, existing.id)) === undefined)
          throw new ActivationGoneError();
        await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash: input.passwordHash },
        });
        await tx.session.deleteMany({ where: { userId: existing.id } });
        userId = existing.id;
      } else {
        if (staff.userId) throw new ActivationGoneError();
        const created = await tx.user.create({
          data: { phone: token.phone, name: staff.displayName, passwordHash: input.passwordHash },
        });
        userId = created.id;
      }
      if (existing?.memberships.length === 0 || !existing)
        await tx.membership.create({ data: { businessId, userId, role: 'PRACTITIONER' } });
      await tx.staffMember.updateMany({
        where: { id: token.staffMemberId, businessId },
        data: { userId, loginOffAt: null },
      });
      await tx.activationToken.update({ where: { id: token.id }, data: { userId } });
      await tx.session.create({
        data: {
          businessId,
          userId,
          tokenHash: input.sessionTokenHash,
          expiresAt: input.sessionExpiresAt,
        },
      });
      const [user, business] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: userId } }),
        tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { id: true, slug: true, name: true, timezone: true },
        }),
      ]);
      return { user, business };
    }),
};
