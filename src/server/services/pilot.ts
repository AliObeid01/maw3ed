import { toCsv } from '@/server/domain/csv';
import { MAX_EXPORT_RANGE_DAYS, resolveLocalRange } from '@/server/domain/dateRange';
import {
  addRow,
  baselineRate,
  changeVsBaseline,
  daysCovered,
  emptyCounts,
  localDateOf,
  noShowRate,
  round1,
  validateBaseline,
  weekWindows,
  weeklyCounts,
  type BaselineInput,
} from '@/server/domain/pilotMetrics';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { outcomeRepo } from '@/server/repositories/outcome.repo';
import { pilotRepo } from '@/server/repositories/pilot.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { DateTime } from 'luxon';

type Now = () => Date;
const realNow: Now = () => new Date();

const r1 = (n: number | null) => (n === null ? null : round1(n));
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const baselineDto = (
  b: {
    fromDate: Date;
    toDate: Date;
    appointments: number;
    noShows: number;
    lateCancels: number;
  } | null,
) =>
  b
    ? {
        fromDate: dateOnly(b.fromDate),
        toDate: dateOnly(b.toDate),
        appointments: b.appointments,
        noShows: b.noShows,
        lateCancels: b.lateCancels,
      }
    : null;

async function businessOf(ctx: SessionContext) {
  const business = await publicBusinessRepo.findById(ctx.businessId);
  if (!business) throw AppError.notFound();
  return business;
}

export const pilotService = {
  async getBaseline(ctx: SessionContext) {
    requireRole(ctx, 'OWNER');
    return { baseline: baselineDto(await pilotRepo.getBaseline(ctx.businessId)) };
  },

  async putBaseline(ctx: SessionContext, body: BaselineInput, now: Now = realNow) {
    requireRole(ctx, 'OWNER');
    const business = await businessOf(ctx);
    const fields = validateBaseline(body, localDateOf(now(), business.timezone));
    if (Object.keys(fields).length) throw AppError.validation(fields);
    const saved = await pilotRepo.upsertBaseline(ctx.businessId, {
      fromDate: asDate(body.fromDate),
      toDate: asDate(body.toDate),
      appointments: body.appointments,
      noShows: body.noShows,
      lateCancels: body.lateCancels,
    });
    return { baseline: baselineDto(saved) };
  },

  /**
   * Pilot report. Window: from the first appointment's local date (or the business creation date when there
   * is none) to today, over appointments that have started. Rates are percentages rounded to 1 decimal here
   * and only here.
   *
   * confirmRate = of the appointments that had at least one H24 or H2 reminder SENT (email or WhatsApp),
   * the share with confirmedAt set (confirmed by link at any time).
   * waitlistRefillRate = appointments with source WAITLIST / (CANCELLED + LATE_CANCEL appointments).
   */
  async report(ctx: SessionContext, weeks: number, now: Now = realNow) {
    requireRole(ctx, 'OWNER');
    const business = await businessOf(ctx);
    const at = now();
    const tz = business.timezone;
    const [baseline, rows, first, signal, createdAt] = await Promise.all([
      pilotRepo.getBaseline(ctx.businessId),
      outcomeRepo.listForReport(ctx.businessId, at),
      outcomeRepo.firstStart(ctx.businessId),
      pilotRepo.reminderConfirmSignal(ctx.businessId),
      pilotRepo.businessCreatedAt(ctx.businessId),
    ]);

    const totals = emptyCounts();
    let viaLink = 0;
    let refills = 0;
    let cancellations = 0;
    for (const r of rows) {
      addRow(totals, r);
      if (r.cancelledVia === 'LINK') viaLink += 1;
      if (r.status === 'CANCELLED' || r.status === 'LATE_CANCEL') cancellations += 1;
      if (r.source === 'WAITLIST' && r.status !== 'CANCELLED') refills += 1;
    }

    const toDate = localDateOf(at, tz);
    const fromDate = localDateOf(first ?? createdAt ?? at, tz);
    const rate = noShowRate(totals.attended, totals.noShows);
    const base = baseline ? baselineRate(baseline.appointments, baseline.noShows) : null;
    const change = changeVsBaseline(rate, base);

    return {
      baseline: baselineDto(baseline),
      pilot: {
        fromDate: fromDate <= toDate ? fromDate : toDate,
        toDate,
        daysCovered: daysCovered(fromDate <= toDate ? fromDate : toDate, toDate),
        ...totals,
        noShowRate: r1(rate),
        baselineRate: r1(base),
        changePoints: r1(change.changePoints),
        changeRelativePct: r1(change.changeRelativePct),
      },
      weekly: weeklyCounts(rows, weekWindows(at, tz, weeks)).map((w) => ({
        ...w,
        noShowRate: r1(w.noShowRate),
      })),
      signals: {
        confirmRate:
          signal.remindedAppointments === 0
            ? null
            : round1((signal.confirmedAfterReminder / signal.remindedAppointments) * 100),
        cancellationsViaLink: viaLink,
        waitlistRefills: refills,
        waitlistRefillRate: cancellations === 0 ? null : round1((refills / cancellations) * 100),
      },
    };
  },

  async exportCsv(ctx: SessionContext, q: { from: string; to: string }, now: Now = realNow) {
    requireRole(ctx, 'OWNER');
    const business = await businessOf(ctx);
    const range = resolveLocalRange({
      from: q.from,
      to: q.to,
      timezone: business.timezone,
      maxDays: MAX_EXPORT_RANGE_DAYS,
      now: now(),
    });
    if (!range.ok) throw AppError.validation(range.fields);
    const rows = await outcomeRepo.listForExport(ctx.businessId, range.startUtc, range.endUtc);
    const local = (d: Date) => DateTime.fromMillis(d.getTime(), { zone: business.timezone });
    const body = toCsv(
      [
        'date',
        'start',
        'end',
        'service',
        'staff',
        'client name',
        'client phone',
        'status',
        'source',
        'confirmedAt',
        'outcomeMarkedAt',
      ],
      rows.map((r) => [
        local(r.startAt).toISODate(),
        local(r.startAt).toFormat('HH:mm'),
        local(r.endAt).toFormat('HH:mm'),
        r.service.name,
        r.staff.displayName,
        r.client.name,
        r.client.phone,
        r.status,
        r.source,
        r.confirmedAt?.toISOString() ?? '',
        r.outcomeMarkedAt?.toISOString() ?? '',
      ]),
    );
    ctx.logger.info({ businessId: ctx.businessId, rows: rows.length }, 'pilot csv exported');
    return { body, filename: `maw3ed-${business.slug}-${range.from}-to-${range.to}.csv` };
  },
};
