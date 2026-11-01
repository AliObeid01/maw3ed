import { mockReminders } from './mockReminders';
import type { Page, Route } from '@playwright/test';
import { DateTime } from 'luxon';
import { clockNow, freezeClock, nowDate } from './clock';
import { catalogue, IDS, SLUG, TZ } from './publicMock';

/**
 * In-memory stand-ins for the waitlist API, answered by page.route. They enforce the real contracts
 * (src/server/contracts/waitlist.ts and src/server/services/waitlist.ts):
 *  - join: strict body, email REQUIRED, fromDate >= today, toDate >= fromDate, span <= 31 days, to within the
 *    booking window (default 30), staff must perform the service, max 5 open entries per phone (409 WAITLIST_LIMIT),
 *    a duplicate (same phone, service, staff, overlapping dates) answers 200 with the first entry, else 201;
 *  - offers: GET has no side effects (404 forged/malformed, 410 OFFER_EXPIRED); claim body is the strict empty
 *    object, 201 first time, 200 replay with the same booking, 409 SLOT_TAKEN (offer becomes TAKEN) / CONFLICT, 410.
 * Register AFTER mockPublicApi: later routes win, so /waitlist is answered here.
 */
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (route: Route, status: number, code: string, fields: Record<string, string> = {}) =>
  json(route, status, { error: { code, message: code, fields } });

export type JoinBody = {
  serviceId: string;
  staffId: string | null;
  fromDate: string;
  toDate: string;
  client: { name: string; phone: string; email?: string };
};

export type JoinOptions = {
  windowDays?: number;
  /** Open entries this phone already has. */
  existingOpen?: number;
  delayMs?: number;
  failWith?: 500 | 429 | 'drop';
  /** The window complaint does not say how many days (the client falls back to 7). */
  unnamedWindow?: boolean;
};

export async function mockJoinWaitlist(page: Page, options: JoinOptions = {}) {
  await freezeClock(page);
  const calls: JoinBody[] = [];
  let open = options.existingOpen ?? 0;
  let first: unknown;
  let failed = false;
  await page.route(`**/api/public/${SLUG}/waitlist`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return apiError(route, 405, 'METHOD_NOT_ALLOWED');
    const body = JSON.parse(request.postData() ?? '{}') as JoinBody;
    const fields: Record<string, string> = {};
    const topKeys = ['serviceId', 'staffId', 'fromDate', 'toDate', 'client'];
    for (const k of Object.keys(body)) if (!topKeys.includes(k)) fields[k] = 'Unrecognized key.';
    for (const k of Object.keys(body.client ?? {}))
      if (!['name', 'phone', 'email'].includes(k)) fields[`client.${k}`] = 'Unrecognized key.';
    const service = catalogue.services.find((s) => s.id === body.serviceId);
    if (!service) fields.serviceId = 'Invalid id.';
    if (body.staffId !== null) {
      const person = catalogue.staff.find((s) => s.id === body.staffId);
      if (!person || !(person.serviceIds as string[]).includes(body.serviceId)) fields.staffId = 'Invalid staff.';
    }
    const date = /^\d{4}-\d{2}-\d{2}$/;
    const today = clockNow().setZone(TZ).startOf('day');
    const from = DateTime.fromISO(body.fromDate ?? '', { zone: 'utc' });
    const to = DateTime.fromISO(body.toDate ?? '', { zone: 'utc' });
    if (!date.test(body.fromDate ?? '') || !from.isValid) fields.fromDate = 'Use a date like 2026-11-10.';
    else if (body.fromDate < today.toISODate()!) fields.fromDate = 'Pick today or a later date.';
    if (!date.test(body.toDate ?? '') || !to.isValid) fields.toDate = 'Use a date like 2026-11-10.';
    else if (from.isValid && to < from) fields.toDate = 'The end date must not be before the start date.';
    else if (from.isValid && Math.round(to.diff(from, 'days').days) + 1 > 31) fields.toDate = 'The range is at most 31 days.';
    else if (body.toDate > today.plus({ days: options.windowDays ?? 30 }).toISODate()!)
      fields.toDate = options.unnamedWindow ? 'Bookings open further out.' : `Bookings open up to ${options.windowDays ?? 30} days ahead.`;
    if (!body.client?.name?.trim()) fields['client.name'] = 'Too small: expected string to have >=1 characters';
    if (!body.client?.phone || body.client.phone.length < 3) fields['client.phone'] = 'Enter a valid phone number.';
    if (!body.client?.email) fields['client.email'] = 'Invalid input: expected string, received undefined';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.client.email)) fields['client.email'] = 'Invalid email address';
    if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', fields);

    calls.push(body);
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.failWith && !failed) {
      failed = true;
      if (options.failWith === 'drop') return route.abort('connectionreset');
      return apiError(route, options.failWith, options.failWith === 429 ? 'TOO_MANY_ATTEMPTS' : 'INTERNAL');
    }
    const entry = {
      id: 'we1',
      status: 'OPEN',
      serviceId: body.serviceId,
      staffId: body.staffId,
      fromDate: body.fromDate,
      toDate: body.toDate,
    };
    if (first) return json(route, 200, first);
    if (open >= 5) return apiError(route, 409, 'WAITLIST_LIMIT');
    open += 1;
    first = { entry };
    return json(route, 201, first);
  });
  return { calls };
}

