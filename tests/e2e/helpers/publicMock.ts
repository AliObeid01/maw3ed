import { mockReminders } from './mockReminders';
import type { Page, Route } from '@playwright/test';
import { DateTime } from 'luxon';
import { clockNow, FIXED_NOW, freezeClock, nowMs } from './clock';
import { normalizePhone } from '../../../src/server/domain/phone';

/**
 * In-memory stand-in for the public booking API and the signed-link API, answered by page.route.
 * The mocks enforce the real contracts (see src/server/contracts/booking.ts and the booking service):
 *  - ids are cuid2-shaped, the slug is validated like SlugParams (a malformed one is a 400),
 *  - `Idempotency-Key` is required (8-100 safe chars), the booking body is strict,
 *  - slots: from <= to, at most 31 days, `to` within bookingWindowDays (400 fields.to otherwise), minimum notice,
 *  - phones are normalised with the server's own normalizePhone (libphonenumber, region LB),
 *  - SLOT_TAKEN carries `error.data.slots` (the whole local day), a repeated key replays with 200, a key reused for
 *    a different booking (service, staff, start, phone) answers 422,
 *  - the link mock answers 403 WRONG_LINK_ACTION for the wrong token type and can answer 409.
 */
export const TZ = 'Asia/Beirut';
export const SLUG = 'studio-nour';

/** cuid2-shaped ids: lowercase letters and digits, starting with a letter. */
export const IDS = {
  haircut: 'hc4s8k2m9q1w7e3r5t6y8u0i',
  blowdry: 'bd7a1s3d5f7g9h2j4k6l8z0x',
  beard: 'bt9p2o4i6u8y1t3r5e7w9q0a',
  lina: 'ln3m5n7b9v1c2x4z6a8s0d2f',
  karim: 'kr6g8h1j3k5l7q9w2e4r6t8y',
  jad: 'jd2u4i6o8p1a3s5d7f9g1h3j',
} as const;

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

export const catalogue = {
  business: {
    name: 'Studio Nour',
    slug: SLUG,
    timezone: TZ,
    locale: 'en',
    category: 'Hair salon',
    area: 'sidon',
    address: 'Hamra, Beirut',
  },
  services: [
    { id: IDS.haircut, name: 'Haircut', durationMin: 30, bufferMin: 10, price: 15 },
    { id: IDS.blowdry, name: 'Blow-dry', durationMin: 45, bufferMin: 10, price: 20 },
    { id: IDS.beard, name: 'Beard trim', durationMin: 20, bufferMin: 5, price: 8 },
  ],
  staff: [
    { id: IDS.lina, displayName: 'Lina', serviceIds: [IDS.haircut, IDS.blowdry] },
    { id: IDS.karim, displayName: 'Karim', serviceIds: [IDS.haircut, IDS.blowdry] },
    // Beard trim is offered by Jad only, so the staff step is skipped for it.
    { id: IDS.jad, displayName: 'Jad', serviceIds: [IDS.haircut, IDS.beard] },
  ],
};

const TIMES = ['09:00', '09:30', '10:30', '14:00', '15:30'];
const MIN_NOTICE_MIN = 60;

/** What one booking attempt does, in order (attempt n uses script[n-1], default 'ok'). */
export type Attempt =
  | 'ok'
  /** Someone else took the slot: 409 SLOT_TAKEN with the fresh slots of that day. */
  | 'taken'
  | '500'
  | '429'
  /** Connection dropped before any answer; nothing committed. */
  | 'drop'
  /** Committed on the server, then the connection drops: the retry must replay (200). */
  | 'drop-after-commit'
  /** A 400 that is not about a client field (the key is spent). */
  | 'bad-request';

