import { isRepeatNoShow } from '@/server/domain/clientFlags';
import { effectiveEmail } from '@/server/domain/contactEmail';
import { MAX_APPOINTMENT_RANGE_DAYS, resolveLocalRange } from '@/server/domain/dateRange';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { book, defaultBookDeps, type BookDeps } from './booking';
import { onSlotFreed } from './slotFreed';

type Row = NonNullable<Awaited<ReturnType<typeof appointmentRepo.findById>>>;

const toItem = (a: Row) => ({
  id: a.id,
  startAt: a.startAt,
  endAt: a.endAt,
  status: a.status,
  source: a.source,
  client: { ...a.client, repeatNoShow: isRepeatNoShow(a.client.noShows) },
  service: {
    id: a.service.id,
    name: a.service.name,
    durationMin: a.service.durationMin,
    price: Number(a.service.price.toString()),
  },
  staff: a.staff,
});

/**
 * "Reminders go to ..." (staff screen only). The SAME `effectiveEmail` the reminder runner uses, so the
 * line can never promise an address the runner would skip. Never logged, never in a public shape.
 */
async function withReminderEmail(ctx: SessionContext, row: Row) {
  const src = await appointmentRepo.reminderSources(ctx.businessId, row.id);
  const recordEmail = src?.client.email?.trim().toLowerCase() || null;
  const reminderEmail = effectiveEmail(src?.contactEmail, src?.client.email);
  return {
    ...toItem(row),
    reminderEmail,
    reminderEmailDiffers: reminderEmail !== null && reminderEmail.toLowerCase() !== recordEmail,
  };
}

export const appointmentsService = {
  async list(
    ctx: SessionContext,
    q: { from: string; to: string; staffId?: string | undefined },
    now: () => Date = () => new Date(),
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const business = await publicBusinessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const range = resolveLocalRange({
      from: q.from,
      to: q.to,
      timezone: business.timezone,
      maxDays: MAX_APPOINTMENT_RANGE_DAYS,
      now: now(),
    });
    if (!range.ok) throw AppError.validation(range.fields);
    if (q.staffId && !(await availabilityRepo.staffExists(ctx.businessId, q.staffId)))
      throw AppError.notFound();
    const rows = await appointmentRepo.list(ctx.businessId, {
      startUtc: range.startUtc,
      endUtc: range.endUtc,
      staffId: q.staffId,
    });
    return { appointments: rows.map(toItem) };
  },

  async get(ctx: SessionContext, id: string) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const row = await appointmentRepo.findById(ctx.businessId, id);
    if (!row) throw AppError.notFound();
    return { appointment: await withReminderEmail(ctx, row) };
  },

  /**
   * F69-C: correct THIS booking's contact email / name. Only the appointment's own columns change; the client
   * record never does. Another business's id is a 404. Past / cancelled / attended: 409.
   */
  async updateContact(
    ctx: SessionContext,
    id: string,
    change: { contactEmail?: string | null | undefined; contactName?: string | null | undefined },
    now: () => Date = () => new Date(),
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const res = await appointmentRepo.updateContact(ctx.businessId, id, change, now());
    if (res.kind === 'not_found') throw AppError.notFound();
    if (res.kind === 'not_editable')
      throw AppError.conflict(
        'APPOINTMENT_NOT_EDITABLE',
        undefined,
        'This appointment can no longer be edited.',
      );
    if (res.kind === 'email_required')
      throw AppError.validation({
        contactEmail: 'A booking made on the public page needs an email address.',
      });
    ctx.logger.info(
      { businessId: ctx.businessId, appointmentId: id, requeued: res.requeued },
      'appointment contact details corrected',
    );
    const row = await appointmentRepo.findById(ctx.businessId, id);
    if (!row) throw AppError.notFound();
    return { appointment: await withReminderEmail(ctx, row) };
  },

  /** Front-desk booking: same engine as the public page; the business comes from the session. */
  async book(
    ctx: SessionContext,
    body: {
      serviceId: string;
      staffId: string;
      startAt: string;
      client: { name: string; phone: string; email?: string | undefined };
    },
    idempotencyKey: string | undefined,
    deps: BookDeps = defaultBookDeps,
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    return book(
      ctx,
      {
        serviceId: body.serviceId,
        staffId: body.staffId,
        startAt: new Date(body.startAt),
        client: body.client,
        source: 'FRONT_DESK',
        ignoreMinNotice: true, // reception can book a client who is walking in now
        idempotencyKey,
      },
      deps,
    );
  },

  /** Idempotent: cancelling a cancelled appointment succeeds; one with an outcome is a conflict. */
  async cancel(ctx: SessionContext, id: string, now: () => Date = () => new Date()) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const current = await appointmentRepo.findById(ctx.businessId, id);
    if (!current) throw AppError.notFound();
    if (current.status !== 'CANCELLED') {
      const done = await appointmentRepo.cancelByStaff(ctx.businessId, id, now());
      if (!done) {
        const latest = await appointmentRepo.findById(ctx.businessId, id);
        if (!latest) throw AppError.notFound();
        if (latest.status !== 'CANCELLED')
          throw AppError.conflict(
            'CONFLICT',
            undefined,
            'This appointment can no longer be cancelled.',
          );
      } else {
        ctx.logger.info({ businessId: ctx.businessId, appointmentId: id }, 'appointment cancelled');
        try {
          await onSlotFreed(ctx, {
            appointmentId: id,
            serviceId: current.service.id,
            staffId: current.staff.id,
            startAt: current.startAt,
            endAt: current.endAt,
          });
        } catch {
          ctx.logger.error(
            { businessId: ctx.businessId, appointmentId: id },
            'onSlotFreed failed after a committed cancel',
          );
        }
      }
    }
    const row = await appointmentRepo.findById(ctx.businessId, id);
    if (!row) throw AppError.notFound();
    return { appointment: await withReminderEmail(ctx, row) };
  },
};
