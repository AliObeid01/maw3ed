import { mockReminders } from './mockReminders';
import type { Page, Route } from '@playwright/test';
import { DateTime } from 'luxon';
import { clockNow, freezeClock } from './clock';
import { normalizePhone } from '../../../src/server/domain/phone';
import { catalogue, IDS, SLUG, TZ } from './publicMock';

/**
 * Stateful in-memory stand-in for the receptionist APIs, answered by page.route. It follows the contracts in
 * src/server/contracts (appointments, reminders) and the agreed shapes of the APIs still being built
 * (dashboard summary/today, waitlist activity, clients search). Real status codes are enforced:
 *  - mark-sent: 404 unknown, 409 ALREADY_SENT with error.data { sentBy, sentAt } when already sent,
 *  - POST /api/appointments: strict body, 400 with fields, 409 SLOT_TAKEN with error.data.slots, a repeated
 *    Idempotency-Key replays with 200 and a different booking under the same key answers 422,
 *  - cancel: 404 unknown, idempotent 200,
 *  - dates must be yyyy-MM-dd (400 otherwise).
 */

export const ME = { id: 'e2e-user', name: 'Lina' };
export const RANA = { id: 'u-rana', name: 'Rana' };

type Appt = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  serviceId: string;
  staffId: string;
  client: { id: string; name: string; phone: string; noShows: number };
  confirmedAt: string | null;
};

export type Reminder = {
  id: string;
  kind: 'H24' | 'H2';
  appointmentId: string;
  status: 'PENDING' | 'SENT';
  sentBy: { id: string; name: string } | null;
  sentAt: string | null;
  phoneInvalid?: boolean;
};

export type DashCall = { method: string; path: string; search: string; body?: unknown; key?: string };

