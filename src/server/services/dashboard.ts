import { isRepeatNoShow } from '@/server/domain/clientFlags';
import { resolveLocalRange } from '@/server/domain/dateRange';
import { localDateOf } from '@/server/domain/pilotMetrics';
import { ALL_SCOPE, type Scope } from '@/server/domain/scope';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { outcomeRepo } from '@/server/repositories/outcome.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { barberClient } from './barberView';
import { resolveScope } from './scope';
import { whatsappRemindersService } from './whatsappReminders';

type Now = () => Date;
const realNow: Now = () => new Date();

/** Not counted in the day's stats (still listed, flagged by status). */
const NOT_LIVE = new Set(['CANCELLED', 'LATE_CANCEL', 'PENDING_PAYMENT']);

/**
 * The barber's day: the same shape as the owner's, but only their own appointments, their own column, the first
 * name and phone of each client, and one stat (how many they have that day). No other staff, no client id,
 * counters or no-show flag, no reminder or WhatsApp state, no waitlist figures.
 */
async function barberDay(
  ctx: SessionContext,
  scope: Extract<Scope, { kind: 'own' }>,
  range: { from: string; startUtc: Date; endUtc: Date },
  timezone: string,
  at: Date,
) {
  const [rows, staff, outcomesToMark] = await Promise.all([
    outcomeRepo.listForDay(ctx.businessId, scope, range.startUtc, range.endUtc, at),
    outcomeRepo.listColumns(ctx.businessId, scope),
    outcomeRepo.countQueue(ctx.businessId, scope, at),
  ]);
  return {
    date: range.from,
    timezone,
    stats: { appointments: rows.filter((r) => !NOT_LIVE.has(r.status)).length },
    outcomesToMark,
    staff,
    appointments: rows.map((r) => ({
      id: r.id,
      startAt: r.startAt,
      endAt: r.endAt,
      status: r.status,
      service: r.service,
      staff: r.staff,
      client: barberClient(r.client),
      confirmedAt: r.confirmedAt,
    })),
  };
}

export const dashboardService = {
  /** Badge counts, polled every minute. */
  async summary(ctx: SessionContext, now: Now = realNow) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const [whatsappDue, outcomesToMark] = await Promise.all([
      whatsappRemindersService.dueCount(ctx, now),
      outcomeRepo.countQueue(ctx.businessId, ALL_SCOPE, now()),
    ]);
    return { whatsappDue, outcomesToMark };
  },

  async today(ctx: SessionContext, q: { date?: string | undefined }, now: Now = realNow) {
    requireRole(ctx, 'OWNER', 'STAFF', 'PRACTITIONER');
    const scope = await resolveScope(ctx);
    const business = await publicBusinessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const at = now();
    const tz = business.timezone;
    const date = q.date ?? localDateOf(at, tz);
    const range = resolveLocalRange({ from: date, to: date, timezone: tz, maxDays: 1, now: at });
    if (!range.ok)
      throw AppError.validation({ date: range.fields.from ?? 'Use a date like 2026-11-10.' });

    if (scope.kind === 'own') return barberDay(ctx, scope, range, tz, at);

    const [rows, staff, outcomesToMark, whatsappDue, refilled] = await Promise.all([
      outcomeRepo.listForDay(ctx.businessId, scope, range.startUtc, range.endUtc, at),
      outcomeRepo.listColumns(ctx.businessId, scope),
      outcomeRepo.countQueue(ctx.businessId, scope, at),
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
