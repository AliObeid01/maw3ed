import type { Page, Request, Route } from '@playwright/test';
import { DateTime } from 'luxon';
import { clockNow, freezeClock, nowMs, nowDate } from './clock';
import {
  baselineRate,
  changeVsBaseline,
  addRow,
  daysCovered,
  emptyCounts,
  localDateOf,
  noShowRate,
  round1,
  validateBaseline,
  weekWindows,
  weeklyCounts,
  BASELINE_DEFINITION,
  RATE_DEFINITION,
} from '../../../src/server/domain/pilotMetrics';
import { effectiveEmail } from '../../../src/server/domain/contactEmail';
import { planOutcome } from '../../../src/server/domain/outcomes';

/**
 * Stateful in-memory stand-in for the outcomes, appointment, clients and pilot APIs, answered by page.route.
 * It follows src/server/contracts/outcomes.ts and enforces the real behaviour:
 *  - the outcome transition goes through the server's own `planOutcome` (NOT_STARTED, NOT_ENDED, CONFLICT, no-op,
 *    correction moving one counter to another) and the body is strict,
 *  - ids must look like cuid2 (400 otherwise), an unknown id is 404 (also what another business's id looks like),
 *  - clients: strict query (search, sort, limit 1-100, cursor), cursor pagination, STAFF may read, only OWNER may DELETE
 *    (403 for STAFF), DELETE answers 204 with no body and anonymises + cancels future bookings,
 *  - pilot: OWNER only (403 for STAFF), PUT baseline runs the server's `validateBaseline` (400 with fields),
 *    the report is computed with the server's own metric functions from the appointments in the mock,
 *  - export.csv needs from/to (400 otherwise) and answers a CSV attachment.
 */
export const TZ = 'Asia/Beirut';
export const OWN_BUSINESS_ID = 'e2e-business';

const ID = /^[0-9a-z]+$/;
const iso = (dt: DateTime) => dt.toUTC().toISO({ suppressMilliseconds: true })!;
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

/** Minutes from now as a UTC instant (negative = in the past). */
export const fromNow = (minutes: number) => iso(clockNow().plus({ minutes }));

export type MockClient = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  attended: number;
  noShows: number;
  lateCancels: number;
  lastVisitAt: string | null;
  createdAt: string;
};

export type MockAppt = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  serviceId: string;
  staffId: string;
  clientId: string;
  cancelledVia?: 'LINK' | 'STAFF' | 'SYSTEM' | null;
  /** F16: the address typed for this booking (the mock mirrors the server's effectiveEmail with the client email). */
  contactEmail?: string | null;
};

export const SERVICES = {
  haircut: { id: 'svchaircut', name: 'Haircut', durationMin: 30, price: 15 },
  colour: { id: 'svccolour', name: 'Hair colour', durationMin: 90, price: 60 },
  beard: { id: 'svcbeard', name: 'Beard trim', durationMin: 20, price: 8 },
} as const;
export const STAFF = {
  karim: { id: 'stfkarim', displayName: 'Karim' },
  lina: { id: 'stflina', displayName: 'Lina' },
  jad: { id: 'stfjad', displayName: 'Jad' },
} as const;
const SERVICE_LIST = Object.values(SERVICES);
const STAFF_LIST = Object.values(STAFF);

export const client = (id: string, name: string, phone: string, extra: Partial<MockClient> = {}): MockClient => ({
  id,
  name,
  phone,
  email: null,
  attended: 0,
  noShows: 0,
  lateCancels: 0,
  lastVisitAt: null,
  createdAt: fromNow(-60 * 24 * 90),
  ...extra,
});

export const appt = (
  id: string,
  clientId: string,
  startMinutes: number,
  durationMin: number,
  extra: Partial<MockAppt> = {},
): MockAppt => ({
  id,
  startAt: fromNow(startMinutes),
  endAt: fromNow(startMinutes + durationMin),
  status: 'BOOKED',
  source: 'PUBLIC',
  serviceId: SERVICES.haircut.id,
  staffId: STAFF.karim.id,
  clientId,
  ...extra,
});

export type Baseline = {
  fromDate: string;
  toDate: string;
  appointments: number;
  noShows: number;
  lateCancels: number;
};