export type PublicMockOptions = {
  script?: Attempt[];
  /** Shortcuts for the first attempt. */
  takeSlotOnFirstBook?: boolean;
  failFirstWith500?: boolean;
  dropFirstResponse?: boolean;
  /** Delay the booking answer (ms) to look at pending state and double submits. */
  bookDelayMs?: number;
  /** Answer the booking with 400 fields['client.phone']. */
  rejectPhone?: boolean;
  /** Answer 400 for client.email as the server does for a missing address (F68), whatever was typed. */
  rejectEmail?: boolean;
  businessDelayMs?: number;
  slotsDelayMs?: number;
  /** Booking window of the business (days ahead). Default 30. */
  windowDays?: number;
  /** Published as business.bookingWindowDays (omitted when unset, like an older server). Also the server limit unless windowDays is set. */
  bookingWindowDays?: number;
  /** What GET /api/public/{slug} publishes as bookingWindowDays from its SECOND call on (the owner changed it meanwhile). */
  refreshedBookingWindowDays?: number;
  /** Published as business.cancelCutoffMin (omitted when unset). */
  cancelCutoffMin?: number;
  /** Business timezone (default Asia/Beirut); slots, the booking day and the window limit follow it. */
  timezone?: string;
  /** Local times that are already booked (excluded from every slots answer). */
  bookedTimes?: string[];
  /** What the booking answers in `reminders` (default: from the slot's lead time, like the server). */
  reminders?: { h24: boolean; h2: boolean; email: boolean };
};

export type BookingCall = {
  key: string | undefined;
  body: {
    serviceId: string;
    staffId: string;
    startAt: string;
    client: { name: string; phone: string; email?: string };
  };
};

/**
 * "Today" in the business timezone, taken from the suite's FIXED start instant and NOT from the ticking
 * clock. The mock's slot list and the specs' expectations both read it here, so a run that crosses midnight in
 * the business zone (E2E_NOW=23:55 and a slow test) cannot make them pick different days (F59).
 */
export const businessToday = (tz: string = TZ): DateTime => DateTime.fromJSDate(FIXED_NOW, { zone: tz }).startOf('day');

/** The next local day (tomorrow or later) that has slots in the mock: never a Sunday. */
export function firstBookableDay(tz: string = TZ): string {
  let day = businessToday(tz).plus({ days: 1 });
  while (day.weekday === 7) day = day.plus({ days: 1 });
  return day.toISODate()!;
}

