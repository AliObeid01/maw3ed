import { isRepeatNoShow } from '@/server/domain/clientFlags';
import { localDayOf, resolveLocalRange } from '@/server/domain/dateRange';
import { localDateOf } from '@/server/domain/pilotMetrics';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { outcomeRepo } from '@/server/repositories/outcome.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { whatsappRemindersService, type WhatsappDeps } from './whatsappReminders';

type Now = () => Date;
const realNow: Now = () => new Date();

const CANCELLED = new Set(['CANCELLED', 'LATE_CANCEL']);

export const dashboardService = {
  /** Badge counts, polled every minute. */
  async summary(ctx: SessionContext, now: Now = realNow, whatsapp?: WhatsappDeps) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const [due, outcomesToMark] = await Promise.all([
      whatsappRemindersService.due(ctx, whatsapp),
      outcomeRepo.countQueue(ctx.businessId, now()),
    ]);
    return { whatsappDue: due.count, outcomesToMark };
  },

  async today(
    ctx: SessionContext,
    q: { date?: string | undefined },
    now: Now = realNow,
    whatsapp?: WhatsappDeps,
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const business = await publicBusinessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const at = now();
    const tz = business.timezone;
    const date = q.date ?? localDateOf(at, tz);
    const range = resolveLocalRange({ from: date, to: date, timezone: tz, maxDays: 1, now: at });
    if (!range.ok)
      throw AppError.validation({ date: range.fields.from ?? 'Use a date like 2026-11-10.' });
    const realToday = localDayOf(at, tz);

    const [rows, staff, outcomesToMark, due] = await Promise.all([
      outcomeRepo.listForDay(ctx.businessId, range.startUtc, range.endUtc, at),
      outcomeRepo.listColumns(ctx.businessId),
      outcomeRepo.countQueue(ctx.businessId, at),
      whatsappRemindersService.due(ctx, whatsapp),
    ]);

    const live = rows.filter((r) => !CANCELLED.has(r.status));
    return {
      date: range.from,
      timezone: tz,
      stats: {
        appointments: live.length,
        confirmed: live.filter((r) => r.confirmedAt !== null).length,
        noReply: live.filter((r) => r.status === 'BOOKED').length,
        refilledFromWaitlist: live.filter(
          (r) =>
            r.source === 'WAITLIST' &&
            r.createdAt >= realToday.startUtc &&
            r.createdAt < realToday.endUtc,
        ).length,
      },
      whatsappDue: due.count,
      outcomesToMark,
      staff,
      appointments: rows.map((r) => ({
        id: r.id,
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        source: r.source,
        service: r.service,
        staff: r.staff,
        client: {
          id: r.client.id,
          name: r.client.name,
          phone: r.client.phone,
          noShows: r.client.noShows,
          repeatNoShow: isRepeatNoShow(r.client.noShows),
        },
        confirmedAt: r.confirmedAt,
        reminders: { whatsappPending: r.reminderJobs.length > 0 },
      })),
    };
  },
};
