import type { Page, Route } from '@playwright/test';
import { DateTime } from 'luxon';

/**
 * In-memory stand-in for the public booking API and the signed-link API, answered by page.route.
 * The mocks enforce the real contracts: `Idempotency-Key` is required (8-100 safe chars), the booking body is
 * strict, SLOT_TAKEN carries `error.data.slots`, 400 carries `fields`, a repeated key replays with 200.
 */
export const TZ = 'Asia/Beirut';
export const SLUG = 'studio-nour';

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (
  route: Route,
  status: number,
  code: string,
  extra: { fields?: Record<string, string>; data?: unknown } = {},
) =>
  json(route, status, {
    error: { code, message: code, fields: extra.fields ?? {}, ...(extra.data ? { data: extra.data } : {}) },
  });

export const catalogue = {
  business: {
    name: 'Studio Nour',
    slug: SLUG,
    timezone: TZ,
    locale: 'en',
    category: 'Hair salon',
    address: 'Hamra, Beirut',
  },
  services: [
    { id: 's1', name: 'Haircut', durationMin: 30, bufferMin: 10, price: 15 },
    { id: 's2', name: 'Blow-dry', durationMin: 45, bufferMin: 10, price: 20 },
    { id: 's3', name: 'Beard trim', durationMin: 20, bufferMin: 5, price: 8 },
  ],
  staff: [
    { id: 'p1', displayName: 'Lina', serviceIds: ['s1', 's2'] },
    { id: 'p2', displayName: 'Karim', serviceIds: ['s1', 's2'] },
    // Beard trim (s3) is offered by Jad only, so the staff step is skipped for it.
    { id: 'p3', displayName: 'Jad', serviceIds: ['s1', 's3'] },
  ],
};

const TIMES = ['09:00', '09:30', '10:30', '14:00', '15:30'];

export type PublicMockOptions = {
  /** The first booking attempt finds its slot taken (someone else booked it); the slot then disappears. */
  takeSlotOnFirstBook?: boolean;
  /** Delay the booking answer (ms) to look at pending state and double submits. */
  bookDelayMs?: number;
  /** First booking is committed on the server but the connection drops: the retry must replay (200). */
  dropFirstResponse?: boolean;
  /** First booking answers 500 (nothing committed). */
  failFirstWith500?: boolean;
  /** Answer the booking with 400 fields['client.phone']. */
  rejectPhone?: boolean;
  /** Answer GET /api/public/{slug} slowly. */
  businessDelayMs?: number;
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

/** Slots for each local day in [from, to]: tomorrow onwards, never Sundays. */
function slotsFor(from: string, to: string, staffId: string | undefined, taken: Set<string>) {
  const out: { startAt: string; endAt: string; staffId?: string }[] = [];
  const today = DateTime.now().setZone(TZ).startOf('day');
  let day = DateTime.fromISO(from, { zone: TZ });
  const last = DateTime.fromISO(to, { zone: TZ });
  while (day <= last) {
    if (day > today && day.weekday !== 7) {
      for (const time of TIMES) {
        const [h, m] = time.split(':').map(Number);
        const start = day.set({ hour: h, minute: m });
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
  const taken = new Set<string>();
  const bookings = new Map<string, { body: BookingCall['body']; result: unknown }>();
  const calls: BookingCall[] = [];
  const slotRequests: string[] = [];
  let attempts = 0;

  await page.route('**/api/public/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const match = /^\/api\/public\/([^/]+)(\/slots|\/bookings)?$/.exec(url.pathname);
    if (!match) return apiError(route, 404, 'NOT_FOUND');
    if (match[1] !== SLUG) return apiError(route, 404, 'NOT_FOUND');

    if (!match[2]) {
      if (options.businessDelayMs) await new Promise((r) => setTimeout(r, options.businessDelayMs));
      return json(route, 200, catalogue);
    }

    if (match[2] === '/slots') {
      slotRequests.push(url.search);
      const q = url.searchParams;
      const fields: Record<string, string> = {};
      if (!q.get('serviceId')) fields.serviceId = 'Required.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.get('from') ?? '')) fields.from = 'Use a date like 2026-11-10.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.get('to') ?? '')) fields.to = 'Use a date like 2026-11-10.';
      if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });
      return json(route, 200, {
        slots: slotsFor(q.get('from')!, q.get('to')!, q.get('staffId') ?? undefined, taken),
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
    calls.push({ key, body });
    if (options.bookDelayMs) await new Promise((r) => setTimeout(r, options.bookDelayMs));

    const replay = bookings.get(key);
    if (replay) {
      if (JSON.stringify(replay.body) !== JSON.stringify(body)) {
        return apiError(route, 422, 'IDEMPOTENCY_KEY_REUSED');
      }
      return json(route, 200, replay.result);
    }

    const fields: Record<string, string> = {};
    if (!body.client?.name?.trim()) fields['client.name'] = 'Required.';
    if (options.rejectPhone || !/^\+\d{8,15}$/.test(body.client?.phone ?? '')) {
      fields['client.phone'] = 'Enter a valid phone number.';
    }
    if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });

    attempts += 1;
    if (options.takeSlotOnFirstBook && attempts === 1) {
      taken.add(body.startAt);
      const day = DateTime.fromISO(body.startAt).setZone(TZ).toISODate()!;
      return apiError(route, 409, 'SLOT_TAKEN', {
        data: { slots: slotsFor(day, day, body.staffId === 'anyone' ? undefined : body.staffId, taken) },
      });
    }
    if (options.failFirstWith500 && attempts === 1) return apiError(route, 500, 'INTERNAL');

    const service = catalogue.services.find((s) => s.id === body.serviceId)!;
    const staff =
      catalogue.staff.find((s) => s.id === body.staffId) ?? catalogue.staff[0]!;
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
    };
    bookings.set(key, { body, result });
    taken.add(body.startAt);
    if (options.dropFirstResponse && attempts === 1) return route.abort('connectionreset');
    return json(route, 201, result);
  });

  return { calls, slotRequests, bookings };
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
};