function slotsFor(
  from: string,
  to: string,
  staffId: string | undefined,
  taken: Set<string>,
  booked: string[],
  tz: string = TZ,
) {
  const out: { startAt: string; endAt: string; staffId?: string }[] = [];
  const today = businessToday(tz);
  const earliest = clockNow().plus({ minutes: MIN_NOTICE_MIN });
  let day = DateTime.fromISO(from, { zone: tz });
  const last = DateTime.fromISO(to, { zone: tz });
  while (day <= last) {
    if (day > today && day.weekday !== 7) {
      for (const time of TIMES) {
        if (booked.includes(time)) continue;
        const [h, m] = time.split(':').map(Number);
        const start = day.set({ hour: h, minute: m });
        if (start < earliest) continue;
        const startAt = start.toUTC().toISO({ suppressMilliseconds: true })!;
        if (taken.has(startAt)) continue;
        out.push({
          startAt,
          endAt: start.plus({ minutes: 30 }).toUTC().toISO({ suppressMilliseconds: true })!,
          ...(staffId ? { staffId } : {}),
        });
      }
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

export async function mockPublicApi(page: Page, options: PublicMockOptions = {}) {
  await freezeClock(page);
  const taken = new Set<string>();
  const bookings = new Map<string, { body: BookingCall['body']; phone: string; result: unknown }>();
  const calls: BookingCall[] = [];
  const slotRequests: string[] = [];
  let businessRequests = 0;
  const tz = options.timezone ?? TZ;
  const windowDays = options.windowDays ?? options.bookingWindowDays ?? 30;
  const publicCatalogue = {
    ...catalogue,
    business: {
      ...catalogue.business,
      timezone: tz,
      ...(options.bookingWindowDays === undefined ? {} : { bookingWindowDays: options.bookingWindowDays }),
      ...(options.cancelCutoffMin === undefined ? {} : { cancelCutoffMin: options.cancelCutoffMin }),
    },
  };
  const script: Attempt[] = options.script ?? [
    ...(options.takeSlotOnFirstBook ? (['taken'] as const) : []),
    ...(options.failFirstWith500 ? (['500'] as const) : []),
    ...(options.dropFirstResponse ? (['drop-after-commit'] as const) : []),
  ];
  let attempts = 0;

  await page.route('**/api/public/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const match = /^\/api\/public\/([^/]+)(\/slots|\/bookings)?$/.exec(url.pathname);
    if (!match) return apiError(route, 404, 'NOT_FOUND');
    const slug = decodeURIComponent(match[1]!);
    // SlugParams: trimmed, lower-cased, 1-80 characters (anything else is a 400).
    if (slug.length < 1 || slug.length > 80 || slug !== slug.trim().toLowerCase() || /[^a-z0-9-]/.test(slug)) {
      return apiError(route, 400, 'VALIDATION_FAILED', { fields: { slug: 'Invalid.' } });
    }
    if (slug !== SLUG) return apiError(route, 404, 'NOT_FOUND');

    if (!match[2]) {
      if (options.businessDelayMs) await new Promise((r) => setTimeout(r, options.businessDelayMs));
      businessRequests += 1;
      if (businessRequests > 1 && options.refreshedBookingWindowDays !== undefined) {
        return json(route, 200, {
          ...publicCatalogue,
          business: { ...publicCatalogue.business, bookingWindowDays: options.refreshedBookingWindowDays },
        });
      }
      return json(route, 200, publicCatalogue);
    }

    if (match[2] === '/slots') {
      slotRequests.push(url.search);
      if (options.slotsDelayMs) await new Promise((r) => setTimeout(r, options.slotsDelayMs));
      const q = url.searchParams;
      const fields: Record<string, string> = {};
      const date = /^\d{4}-\d{2}-\d{2}$/;
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      if (!/^[0-9a-z]+$/.test(q.get('serviceId') ?? '')) fields.serviceId = 'Invalid id.';
      if (!date.test(from) || !DateTime.fromISO(from).isValid) fields.from = 'Use a date like 2026-11-10.';
      if (!date.test(to) || !DateTime.fromISO(to).isValid) fields.to = 'Use a date like 2026-11-10.';
      if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });
      const first = DateTime.fromISO(from, { zone: 'utc' });
      const last = DateTime.fromISO(to, { zone: 'utc' });
      const span = Math.round(last.diff(first, 'days').days) + 1;
      const today = clockNow().setZone(tz);
      const limit = DateTime.fromObject({ year: today.year, month: today.month, day: today.day }, { zone: 'utc' }).plus({
        days: windowDays,
      });
      if (span < 1) fields.to = 'The end date must not be before the start date.';
      else if (span > 31) fields.to = 'The range is at most 31 days.';
      else if (last > limit) fields.to = `Bookings open up to ${windowDays} days ahead.`;
      if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });

      const service = catalogue.services.find((s) => s.id === q.get('serviceId'));
      const staffId = q.get('staffId') ?? undefined;
      const staff = staffId
        ? catalogue.staff.find((s) => s.id === staffId && service && (s.serviceIds as string[]).includes(service.id))
        : true;
      if (!service || !staff) return apiError(route, 404, 'NOT_FOUND');
      return json(route, 200, {
        slots: slotsFor(from, to, staffId, taken, options.bookedTimes ?? [], tz),
      });
    }

    // ---- POST /bookings ----
    const key = request.headers()['idempotency-key'];
    if (!key || !/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
      return apiError(route, 400, 'VALIDATION_FAILED', {
        fields: { 'idempotency-key': 'Send an Idempotency-Key header.' },
      });
    }
    const body = JSON.parse(request.postData() ?? '{}') as BookingCall['body'];
    const allowedTop = ['serviceId', 'staffId', 'startAt', 'client'];
    const allowedClient = ['name', 'phone', 'email'];
    const unknown = [
      ...Object.keys(body).filter((k) => !allowedTop.includes(k)),
      ...Object.keys(body.client ?? {}).filter((k) => !allowedClient.includes(k)),
    ];
    if (unknown.length) {
      return apiError(route, 400, 'VALIDATION_FAILED', {
        fields: Object.fromEntries(unknown.map((k) => [k, 'Unknown field.'])),
      });
    }
    const idOk = (id: string) => /^[0-9a-z]+$/.test(id);
    const fields: Record<string, string> = {};
    if (!idOk(body.serviceId ?? '')) fields.serviceId = 'Invalid id.';
    if (body.staffId !== 'anyone' && !idOk(body.staffId ?? '')) fields.staffId = 'Invalid id.';
    if (!body.client?.name?.trim()) fields['client.name'] = 'Too small: expected string to have >=1 characters';
    else if (body.client.name.trim().length > 80)
      fields['client.name'] = 'Too big: expected string to have <=80 characters';
    if (options.rejectPhone || (body.client?.phone ?? '').length > 32) {
      fields['client.phone'] = 'Enter a valid phone number.';
    }
    // F68: the public route requires a valid email (mirrors the Zod body).
    if (options.rejectEmail || body.client?.email === undefined)
      fields['client.email'] = 'Invalid input: expected string, received undefined';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.client.email))
      fields['client.email'] = 'Invalid email address';
    if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });

    calls.push({ key, body });
    if (options.bookDelayMs) await new Promise((r) => setTimeout(r, options.bookDelayMs));

    const phone = normalizePhone(body.client.phone);
    if (!phone) {
      return apiError(route, 400, 'VALIDATION_FAILED', {
        fields: { 'client.phone': 'Enter a valid phone number.' },
      });
    }

    const replay = bookings.get(key);
    if (replay) {
      // Same request = same service, staff, start and phone (the name and email do not count).
      const same =
        replay.body.serviceId === body.serviceId &&
        replay.body.staffId === body.staffId &&
        replay.body.startAt === body.startAt &&
        replay.phone === phone;
      if (!same) return apiError(route, 422, 'IDEMPOTENCY_KEY_REUSED');
      return json(route, 200, replay.result);
    }

    attempts += 1;
    const step: Attempt = script[attempts - 1] ?? 'ok';
    const day = DateTime.fromISO(body.startAt).setZone(tz).toISODate()!;
    const staffForSlots = body.staffId === 'anyone' ? undefined : body.staffId;
    const freshSlots = () => slotsFor(day, day, staffForSlots, taken, options.bookedTimes ?? [], tz);

    if (step === 'taken') {
      taken.add(body.startAt);
      return apiError(route, 409, 'SLOT_TAKEN', { data: { slots: freshSlots() } });
    }
    if (step === '500') return apiError(route, 500, 'INTERNAL');
    if (step === '429') return apiError(route, 429, 'TOO_MANY_ATTEMPTS');
    if (step === 'drop') return route.abort('connectionreset');
    if (step === 'bad-request') {
      return apiError(route, 400, 'VALIDATION_FAILED', {
        fields: { 'idempotency-key': 'Use letters, digits and - _ . : only.' },
      });
    }

    // Minimum notice and already-booked slots are a 409 with fresh slots, like the real booking path.
    const startMs = Date.parse(body.startAt);
    if (taken.has(body.startAt) || startMs < nowMs() + MIN_NOTICE_MIN * 60_000) {
      return apiError(route, 409, 'SLOT_TAKEN', { data: { slots: freshSlots() } });
    }

    const service = catalogue.services.find((s) => s.id === body.serviceId);
    const staff = catalogue.staff.find((s) => s.id === body.staffId) ?? catalogue.staff[0]!;
    if (!service || (body.staffId !== 'anyone' && !catalogue.staff.some((s) => s.id === body.staffId))) {
      return apiError(route, 404, 'NOT_FOUND');
    }
    const result = {
      appointment: {
        id: `a${bookings.size + 1}`,
        startAt: body.startAt,
        endAt: DateTime.fromISO(body.startAt).plus({ minutes: service.durationMin }).toUTC().toISO(),
        status: 'BOOKED',
        service: { id: service.id, name: service.name, durationMin: service.durationMin, price: service.price },
        staff: { id: staff.id, displayName: staff.displayName },
      },
      links: { manage: `/l/mock-manage-token` },
      reminders: options.reminders ?? mockReminders(body.startAt, !!body.client?.email),
    };
    bookings.set(key, { body, phone, result });
    taken.add(body.startAt);
    if (step === 'drop-after-commit') return route.abort('connectionreset');
    return json(route, 201, result);
  });

  return {
    calls,
    slotRequests,
    bookings,
    /** How many times GET /api/public/{slug} was called. */
    get businessRequests() {
      return businessRequests;
    },
  };
}

