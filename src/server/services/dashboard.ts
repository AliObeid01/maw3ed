import { isRepeatNoShow } from '@/server/domain/clientFlags';
import { resolveLocalRange } from '@/server/domain/dateRange';
import { localDateOf } from '@/server/domain/pilotMetrics';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { outcomeRepo } from '@/server/repositories/outcome.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { whatsappRemindersService } from './whatsappReminders';

type Now = () => Date;
const realNow: Now = () => new Date();

/** Not counted in the day's stats (still listed, flagged by status). */
const NOT_LIVE = new Set(['CANCELLED', 'LATE_CANCEL', 'PENDING_PAYMENT']);

export const dashboardService = {
  /** Badge counts, polled every minute. */
  async summary(ctx: SessionContext, now: Now = realNow) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const [whatsappDue, outcomesToMark] = await Promise.all([
      whatsappRemindersService.dueCount(ctx, now),
      outcomeRepo.countQueue(ctx.businessId, now()),
    ]);
    return { whatsappDue, outcomesToMark };
  },

  async today(ctx: SessionContext, q: { date?: string | undefined }, now: Now = realNow) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const business = await publicBusinessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const at = now();
    const tz = business.timezone;
    const date = q.date ?? localDateOf(at, tz);
    const range = resolveLocalRange({ from: date, to: date, timezone: tz, maxDays: 1, now: at });
    if (!range.ok)
      throw AppError.validation({ date: range.fields.from ?? 'Use a date like 2026-11-10.' });

    const [rows, staff, outcomesToMark, whatsappDue, refilled] = await Promise.all([
      outcomeRepo.listForDay(ctx.businessId, range.startUtc, range.endUtc, at),
      outcomeRepo.listColumns(ctx.businessId),
      outcomeRepo.countQueue(ctx.businessId, at),
      whatsappRemindersService.dueCount(ctx, now),
      outcomeRepo.countRefilledBetween(ctx.businessId, range.startUtc, range.endUtc),
    ]);

    const live = rows.filter((r) => !NOT_LIVE.has(r.status));
    return {
      date: range.from,
      timezone: tz,
      stats: {
        appointments: live.length,
        confirmed: live.filter((r) => r.confirmedAt !== null).length,
        // BOOKED and not started yet: a started one is an outcome to mark, not "no reply".
        noReply: live.filter((r) => r.status === 'BOOKED' && r.startAt > at).length,
        // Refilled from the waitlist ON the viewed date: replacement bookings whose claim happened on that local
        // day, for any appointment day (the activity card's "claimed" items on the same day). Not the day's list.
        refilledFromWaitlist: refilled,
      },
      whatsappDue,
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