// ---- offers ------------------------------------------------------------------------------

export type OfferMock = {
  /** Offer status in the GET. */
  status?: 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'TAKEN' | 'HOLD_LAPSED';
  canClaim?: boolean;
  /** Minutes until expiry (negative = already past). Default 28. */
  expiresInMin?: number;
  /** token -> 404 | 410 */
  gone?: Record<string, 404 | 410>;
  /** What the claim answers instead of booking. */
  claim?: 'taken' | 'conflict' | 'expired' | 'hold-lapsed' | '500' | 'drop-once';
  claimDelayMs?: number;
  /** Leave the `Date` response header out (the client then trusts the device clock). */
  noDateHeader?: boolean;
  /** What the claim answers in `reminders` (default: from the slot's lead time, like the server). */
  reminders?: { h24: boolean; h2: boolean; email: boolean };
};

export async function mockOfferApi(page: Page, mock: OfferMock = {}) {
  await freezeClock(page);
  const calls: { method: string; token: string; body?: unknown; contentType?: string }[] = [];
  const start = clockNow().setZone(TZ).plus({ days: 1 }).set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  const expiresAt = clockNow().plus({ minutes: mock.expiresInMin ?? 28 });
  let booked: unknown;
  let dropped = false;
  await page.route('**/api/offers/**', async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/').filter(Boolean); // api, offers, token, [claim]
    const token = decodeURIComponent(parts[2] ?? '');
    const isClaim = parts[3] === 'claim';
    const method = request.method();
    calls.push({
      method,
      token,
      body: request.postData() ? JSON.parse(request.postData()!) : undefined,
      contentType: request.headers()['content-type'],
    });
    const gone = mock.gone?.[token];
    if (gone === 404) return apiError(route, 404, 'NOT_FOUND');
    if (gone === 410) return apiError(route, 410, 'OFFER_EXPIRED');

    if (!isClaim) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: mock.noDateHeader ? {} : { date: nowDate().toUTCString() },
        body: JSON.stringify({
        offer: {
          id: 'of1',
          status: booked ? 'CLAIMED' : (mock.status ?? 'OPEN'),
          startAt: start.toUTC().toISO(),
          endAt: start.plus({ minutes: 30 }).toUTC().toISO(),
          expiresAt: expiresAt.toUTC().toISO(),
          service: { id: IDS.haircut, name: 'Haircut', durationMin: 30, price: 15 },
          staff: { id: IDS.karim, displayName: 'Karim' },
        },
        business: { name: 'Studio Nour', slug: SLUG, timezone: TZ, locale: 'en' },
        canClaim: mock.canClaim ?? (mock.status ?? 'OPEN') === 'OPEN',
        }),
      });
    }
    if (method !== 'POST') return apiError(route, 405, 'METHOD_NOT_ALLOWED');
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    if (!body || Object.keys(body).length > 0 || !(request.headers()['content-type'] ?? '').includes('application/json')) {
      return apiError(route, 400, 'VALIDATION_FAILED', { body: 'Send an empty JSON object.' });
    }
    if (mock.claimDelayMs) await new Promise((r) => setTimeout(r, mock.claimDelayMs));
    if (booked) return json(route, 200, booked);
    if (mock.claim === 'taken') return json(route, 409, { error: { code: 'SLOT_TAKEN', message: 'SLOT_TAKEN', fields: {}, data: { slots: [] } } });
    if (mock.claim === 'conflict') return apiError(route, 409, 'CONFLICT');
    if (mock.claim === 'hold-lapsed') return apiError(route, 409, 'HOLD_LAPSED');
    if (mock.claim === 'expired') return apiError(route, 410, 'OFFER_EXPIRED');
    if (mock.claim === '500') return apiError(route, 500, 'INTERNAL');
    if (mock.claim === 'drop-once' && !dropped) {
      dropped = true;
      return route.abort('connectionreset');
    }
    booked = {
      appointment: {
        id: 'a9',
        startAt: start.toUTC().toISO(),
        endAt: start.plus({ minutes: 30 }).toUTC().toISO(),
        status: 'BOOKED',
        service: { id: IDS.haircut, name: 'Haircut', durationMin: 30, price: 15 },
        staff: { id: IDS.karim, displayName: 'Karim' },
      },
      links: { manage: '/l/mock-manage-token' },
      reminders: mock.reminders ?? mockReminders(start.toUTC().toISO()!, true),
    };
    return json(route, 201, booked);
  });
  return { calls, start, expiresAt };
}