// ---- signed links ------------------------------------------------------------------------

export type LinkMock = {
  act?: 'view' | 'confirm' | 'cancel';
  status?: string;
  pastCutoff?: boolean;
  canConfirm?: boolean;
  canCancel?: boolean;
  /** Status codes by token: 404 invalid, 410 expired. */
  gone?: Record<string, number>;
  /** The action POST answers with this error (409 also changes the appointment to CANCELLED afterwards). */
  postError?: 403 | 409;
  /** The cancel POST finds the appointment already late-cancelled (another tab did it). */
  alreadyCancelledLate?: boolean;
  /** The first GET says "free", every later GET says "late": time passed while the page was open. */
  cutoffPassesAfterFirstGet?: boolean;
};

export function linkBody(mock: LinkMock = {}, patch: { pastCutoff?: boolean; status?: string } = {}) {
  const start = clockNow().setZone(TZ).plus({ days: 2 }).set({ hour: 10, minute: 30, second: 0, millisecond: 0 });
  const status = patch.status ?? mock.status ?? 'BOOKED';
  return {
    act: mock.act ?? 'confirm',
    appointment: {
      id: 'a1',
      startAt: start.toUTC().toISO(),
      endAt: start.plus({ minutes: 30 }).toUTC().toISO(),
      status,
      service: { id: IDS.haircut, name: 'Haircut', durationMin: 30, price: 15 },
      staff: { id: IDS.karim, displayName: 'Karim' },
    },
    business: { name: 'Studio Nour', slug: SLUG, timezone: TZ, locale: 'en' },
    canConfirm: mock.canConfirm ?? status === 'BOOKED',
    canCancel: mock.canCancel ?? ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'].includes(status),
    cancelCutoffAt: start.minus({ hours: 24 }).toUTC().toISO(),
    pastCutoff: patch.pastCutoff ?? mock.pastCutoff ?? false,
    confirmedAt: status === 'CONFIRMED' ? start.minus({ days: 1 }).toUTC().toISO() : null,
  };
}

