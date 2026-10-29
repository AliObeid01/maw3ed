import { isRepeatNoShow } from '@/server/domain/clientFlags';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { clientRepo, type ClientListRow, type ClientSort } from '@/server/repositories/client.repo';
import { onSlotFreed } from './slotFreed';

const HISTORY_LIMIT = 50;

const toDto = (c: ClientListRow) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  attended: c.attended,
  noShows: c.noShows,
  lateCancels: c.lateCancels,
  lastVisitAt: c.lastVisitAt,
  repeatNoShow: isRepeatNoShow(c.noShows),
});

/** Opaque offset cursor: base64url("o<offset>"). Anything else is a 400. */
export const encodeCursor = (offset: number) => Buffer.from(`o${offset}`).toString('base64url');
export function decodeCursor(cursor: string): number | null {
  const m = /^o(\d{1,9})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return m ? Number(m[1]) : null;
}

export const clientsService = {
  async list(
    ctx: SessionContext,
    q: {
      search?: string | undefined;
      sort: ClientSort;
      limit: number;
      cursor?: string | undefined;
    },
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    let offset = 0;
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded === null) throw AppError.validation({ cursor: 'Invalid cursor.' });
      offset = decoded;
    }
    const rows = await clientRepo.list(ctx.businessId, {
      search: q.search,
      sort: q.sort,
      limit: q.limit + 1,
      offset,
    });
    const page = rows.slice(0, q.limit);
    return {
      clients: page.map(toDto),
      nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null,
    };
  },

  async get(ctx: SessionContext, id: string) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const client = await clientRepo.findDetail(ctx.businessId, id);
    if (!client) throw AppError.notFound();
    const history = await clientRepo.history(ctx.businessId, id, HISTORY_LIMIT);
    return { client: { ...toDto(client), createdAt: client.createdAt }, history };
  },

  /** Owner only. Anonymises the client (NFR-04) after cancelling their future bookings. */
  async remove(ctx: SessionContext, id: string, now: () => Date = () => new Date()) {
    requireRole(ctx, 'OWNER');
    const done = await clientRepo.anonymise(ctx.businessId, id, now());
    if (!done) throw AppError.notFound();
    ctx.logger.info(
      { businessId: ctx.businessId, clientId: id, cancelled: done.freed.length },
      'client anonymised on request',
    );
    for (const a of done.freed) {
      try {
        await onSlotFreed(ctx, {
          appointmentId: a.id,
          serviceId: a.serviceId,
          staffId: a.staffId,
          startAt: a.startAt,
          endAt: a.endAt,
        });
      } catch {
        ctx.logger.error(
          { businessId: ctx.businessId, appointmentId: a.id },
          'onSlotFreed failed after a committed cancel',
        );
      }
    }
  },
};
