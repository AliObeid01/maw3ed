import { scopeFor, type Scope } from '@/server/domain/scope';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { staffRepo } from '@/server/repositories/staff.repo';

/**
 * The row scope of this session. OWNER and STAFF: the whole business. PRACTITIONER: the staff member their login is
 * linked to, read here from `userId` + `businessId` of the SESSION (never from the request). A barber without a
 * linked, active staff member (login turned off, person deactivated, link removed) is refused with 403 and no data.
 */
export async function resolveScope(ctx: SessionContext): Promise<Scope> {
  const linked =
    ctx.role === 'PRACTITIONER' ? await staffRepo.linkedStaffId(ctx.businessId, ctx.userId) : null;
  const scope = scopeFor(ctx.role, linked);
  if (!scope) throw AppError.forbidden('No schedule is linked to this login.');
  return scope;
}
