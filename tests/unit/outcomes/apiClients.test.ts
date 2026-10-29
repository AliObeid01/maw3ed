import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteClient,
  getAppointment,
  getClient,
  getClients,
  getOutcomeQueue,
  markOutcome,
} from '@/lib/api/outcomes';
import { getBaseline, getReport, putBaseline } from '@/lib/api/pilot';

const reply = (status: number, body?: unknown) =>
  vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    );

afterEach(() => vi.unstubAllGlobals());

const client = {
  id: 'c1',
  name: 'Maya',
  phone: '+96170555218',
  email: null,
  attended: 4,
  noShows: 0,
  lateCancels: 0,
  lastVisitAt: null,
  repeatNoShow: false,
};

describe('outcomes client', () => {
  it('PATCHes the outcome with a JSON body and parses the counters', async () => {
    const f = reply(200, {
      appointment: {
        id: 'a1',
        status: 'NO_SHOW',
        startAt: '2026-10-29T08:00:00Z',
        endAt: '2026-10-29T08:30:00Z',
        client: { id: 'c1', name: 'Maya', phone: '+96170555218', attended: 1, noShows: 2, lateCancels: 0 },
      },
    });
    vi.stubGlobal('fetch', f);
    const r = await markOutcome('a1', 'NO_SHOW');
    expect(r.appointment.client.noShows).toBe(2);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/appointments/a1/outcome');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ outcome: 'NO_SHOW' });
  });

  it('surfaces 409 NOT_ENDED with its code', async () => {
    vi.stubGlobal('fetch', reply(409, { error: { code: 'NOT_ENDED', message: 'x' } }));
    await expect(markOutcome('a1', 'ATTENDED')).rejects.toMatchObject({ status: 409, code: 'NOT_ENDED' });
  });

  it('reads the queue', async () => {
    const f = reply(200, { count: 0, items: [] });
    vi.stubGlobal('fetch', f);
    expect(await getOutcomeQueue()).toEqual({ count: 0, items: [] });
    expect(f.mock.calls[0]![0]).toBe('/api/outcomes/queue?limit=100');
  });

  it('rejects a queue item missing the client as BAD_RESPONSE', async () => {
    vi.stubGlobal('fetch', reply(200, { count: 1, items: [{ id: 'a' }] }));
    await expect(getOutcomeQueue()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('unwraps one appointment', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        appointment: {
          id: 'a1',
          startAt: '2026-10-29T08:00:00Z',
          endAt: '2026-10-29T08:30:00Z',
          status: 'BOOKED',
          source: 'PUBLIC',
          service: { id: 's', name: 'Haircut', durationMin: 30, price: 15 },
          staff: { id: 'p', displayName: 'Karim' },
          client: { id: 'c', name: 'Maya', phone: '+96170555218', noShows: 0, repeatNoShow: false, lateCancels: 0 },
        },
      }),
    );
    expect((await getAppointment('a1')).service.name).toBe('Haircut');
  });
});

describe('clients client', () => {
  it('builds the query with sort, limit, trimmed search and cursor', async () => {
    const f = reply(200, { clients: [client], nextCursor: 'abc' });
    vi.stubGlobal('fetch', f);
    const page = await getClients({ search: '  Maya ', sort: 'noShows', cursor: 'c0' });
    expect(page.nextCursor).toBe('abc');
    const url = new URL(f.mock.calls[0]![0] as string, 'http://x');
    expect(url.pathname).toBe('/api/clients');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sort: 'noShows',
      limit: '25',
      search: 'Maya',
      cursor: 'c0',
    });
  });

  it('omits an empty search', async () => {
    const f = reply(200, { clients: [], nextCursor: null });
    vi.stubGlobal('fetch', f);
    await getClients({ search: '   ', sort: 'name' });
    expect(new URL(f.mock.calls[0]![0] as string, 'http://x').searchParams.has('search')).toBe(false);
  });

  it('reads a client with history and deletes with 204', async () => {
    vi.stubGlobal('fetch', reply(200, { client: { ...client, createdAt: '2026-01-01T00:00:00Z' }, history: [] }));
    expect((await getClient('c1')).client.name).toBe('Maya');
    const f = reply(204);
    vi.stubGlobal('fetch', f);
    await expect(deleteClient('c1')).resolves.toBeUndefined();
    expect(f.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('delete as STAFF is a 403', async () => {
    vi.stubGlobal('fetch', reply(403, { error: { code: 'FORBIDDEN', message: 'x' } }));
    await expect(deleteClient('c1')).rejects.toMatchObject({ status: 403 });
  });
});

describe('pilot client', () => {
  const baseline = { fromDate: '2026-10-01', toDate: '2026-10-14', appointments: 78, noShows: 14, lateCancels: 3 };
  it('reads a null baseline', async () => {
    vi.stubGlobal('fetch', reply(200, { baseline: null }));
    expect(await getBaseline()).toBeNull();
  });
  it('PUTs the baseline and returns the saved one', async () => {
    const f = reply(200, { baseline });
    vi.stubGlobal('fetch', f);
    expect(await putBaseline(baseline)).toEqual(baseline);
    expect(f.mock.calls[0]![1].method).toBe('PUT');
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual(baseline);
  });
  it('a 400 carries the field messages', async () => {
    vi.stubGlobal('fetch', reply(400, { error: { code: 'VALIDATION', message: 'x', fields: { noShows: ['too many'] } } }));
    await expect(putBaseline(baseline)).rejects.toMatchObject({ status: 400, fields: { noShows: 'too many' } });
  });
  it('asks for the requested weeks', async () => {
    const f = reply(403, { error: { code: 'FORBIDDEN', message: 'x' } });
    vi.stubGlobal('fetch', f);
    await expect(getReport(8)).rejects.toMatchObject({ status: 403 });
    expect(f.mock.calls[0]![0]).toBe('/api/pilot/report?weeks=8');
  });
});