export type DashOptions = {
  /** Replaces the default day. */
  appointments?: Appt[];
  reminders?: Reminder[];
  waitlist?: Array<Record<string, unknown>>;
  outcomesToMark?: number;
  /** false: GET /api/clients answers 404 like a server without the endpoint. */
  clientsEndpoint?: boolean;
  clients?: Array<{ id: string; name: string; phone: string; noShows: number; visits?: number }>;
  /** What each POST /api/appointments attempt does, in order (default 'ok'). */
  bookScript?: Array<'ok' | 'taken' | '500' | 'drop-after-commit'>;
  /** What each mark-sent attempt does, in order (default 'ok'). 'conflict' = someone else sent it first. */
  markSentScript?: Array<'ok' | 'conflict' | '500'>;
  bookDelayMs?: number;
  summaryStatus?: number;
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (
  route: Route,
  status: number,
  code: string,
  extra: { fields?: Record<string, string>; data?: unknown } = {},
) =>
  json(route, status, {
    error: {
      code,
      message: code,
      fields: extra.fields ?? {},
      ...(extra.data ? { data: extra.data } : {}),
    },
  });

const iso = (dt: DateTime) => dt.toUTC().toISO({ suppressMilliseconds: true })!;

/** Local time today (business zone) as a UTC instant. `dayOffset` moves by calendar days. */
export function at(hour: number, minute = 0, dayOffset = 0): string {
  const day = clockNow().setZone(TZ).startOf('day').plus({ days: dayOffset });
  return iso(day.set({ hour, minute }));
}
export const todayLocal = () => clockNow().setZone(TZ).toISODate()!;

export const MAYA = { id: 'cl-maya', name: 'Maya Haddad', phone: '+96170555218', noShows: 2 };
export const NADINE = { id: 'cl-nadine', name: 'Nadine Aoun', phone: '+96176418902', noShows: 2 };
export const LEA = { id: 'cl-lea', name: 'Lea Saab', phone: '+9613512774', noShows: 0 };
export const RAMI = { id: 'cl-rami', name: 'Rami Haddad', phone: '+9613640918', noShows: 0 };

export function appt(
  id: string,
  startAt: string,
  durationMin: number,
  serviceId: string,
  staffId: string,
  client: Appt['client'],
  extra: Partial<Appt> = {},
): Appt {
  return {
    id,
    startAt,
    endAt: iso(DateTime.fromISO(startAt).plus({ minutes: durationMin })),
    status: 'BOOKED',
    source: 'PUBLIC',
    serviceId,
    staffId,
    client,
    confirmedAt: null,
    ...extra,
  };
}

export function defaultAppointments(): Appt[] {
  return [
    appt('ap1', at(10), 30, IDS.haircut, IDS.lina, NADINE, { status: 'CONFIRMED', confirmedAt: at(8) }),
    appt('ap2', at(11), 45, IDS.blowdry, IDS.karim, LEA, { status: 'CONFIRMED', confirmedAt: at(8) }),
    appt('ap3', at(12, 30), 20, IDS.beard, IDS.jad, RAMI, { source: 'WAITLIST' }),
    appt('ap4', at(14), 30, IDS.haircut, IDS.lina, MAYA),
    appt('ap5', at(15), 30, IDS.haircut, IDS.karim, LEA, { status: 'CANCELLED' }),
  ];
}

export function defaultReminders(): Reminder[] {
  return [
    { id: 'rm1', kind: 'H2', appointmentId: 'ap1', status: 'PENDING', sentBy: null, sentAt: null },
    { id: 'rm2', kind: 'H24', appointmentId: 'ap4', status: 'PENDING', sentBy: null, sentAt: null },
    { id: 'rm3', kind: 'H24', appointmentId: 'ap2', status: 'PENDING', sentBy: null, sentAt: null, phoneInvalid: true },
    {
      id: 'rm4',
      kind: 'H24',
      appointmentId: 'ap3',
      status: 'SENT',
      sentBy: RANA,
      sentAt: at(9, 14),
    },
  ];
}

const SERVICE_BY_ID = Object.fromEntries(catalogue.services.map((s) => [s.id, s]));
const STAFF_BY_ID = Object.fromEntries(catalogue.staff.map((s) => [s.id, s]));

/** Free slots: from the next quarter hour today (the front-desk API has no minimum notice), then 09:00-17:00. */
function slotsFor(from: string, to: string, staffId: string | undefined, takenStarts: Set<string>) {
  const out: { startAt: string; endAt: string; staffId?: string }[] = [];
  const now = clockNow().setZone(TZ);
  const earliest = now.plus({ minutes: 15 - (now.minute % 15) }).startOf('minute');
  let day = DateTime.fromISO(from, { zone: TZ });
  const last = DateTime.fromISO(to, { zone: TZ });
  while (day <= last) {
    for (let minutes = 9 * 60; minutes < 17 * 60; minutes += 30) {
      const start = day.startOf('day').plus({ minutes });
      if (start < earliest) continue;
      const startAt = iso(start);
      if (takenStarts.has(startAt)) continue;
      out.push({
        startAt,
        endAt: iso(start.plus({ minutes: 30 })),
        ...(staffId ? { staffId } : {}),
      });
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

export async function mockDashboardApi(page: Page, options: DashOptions = {}) {
  await freezeClock(page);
  const appointments = options.appointments ?? defaultAppointments();
  const reminders = options.reminders ?? defaultReminders();
  const calls: DashCall[] = [];
  const taken = new Set<string>();
  const bookings = new Map<string, { body: Record<string, unknown>; phone: string; result: unknown }>();
  let bookAttempt = 0;
  let markAttempt = 0;
  const bookScript = options.bookScript ?? [];
  const markScript = options.markSentScript ?? [];
  const clientsEnabled = options.clientsEndpoint ?? true;
  const clients = options.clients ?? [{ ...MAYA, visits: 6 }];

  const pending = () => reminders.filter((r) => r.status === 'PENDING').length;
  const apptView = (a: Appt) => ({
    id: a.id,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    source: a.source,
    service: {
      id: a.serviceId,
      name: SERVICE_BY_ID[a.serviceId]!.name,
      durationMin: SERVICE_BY_ID[a.serviceId]!.durationMin,
    },
    staff: { id: a.staffId, displayName: STAFF_BY_ID[a.staffId]!.displayName },
    client: { ...a.client, repeatNoShow: a.client.noShows >= 2 },
    confirmedAt: a.confirmedAt,
    reminders: {
      whatsappPending: reminders.some((r) => r.appointmentId === a.id && r.status === 'PENDING'),
    },
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const postData = request.postData();
    const body = postData ? (JSON.parse(postData) as Record<string, unknown>) : undefined;
    calls.push({
      method,
      path,
      search: url.search,
      body,
      key: request.headers()['idempotency-key'],
    });

    if (path === '/api/dashboard/summary') {
      if (options.summaryStatus) return apiError(route, options.summaryStatus, 'UNAUTHORIZED');
      return json(route, 200, {
        whatsappDue: pending(),
        outcomesToMark: options.outcomesToMark ?? 2,
      });
    }

    if (path === '/api/dashboard/today') {
      const date = url.searchParams.get('date') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { date: 'Use a date like 2026-11-10.' } });
      }
      const day = appointments
        .filter((a) => DateTime.fromISO(a.startAt).setZone(TZ).toISODate() === date)
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      const live = day.filter((a) => a.status !== 'CANCELLED');
      return json(route, 200, {
        date,
        timezone: TZ,
        stats: {
          appointments: live.length,
          confirmed: live.filter((a) => a.status === 'CONFIRMED').length,
          noReply: live.filter((a) => a.status === 'BOOKED').length,
          // The mock treats a refill as claimed on its appointment's day (the real tile follows the claim day, F45).
          refilledFromWaitlist: live.filter((a) => a.source === 'WAITLIST').length,
        },
        whatsappDue: pending(),
        outcomesToMark: options.outcomesToMark ?? 2,
        staff: catalogue.staff.map((s) => ({ id: s.id, displayName: s.displayName })),
        appointments: day.map(apptView),
        extraFieldFromANewerServer: true,
      });
    }

    if (path === '/api/waitlist/activity') {
      return json(route, 200, {
        items: options.waitlist ?? [
          {
            type: 'CLAIMED',
            at: at(9),
            offerId: 'of1',
            slot: {
              startAt: at(12, 30),
              service: { id: IDS.beard, name: 'Beard trim' },
              staff: { id: IDS.jad, displayName: 'Jad' },
            },
            offeredTo: 3,
            claimedBy: { name: 'Rami' },
          },
        ],
      });
    }

    if (path === '/api/reminders/whatsapp-due') {
      const items = reminders.map((r) => {
        const a = appointments.find((x) => x.id === r.appointmentId)!;
        return {
          id: r.id,
          kind: r.kind,
          dueAt: at(8),
          appointment: {
            id: a.id,
            startAt: a.startAt,
            service: { id: a.serviceId, name: SERVICE_BY_ID[a.serviceId]!.name },
            staff: { id: a.staffId, displayName: STAFF_BY_ID[a.staffId]!.displayName },
          },
          client: { name: a.client.name, phone: a.client.phone, noShows: a.client.noShows },
          whatsappUrl: r.phoneInvalid ? null : `https://wa.me/${a.client.phone.replace('+', '')}?text=hello`,
          phoneInvalid: !!r.phoneInvalid,
          status: r.status,
          sentBy: r.sentBy,
          sentAt: r.sentAt,
        };
      });
      return json(route, 200, { count: pending(), items });
    }

    const mark = /^\/api\/reminders\/([^/]+)\/mark-sent$/.exec(path);
    if (mark && method === 'POST') {
      const reminder = reminders.find((r) => r.id === mark[1]);
      if (!reminder) return apiError(route, 404, 'NOT_FOUND');
      markAttempt += 1;
      const step = markScript[markAttempt - 1] ?? 'ok';
      if (step === '500') return apiError(route, 500, 'INTERNAL');
      if (step === 'conflict' && reminder.status === 'PENDING') {
        reminder.status = 'SENT';
        reminder.sentBy = RANA;
        reminder.sentAt = at(9, 14);
      }
      if (reminder.status === 'SENT') {
        return apiError(route, 409, 'ALREADY_SENT', {
          data: { sentBy: reminder.sentBy, sentAt: reminder.sentAt },
        });
      }
      reminder.status = 'SENT';
      reminder.sentBy = ME;
      reminder.sentAt = iso(clockNow());
      return json(route, 200, {
        id: reminder.id,
        status: 'SENT',
        sentBy: reminder.sentBy,
        sentAt: reminder.sentAt,
      });
    }

    const cancel = /^\/api\/appointments\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === 'POST') {
      const found = appointments.find((a) => a.id === cancel[1]);
      if (!found) return apiError(route, 404, 'NOT_FOUND');
      found.status = 'CANCELLED';
      return json(route, 200, { appointment: apptView(found) });
    }

    if (path === '/api/clients') {
      if (!clientsEnabled) return apiError(route, 404, 'NOT_FOUND');
      const digits = (url.searchParams.get('search') ?? '').replace(/\D/g, '');
      return json(route, 200, {
        clients: clients.filter((c) => digits.length > 0 && c.phone.replace(/\D/g, '').includes(digits)),
      });
    }

    const publicMatch = /^\/api\/public\/([^/]+)(\/slots)?$/.exec(path);
    if (publicMatch) {
      if (publicMatch[1] !== SLUG) return apiError(route, 404, 'NOT_FOUND');
      if (!publicMatch[2]) return json(route, 200, catalogue);
      const q = url.searchParams;
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { from: 'Use a date.' } });
      }
      if (!SERVICE_BY_ID[q.get('serviceId') ?? '']) return apiError(route, 404, 'NOT_FOUND');
      return json(route, 200, { slots: slotsFor(from, to, q.get('staffId') ?? undefined, taken) });
    }

    if (path === '/api/appointments' && method === 'POST') {
      const key = request.headers()['idempotency-key'];
      const b = (body ?? {}) as {
        serviceId?: string;
        staffId?: string;
        startAt?: string;
        client?: { name?: string; phone?: string; email?: string };
      };
      const unknown = [
        ...Object.keys(b).filter((k) => !['serviceId', 'staffId', 'startAt', 'client'].includes(k)),
        ...Object.keys(b.client ?? {}).filter((k) => !['name', 'phone', 'email'].includes(k)),
      ];
      if (unknown.length) {
        return apiError(route, 400, 'VALIDATION_FAILED', {
          fields: Object.fromEntries(unknown.map((k) => [k, 'Unknown field.'])),
        });
      }
      const fields: Record<string, string> = {};
      if (!b.client?.name?.trim()) fields['client.name'] = 'Too small: expected string to have >=1 characters';
      if (!b.client?.phone || !normalizePhone(b.client.phone)) fields['client.phone'] = 'Enter a valid phone number.';
      if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });
      if (options.bookDelayMs) await new Promise((r) => setTimeout(r, options.bookDelayMs));

      const phone = normalizePhone(b.client!.phone!)!;
      if (key && bookings.has(key)) {
        const first = bookings.get(key)!;
        const same =
          first.body.serviceId === b.serviceId &&
          first.body.staffId === b.staffId &&
          first.body.startAt === b.startAt &&
          first.phone === phone;
        if (!same) return apiError(route, 422, 'IDEMPOTENCY_KEY_REUSED');
        return json(route, 200, first.result);
      }

      bookAttempt += 1;
      const step = bookScript[bookAttempt - 1] ?? 'ok';
      const day = DateTime.fromISO(b.startAt!).setZone(TZ).toISODate()!;
      const staffForSlots = b.staffId === 'anyone' ? undefined : b.staffId;
      if (step === 'taken' || taken.has(b.startAt!)) {
        taken.add(b.startAt!);
        return apiError(route, 409, 'SLOT_TAKEN', {
          data: { slots: slotsFor(day, day, staffForSlots, taken) },
        });
      }
      if (step === '500') return apiError(route, 500, 'INTERNAL');

      const service = SERVICE_BY_ID[b.serviceId ?? ''];
      if (!service) return apiError(route, 404, 'NOT_FOUND');
      const staff = STAFF_BY_ID[b.staffId ?? ''] ?? catalogue.staff[0]!;
      const id = `new${bookings.size + 1}`;
      const endAt = iso(DateTime.fromISO(b.startAt!).plus({ minutes: service.durationMin }));
      appointments.push({
        id,
        startAt: b.startAt!,
        endAt,
        status: 'BOOKED',
        source: 'FRONT_DESK',
        serviceId: service.id,
        staffId: staff.id,
        client: { id: `cl-${id}`, name: b.client!.name!, phone, noShows: 0 },
        confirmedAt: null,
      });
      const result = {
        appointment: {
          id,
          startAt: b.startAt,
          endAt,
          status: 'BOOKED',
          service: { id: service.id, name: service.name, durationMin: service.durationMin, price: service.price },
          staff: { id: staff.id, displayName: staff.displayName },
        },
        links: { manage: '/l/mock-manage-token' },
        reminders: mockReminders(b.startAt!, !!b.client?.email),
      };
      taken.add(b.startAt!);
      if (key) bookings.set(key, { body: b, phone, result });
      if (step === 'drop-after-commit') return route.abort('connectionreset');
      return json(route, 201, result);
    }

    return apiError(route, 404, 'NOT_FOUND');
  });

  return { calls, appointments, reminders, bookings, pending };
}
