import { scopeFor, type Scope } from '@/server/domain/scope';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { staffRepo } from '@/server/repositories/staff.repo';

/**
 * The row scope of this session. OWNER and STAFF: the whole business. PRACTITIONER: the staff member their login is
 * linked to, read here from `userId` + `businessId` of the SESSION (never from the request). A barber without a
 * linked, active staff member (login turned off, person deactivated, link removed) is refused with 403 and no data.
 */
/** A scope no row can match (ids are never empty): the stand-in lookup of an unlinked barber. */
export const NO_MATCH_SCOPE: Scope = { kind: 'own', staffId: '' };

export async function resolveScope(ctx: SessionContext): Promise<Scope> {
  const linked =
    ctx.role === 'PRACTITIONER' ? await staffRepo.linkedStaffId(ctx.businessId, ctx.userId) : null;
  const scope = scopeFor(ctx.role, linked);
  if (!scope) throw AppError.forbidden('No schedule is linked to this login.');
  return scope;
}

/**
 * Timing parity for a single-row read. An unlinked barber (403) used to stop after the link lookup, so it ran
 * fewer queries (3 against 7) than a foreign id (404) and could be told apart by latency. Here the 403 path first
 * runs the SAME row lookup a linked barber would, with a scope that matches nothing, then refuses. The result of
 * the stand-in lookup is discarded; no data is read for the caller.
 */
export async function resolveScopeForRead(
  ctx: SessionContext,
  lookup: (scope: Scope) => Promise<unknown>,
): Promise<Scope> {
  try {
    return await resolveScope(ctx);
  } catch (error) {
    if (error instanceof AppError && error.status === 403)
      // Only the work matters. A failure of the stand-in must not replace the refusal with a different answer.
      await lookup(NO_MATCH_SCOPE).catch(() => undefined);
    throw error;
  }
}