export type Signals = {
  confirmRate: number | null;
  cancellationsViaLink: number;
  waitlistSlotsOffered: number;
  waitlistRefills: number;
  waitlistRefillRate: number | null;
};

export type OutcomesOptions = {
  clients?: MockClient[];
  appointments?: MockAppt[];
  baseline?: Baseline | null;
  signals?: Signals;
  /** Per PATCH outcome attempt, in order: 'ok' (default) or an HTTP failure. */
  outcomeScript?: Array<'ok' | '500' | 'slow'>;
  /** Milliseconds a 'slow' outcome attempt waits before answering. */
  slowMs?: number;
  /** The queue also lists appointments ending within this many minutes (a server clock ahead of the browser). */
  queueSkewMinutes?: number;
  /** Extra milliseconds before GET /api/clients answers, per exact search text. */
  clientDelays?: Record<string, number>;
  /** GET /api/pilot/report answers this status instead of a report. */
  reportStatus?: number;
};

export type Call = { method: string; path: string; search: string; body?: unknown };

export const DEFAULT_SIGNALS: Signals = {
  confirmRate: 64,
  cancellationsViaLink: 9,
  waitlistSlotsOffered: 7,
  waitlistRefills: 5,
  waitlistRefillRate: 71.4,
};

async function roleOf(request: Request): Promise<'OWNER' | 'STAFF'> {
  const cookie = (await request.allHeaders()).cookie ?? '';
  return /(?:^|;\s*)e2e_role=STAFF/.test(cookie) ? 'STAFF' : 'OWNER';
}

/** Past appointments for the pilot report: `attended` + `noShows` + `lateCancels` spread over the last 12 days. */
export function pilotHistory(clientId: string, counts: { attended: number; noShows: number; lateCancels?: number }) {
  const rows: MockAppt[] = [];
  const total = counts.attended + counts.noShows + (counts.lateCancels ?? 0);
  const statuses = [
    ...Array<string>(counts.attended).fill('ATTENDED'),
    ...Array<string>(counts.noShows).fill('NO_SHOW'),
    ...Array<string>(counts.lateCancels ?? 0).fill('LATE_CANCEL'),
  ];
  for (let i = 0; i < total; i++) {
    const days = 1 + (i % 12);
    rows.push(
      appt(`hist${i}`, clientId, -(days * 24 * 60) - (i % 5) * 37, 30, {
        status: statuses[(i * 7) % total]!,
      }),
    );
  }
  return rows;
}

