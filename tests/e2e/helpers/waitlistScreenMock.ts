import type { Page, Route } from '@playwright/test';
import { clockNow } from './clock';

/**
 * Stand-in for the staff waitlist endpoints (F65), answered by page.route. It follows the real contract
 * (src/server/contracts/waitlist.ts): GET /api/waitlist returns only OPEN entries, oldest first, with a first
 * name and a masked phone (never an email), plus `total`; DELETE /api/waitlist/{id} answers 204 (idempotent) or 404
 * for an unknown id. Register AFTER mockDashboardApi: later routes win, and /api/waitlist/activity stays with it.
 */
export type MockWaitlistEntry = {
  id: string;
  client: { firstName: string; phone: string };
  service: { id: string; name: string };
  staff: { id: string; displayName: string } | null;
  fromDate: string;
  toDate: string;
  createdAt: string;
};

export type WaitlistScreenOptions = {
  entries?: MockWaitlistEntry[];
  /** What each DELETE attempt does, in order (default 'ok'). 'gone' = 404 like an entry removed elsewhere. */
  deleteScript?: Array<'ok' | '500' | 'gone'>;
  /** GET fails with this status until `recover()` is called. */
  failGet?: 500;
  /** Total reported by the API (when the list is capped). */
  total?: number;
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const day = (offset: number) => clockNow().setZone('Asia/Beirut').plus({ days: offset }).toISODate()!;
const joined = (daysAgo: number) =>
  clockNow().minus({ days: daysAgo }).toUTC().toISO({ suppressMilliseconds: true })!;

export function waitlistEntry(
  id: string,
  firstName: string,
  phoneLast3: string,
  over: Partial<MockWaitlistEntry> = {},
): MockWaitlistEntry {
  return {
    id,
    client: { firstName, phone: `•••• ••• ${phoneLast3}` },
    service: { id: 'svc-cut', name: 'Haircut' },
    staff: null,
    fromDate: day(1),
    toDate: day(5),
    createdAt: joined(1),
    ...over,
  };
}

export function defaultWaitlistEntries(): MockWaitlistEntry[] {
  return [
    waitlistEntry('wl1', 'Rami', '918', { createdAt: joined(3) }),
    waitlistEntry('wl2', 'Nadine', '902', {
      service: { id: 'svc-color', name: 'Colour and cut' },
      staff: { id: 'st-jad', displayName: 'Jad' },
      fromDate: day(2),
      toDate: day(2),
      createdAt: joined(2),
    }),
    waitlistEntry('wl3', 'ليلى', '567', { createdAt: joined(1) }),
  ];
}

export async function mockWaitlistScreen(page: Page, options: WaitlistScreenOptions = {}) {
  let entries = [...(options.entries ?? defaultWaitlistEntries())].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const script = options.deleteScript ?? [];
  let attempt = 0;
  let failGet = options.failGet;
  const calls: Array<{ method: string; path: string; search: string }> = [];

  await page.route(
    (url) =>
      url.pathname === '/api/waitlist' ||
      (url.pathname.startsWith('/api/waitlist/') && url.pathname !== '/api/waitlist/activity'),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      calls.push({ method, path: url.pathname, search: url.search });
      if (method === 'GET') {
        if (failGet) {
          return json(route, failGet, { error: { code: 'INTERNAL', message: 'boom', fields: {} } });
        }
        const limit = Number(new URL(route.request().url()).searchParams.get('limit') ?? 100);
        return json(route, 200, {
          entries: entries.slice(0, limit),
          total: options.total ?? entries.length,
        });
      }
      if (method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const step = script[attempt++] ?? 'ok';
        if (step === '500') {
          return json(route, 500, { error: { code: 'INTERNAL', message: 'boom', fields: {} } });
        }
        if (step === 'gone' || !entries.some((e) => e.id === id)) {
          entries = entries.filter((e) => e.id !== id);
          return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found', fields: {} } });
        }
        entries = entries.filter((e) => e.id !== id);
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    },
  );

  return {
    calls,
    recover: () => {
      failGet = undefined;
    },
    remaining: () => entries.map((e) => e.id),
  };
}