export function linkBody(mock: LinkMock = {}) {
  const start = DateTime.now().setZone(TZ).plus({ days: 2 }).set({ hour: 10, minute: 30, second: 0, millisecond: 0 });
  return {
    act: mock.act ?? 'confirm',
    appointment: {
      id: 'a1',
      startAt: start.toUTC().toISO(),
      endAt: start.plus({ minutes: 30 }).toUTC().toISO(),
      status: mock.status ?? 'BOOKED',
      service: { id: 's1', name: 'Haircut', durationMin: 30, price: 15 },
      staff: { id: 'p2', displayName: 'Karim' },
    },
    business: { name: 'Studio Nour', slug: SLUG, timezone: TZ, locale: 'en' },
    canConfirm: mock.canConfirm ?? true,
    canCancel: mock.canCancel ?? true,
    cancelCutoffAt: start.minus({ hours: 24 }).toUTC().toISO(),
    pastCutoff: mock.pastCutoff ?? false,
    confirmedAt: mock.status === 'CONFIRMED' ? start.minus({ days: 1 }).toUTC().toISO() : null,
  };
}

export async function mockLinkApi(page: Page, mock: LinkMock = {}) {
  const calls: { method: string; token: string; body?: unknown }[] = [];
  await page.route('**/api/links/**', async (route) => {
    const request = route.request();
    const token = decodeURIComponent(new URL(request.url()).pathname.split('/').pop()!);
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    calls.push({ method, token, body });

    const gone = mock.gone?.[token];
    if (gone === 410) return apiError(route, 410, 'LINK_EXPIRED');
    if (gone === 404) return apiError(route, 404, 'NOT_FOUND');

    if (method === 'GET') return json(route, 200, linkBody(mock));
    if (body?.action !== 'confirm' && body?.action !== 'cancel') {
      return apiError(route, 400, 'VALIDATION_FAILED', { fields: { action: 'Invalid.' } });
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