export async function mockOutcomesApi(page: Page, options: OutcomesOptions = {}) {
  await freezeClock(page);
  const clients = options.clients ?? [];
  const appointments = options.appointments ?? [];
  let baseline = options.baseline ?? null;
  const calls: Call[] = [];
  let outcomeAttempt = 0;
  const script = options.outcomeScript ?? [];

  const byClient = (id: string) => clients.find((c) => c.id === id);
  const serviceOf = (a: MockAppt) => SERVICE_LIST.find((s) => s.id === a.serviceId)!;
  const staffOf = (a: MockAppt) => STAFF_LIST.find((s) => s.id === a.staffId)!;
  const isEnded = (a: MockAppt) =>
    Date.parse(a.endAt) <= nowMs() + (options.queueSkewMinutes ?? 0) * 60_000;
  const queue = () =>
    appointments
      .filter((a) => (a.status === 'BOOKED' || a.status === 'CONFIRMED') && isEnded(a))
      .sort((a, b) => b.startAt.localeCompare(a.startAt));

  const apptItem = (a: MockAppt) => {
    const c = byClient(a.clientId)!;
    const reminderEmail = effectiveEmail(a.contactEmail, c.email);
    return {
      reminderEmail,
      reminderEmailDiffers: reminderEmail !== null && reminderEmail.toLowerCase() !== (c.email ?? '').toLowerCase(),
      id: a.id,
      startAt: a.startAt,
      endAt: a.endAt,
      status: a.status,
      service: { id: serviceOf(a).id, name: serviceOf(a).name, durationMin: serviceOf(a).durationMin, price: serviceOf(a).price },
      staff: { id: staffOf(a).id, displayName: staffOf(a).displayName },
      source: a.source,
      client: {
        id: c.id,
        name: c.name,
        phone: c.phone,
        noShows: c.noShows,
        repeatNoShow: c.noShows >= 2,
        lateCancels: c.lateCancels,
      },
    };
  };
  const clientRow = (c: MockClient) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    attended: c.attended,
    noShows: c.noShows,
    lateCancels: c.lateCancels,
    lastVisitAt: c.lastVisitAt,
    repeatNoShow: c.noShows >= 2,
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const postData = request.postData();
    const body = postData ? (JSON.parse(postData) as Record<string, unknown>) : undefined;
    calls.push({ method, path, search: url.search, body });
    const role = await roleOf(request);

    if (path === '/api/dashboard/summary') {
      return json(route, 200, { whatsappDue: 0, outcomesToMark: queue().length });
    }

    // ---- outcomes ---------------------------------------------------------------------------
    if (path === '/api/outcomes/queue') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { limit: 'Invalid limit.' } });
      }
      const all = queue();
      return json(route, 200, {
        count: all.length,
        items: all.slice(0, limit).map((a) => {
          const c = byClient(a.clientId)!;
          return {
            id: a.id,
            startAt: a.startAt,
            endAt: a.endAt,
            service: { id: serviceOf(a).id, name: serviceOf(a).name },
            staff: { id: staffOf(a).id, displayName: staffOf(a).displayName },
            client: { id: c.id, name: c.name, phone: c.phone, noShows: c.noShows },
          };
        }),
      });
    }

    const outcome = /^\/api\/appointments\/([^/]+)\/outcome$/.exec(path);
    if (outcome && method === 'PATCH') {
      if (!ID.test(outcome[1]!)) return apiError(route, 400, 'VALIDATION_FAILED', { fields: { id: 'Invalid id.' } });
      const keys = Object.keys(body ?? {});
      const target = (body as { outcome?: string } | undefined)?.outcome;
      if (keys.some((k) => k !== 'outcome') || !['ATTENDED', 'NO_SHOW', 'LATE_CANCEL'].includes(target ?? '')) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { outcome: 'Invalid outcome.' } });
      }
      const found = appointments.find((a) => a.id === outcome[1]);
      if (!found) return apiError(route, 404, 'NOT_FOUND');
      outcomeAttempt += 1;
      const step = script[outcomeAttempt - 1] ?? 'ok';
      if (step === '500') return apiError(route, 500, 'INTERNAL');
      if (step === 'slow') await new Promise((r) => setTimeout(r, options.slowMs ?? 600));

      const c = byClient(found.clientId)!;
      const plan = planOutcome({
        status: found.status,
        cancelledVia: found.cancelledVia ?? null,
        startAt: new Date(found.startAt),
        endAt: new Date(found.endAt),
        now: nowDate(),
        target: target as 'ATTENDED' | 'NO_SHOW' | 'LATE_CANCEL',
      });
      if (plan.kind === 'not_started') return apiError(route, 409, 'NOT_STARTED');
      if (plan.kind === 'not_ended') return apiError(route, 409, 'NOT_ENDED');
      if (plan.kind === 'conflict') return apiError(route, 409, 'CONFLICT');
      if (plan.kind === 'apply') {
        if (plan.decrement) c[plan.decrement] = Math.max(0, c[plan.decrement] - 1);
        c[plan.increment] += 1;
        found.status = target!;
      }
      return json(route, 200, {
        appointment: {
          id: found.id,
          status: found.status,
          startAt: found.startAt,
          endAt: found.endAt,
          client: {
            id: c.id,
            name: c.name,
            phone: c.phone,
            attended: c.attended,
            noShows: c.noShows,
            lateCancels: c.lateCancels,
          },
        },
      });
    }

    // ---- one appointment --------------------------------------------------------------------
    const one = /^\/api\/appointments\/([^/]+)$/.exec(path);
    if (one && method === 'GET') {
      if (!ID.test(one[1]!)) return apiError(route, 400, 'VALIDATION_FAILED', { fields: { id: 'Invalid id.' } });
      const found = appointments.find((a) => a.id === one[1]);
      if (!found) return apiError(route, 404, 'NOT_FOUND');
      return json(route, 200, { appointment: apptItem(found) });
    }
    const cancel = /^\/api\/appointments\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === 'POST') {
      const found = appointments.find((a) => a.id === cancel[1]);
      if (!found) return apiError(route, 404, 'NOT_FOUND');
      if (found.status === 'BOOKED' || found.status === 'CONFIRMED') {
        found.status = 'CANCELLED';
        found.cancelledVia = 'STAFF';
      }
      return json(route, 200, { appointment: apptItem(found) });
    }

    // ---- clients ----------------------------------------------------------------------------
    if (path === '/api/clients' && method === 'GET') {
      const q = url.searchParams;
      const unknown = [...q.keys()].filter((k) => !['search', 'sort', 'limit', 'cursor'].includes(k));
      if (unknown.length) {
        return apiError(route, 400, 'VALIDATION_FAILED', {
          fields: Object.fromEntries(unknown.map((k) => [k, 'Unknown field.'])),
        });
      }
      const sort = q.get('sort') ?? 'name';
      const limit = Number(q.get('limit') ?? 50);
      const cursor = q.get('cursor');
      if (!['name', 'noShows', 'recent'].includes(sort)) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { sort: 'Invalid sort.' } });
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { limit: 'Invalid limit.' } });
      }
      if (cursor !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(cursor)) {
        return apiError(route, 400, 'VALIDATION_FAILED', { fields: { cursor: 'Invalid cursor.' } });
      }
      const search = (q.get('search') ?? '').trim();
      const delay = options.clientDelays?.[search];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const digits = search.replace(/\D/g, '');
      let rows = clients.filter(
        (c) =>
          !search ||
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (digits.length > 0 && c.phone.replace(/\D/g, '').includes(digits)),
      );
      rows = [...rows].sort((a, b) => {
        if (sort === 'noShows') return b.noShows - a.noShows || a.name.localeCompare(b.name);
        if (sort === 'recent') return (b.lastVisitAt ?? '').localeCompare(a.lastVisitAt ?? '') || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
      const offset = cursor ? Number(/^o(\d+)$/.exec(cursor)?.[1] ?? 0) : 0;
      const page_ = rows.slice(offset, offset + limit);
      const next = offset + limit < rows.length ? `o${offset + limit}` : null;
      return json(route, 200, { clients: page_.map(clientRow), nextCursor: next });
    }

    const oneClient = /^\/api\/clients\/([^/]+)$/.exec(path);
    if (oneClient) {
      if (!ID.test(oneClient[1]!)) return apiError(route, 400, 'VALIDATION_FAILED', { fields: { id: 'Invalid id.' } });
      const c = byClient(oneClient[1]!);
      if (method === 'GET') {
        if (!c) return apiError(route, 404, 'NOT_FOUND');
        const history = appointments
          .filter((a) => a.clientId === c.id)
          .sort((a, b) => b.startAt.localeCompare(a.startAt))
          .slice(0, 50)
          .map((a) => ({
            id: a.id,
            startAt: a.startAt,
            status: a.status,
            service: { id: serviceOf(a).id, name: serviceOf(a).name },
            staff: { id: staffOf(a).id, displayName: staffOf(a).displayName },
          }));
        return json(route, 200, { client: { ...clientRow(c), createdAt: c.createdAt }, history });
      }
      if (method === 'DELETE') {
        if (role !== 'OWNER') return apiError(route, 403, 'FORBIDDEN');
        if (!c) return apiError(route, 404, 'NOT_FOUND');
        for (const a of appointments) {
          if (a.clientId === c.id && Date.parse(a.startAt) > nowMs() && (a.status === 'BOOKED' || a.status === 'CONFIRMED')) {
            a.status = 'CANCELLED';
          }
        }
        clients.splice(clients.indexOf(c), 1);
        return route.fulfill({ status: 204 });
      }
    }

    // ---- pilot ------------------------------------------------------------------------------
    if (path.startsWith('/api/pilot/')) {
      if (role !== 'OWNER') return apiError(route, 403, 'FORBIDDEN');

      if (path === '/api/pilot/baseline' && method === 'GET') return json(route, 200, { baseline });
      if (path === '/api/pilot/baseline' && method === 'PUT') {
        const b = (body ?? {}) as Record<string, unknown>;
        const allowed = ['fromDate', 'toDate', 'appointments', 'noShows', 'lateCancels'];
        const shapeErrors: Record<string, string> = {};
        for (const k of Object.keys(b)) if (!allowed.includes(k)) shapeErrors[k] = 'Unknown field.';
        for (const k of ['appointments', 'noShows', 'lateCancels']) {
          const v = b[k];
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10_000) shapeErrors[k] = 'Expected a whole number from 0 to 10000.';
        }
        for (const k of ['fromDate', 'toDate']) {
          if (typeof b[k] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b[k] as string)) shapeErrors[k] = 'Use a date like 2026-11-10.';
        }
        if (Object.keys(shapeErrors).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields: shapeErrors });
        const input = b as unknown as Baseline;
        const fields = validateBaseline(input, localDateOf(nowDate(), TZ));
        if (Object.keys(fields).length) return apiError(route, 400, 'VALIDATION_FAILED', { fields });
        baseline = {
          fromDate: input.fromDate,
          toDate: input.toDate,
          appointments: input.appointments,
          noShows: input.noShows,
          lateCancels: input.lateCancels,
        };
        return json(route, 200, { baseline });
      }

      if (path === '/api/pilot/report' && method === 'GET') {
        if (options.reportStatus) return apiError(route, options.reportStatus, 'INTERNAL');
        const weeks = Number(url.searchParams.get('weeks') ?? 4);
        if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) {
          return apiError(route, 400, 'VALIDATION_FAILED', { fields: { weeks: 'Invalid weeks.' } });
        }
        const now = nowDate();
        const windows = weekWindows(now, TZ, weeks);
        // Like the server: only appointments that have started, over the WHOLE pilot (first appointment to today);
        // `weeks` only decides how many weekly points come back.
        const rows = appointments
          .map((a) => ({
            startAt: new Date(a.startAt),
            status: a.status,
            cancelledVia: a.cancelledVia ?? null,
            source: a.source,
          }))
          .filter((r) => r.startAt <= now);
        const weekly = weeklyCounts(rows, windows).map((w) => ({
          ...w,
          noShowRate: w.noShowRate === null ? null : round1(w.noShowRate),
        }));
        const total = emptyCounts();
        for (const r of rows) addRow(total, r);
        const rate = noShowRate(total.attended, total.noShows);
        const base = baseline ? baselineRate(baseline.appointments, baseline.noShows) : null;
        const change = changeVsBaseline(rate, base);
        const to = localDateOf(now, TZ);
        const earliest = rows.reduce<Date | null>((min, r) => (!min || r.startAt < min ? r.startAt : min), null);
        const from = earliest ? localDateOf(earliest, TZ) : to;
        return json(route, 200, {
          rateDefinition: RATE_DEFINITION,
          baselineDefinition: BASELINE_DEFINITION,
          baseline,
          pilot: {
            fromDate: from,
            toDate: to,
            daysCovered: daysCovered(from, to),
            ...total,
            noShowRate: rate === null ? null : round1(rate),
            baselineRate: base === null ? null : round1(base),
            changePoints: change.changePoints === null ? null : round1(change.changePoints),
            changeRelativePct: change.changeRelativePct === null ? null : round1(change.changeRelativePct),
          },
          weekly,
          signals: options.signals ?? DEFAULT_SIGNALS,
        });
      }

      if (path === '/api/pilot/export.csv' && method === 'GET') {
        const re = /^\d{4}-\d{2}-\d{2}$/;
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        if (!re.test(from) || !re.test(to)) {
          return apiError(route, 400, 'VALIDATION_FAILED', { fields: { from: 'Use a date.' } });
        }
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="maw3ed-pilot-${from}-${to}.csv"`,
          },
          body: '﻿date,time,status\n2026-10-20,10:00,ATTENDED\n',
        });
      }
    }

    return apiError(route, 404, 'NOT_FOUND');
  });

  return { calls, appointments, clients, queue };
}