export async function mockLinkApi(page: Page, mock: LinkMock = {}) {
  await freezeClock(page);
  const calls: { method: string; token: string; body?: unknown }[] = [];
  let gets = 0;
  let conflicted = false;
  await page.route('**/api/links/**', async (route) => {
    const request = route.request();
    const token = decodeURIComponent(new URL(request.url()).pathname.split('/').pop()!);
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    calls.push({ method, token, body });

    const gone = mock.gone?.[token];
    if (gone === 410) return apiError(route, 410, 'LINK_EXPIRED');
    if (gone === 404) return apiError(route, 404, 'NOT_FOUND');

    if (method === 'GET') {
      gets += 1;
      return json(
        route,
        200,
        linkBody(mock, {
          ...(conflicted ? { status: 'CANCELLED' } : {}),
          ...(mock.cutoffPassesAfterFirstGet && gets > 1 ? { pastCutoff: true } : {}),
        }),
      );
    }
    if (body?.action !== 'confirm' && body?.action !== 'cancel') {
      return apiError(route, 400, 'VALIDATION_FAILED', { fields: { action: 'Invalid.' } });
    }
    // Like the server: a confirm link can only confirm, a cancel link only cancel, a view link either.
    const act = mock.act ?? 'confirm';
    if ((act !== 'view' && body.action !== act) || mock.postError === 403) {
      return apiError(route, 403, 'WRONG_LINK_ACTION');
    }
    if (mock.postError === 409) {
      conflicted = true;
      return apiError(route, 409, 'CONFLICT');
    }
    const view = linkBody(mock);
    if (body.action === 'confirm') {
      return json(route, 200, {
        ...view,
        appointment: { ...view.appointment, status: 'CONFIRMED' },
        canConfirm: false,
        result: 'confirmed',
      });
    }
    if (mock.alreadyCancelledLate) {
      return json(route, 200, {
        ...linkBody(mock, { status: 'LATE_CANCEL', pastCutoff: true }),
        canConfirm: false,
        canCancel: false,
        result: 'already_cancelled',
      });
    }
    return json(route, 200, {
      ...view,
      appointment: { ...view.appointment, status: mock.pastCutoff ? 'LATE_CANCEL' : 'CANCELLED' },
      canConfirm: false,
      canCancel: false,
      result: mock.pastCutoff ? 'late_cancelled' : 'cancelled',
    });
  });
  return { calls };
}
