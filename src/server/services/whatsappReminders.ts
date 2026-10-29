import { sendDecision } from '@/server/domain/reminderWindows';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { whatsappUrl } from '@/server/domain/whatsapp';
import { ACTIVE_APPOINTMENT_STATUSES } from '@/server/domain/appointmentStatus';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { renderWhatsappMessage } from '@/server/i18n/emailRender';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';

const SENT_VISIBLE_MS = 12 * 3_600_000;

export interface WhatsappDeps {
  now: () => Date;
  linkSecret: () => string;
  appUrl: () => string;
}
const defaults: WhatsappDeps = {
  now: () => new Date(),
  linkSecret: () => requireLinkSecret(),
  appUrl: () => getServerEnv().APP_URL,
};

export const whatsappRemindersService = {
  async due(ctx: SessionContext, deps: WhatsappDeps = defaults) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const now = deps.now();
    const secret = deps.linkSecret();
    const appUrl = deps.appUrl().replace(/\/+$/, '');
    if (secret.length < 32 || !/^https?:\/\//.test(appUrl)) throw misconfiguredError();
    const business = await publicBusinessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    const rows = await reminderJobRepo.listWhatsapp(
      ctx.businessId,
      now,
      new Date(now.getTime() - SENT_VISIBLE_MS),
    );

    const items = [];
    for (const r of rows) {
      const a = r.appointment;
      const kind = r.kind as 'H24' | 'H2';
      if (r.status === 'PENDING') {
        const active = (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status);
        if (sendDecision(kind, a.startAt, now, active) === 'SKIP') continue;
      }
      const link = (act: 'confirm' | 'cancel') =>
        `${appUrl}/l/${signToken({ a: a.id, act, exp: expiryFor(a.startAt) }, secret)}`;
      const text = renderWhatsappMessage({
        kind,
        locale: business.locale,
        timezone: business.timezone,
        businessName: business.name,
        clientName: a.client.name,
        serviceName: a.service.name,
        staffName: a.staff.displayName,
        startAt: a.startAt,
        confirmUrl: link('confirm'),
        cancelUrl: link('cancel'),
      });
      let url: string | null = null;
      try {
        url = whatsappUrl(a.client.phone, text);
      } catch {
        // A stored phone that is not E.164 must not break the whole list: flag it (id only, no PII).
        ctx.logger.warn(
          { businessId: ctx.businessId, jobId: r.id },
          'whatsapp reminder has an invalid phone',
        );
      }
      items.push({
        id: r.id,
        kind,
        dueAt: r.dueAt,
        appointment: { id: a.id, startAt: a.startAt, service: a.service, staff: a.staff },
        client: { name: a.client.name, phone: a.client.phone, noShows: a.client.noShows },
        whatsappUrl: url,
        phoneInvalid: url === null,
        status: r.status as 'PENDING' | 'SENT',
        sentBy: r.sentBy,
        sentAt: r.sentAt,
      });
    }
    return { count: items.filter((i) => i.status === 'PENDING').length, items };
  },

  async markSent(ctx: SessionContext, id: string, now: () => Date = () => new Date()) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const at = now();
    const won = await reminderJobRepo.markWhatsappSent(ctx.businessId, id, ctx.userId, at);
    const row = await reminderJobRepo.findWhatsapp(ctx.businessId, id);
    if (!row) throw AppError.notFound();
    if (!won) {
      if (row.status === 'SENT')
        throw AppError.conflict(
          'ALREADY_SENT',
          { sentBy: row.sentBy, sentAt: row.sentAt },
          'Someone already sent this reminder.',
        );
      throw AppError.conflict('CONFLICT', undefined, 'This reminder is no longer pending.');
    }
    ctx.logger.info(
      { businessId: ctx.businessId, jobId: id, kind: row.kind },
      'whatsapp reminder marked sent',
    );
    return { id, status: 'SENT' as const, sentBy: row.sentBy, sentAt: row.sentAt };
  },
};
