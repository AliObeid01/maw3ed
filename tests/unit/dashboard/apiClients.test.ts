import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { getSummary, getToday, searchClients, getWaitlistActivity } from '@/lib/api/dashboard';
import { alreadySentFrom, getWhatsappDue, markReminderSent } from '@/lib/api/reminders';

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('dashboard client', () => {
  it('parses the summary and ignores unknown fields', async () => {
    const f = reply(200, { whatsappDue: 4, outcomesToMark: 2, brandNew: true });
    vi.stubGlobal('fetch', f);
    expect(await getSummary()).toEqual({ whatsappDue: 4, outcomesToMark: 2 });
    expect(f.mock.calls[0]![0]).toBe('/api/dashboard/summary');
  });

  it('rejects a malformed summary as BAD_RESPONSE', async () => {
    vi.stubGlobal('fetch', reply(200, { whatsappDue: 'x' }));
    await expect(getSummary()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('asks for a date and tolerates extra appointment fields', async () => {
    const f = reply(200, {
      date: '2026-10-29',
      timezone: 'Asia/Beirut',
      stats: { appointments: 0, confirmed: 0, noReply: 0, refilledFromWaitlist: 0, extra: 1 },
      whatsappDue: 0,
      outcomesToMark: 0,
      staff: [],
      appointments: [],
    });
    vi.stubGlobal('fetch', f);
    const data = await getToday('2026-10-29');
    expect(data.date).toBe('2026-10-29');
    expect(f.mock.calls[0]![0]).toBe('/api/dashboard/today?date=2026-10-29');
  });

  it('surfaces the error envelope as ApiError', async () => {
    vi.stubGlobal('fetch', reply(401, { error: { code: 'UNAUTHORIZED', message: 'no' } }));
    await expect(getToday('2026-10-29')).rejects.toMatchObject({ status: 401 });
  });

  it('turns a network failure into NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(getWaitlistActivity()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('client search: 404 means no match, other errors surface', async () => {
    vi.stubGlobal('fetch', reply(404, { error: { code: 'NOT_FOUND' } }));
    expect(await searchClients('96170555218')).toEqual([]);
    vi.stubGlobal('fetch', reply(500, { error: { code: 'INTERNAL' } }));
    await expect(searchClients('96170555218')).rejects.toBeInstanceOf(ApiError);
  });

  it('client search accepts clients or items and defaults noShows', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, { clients: [{ id: 'c1', name: 'Maya', phone: '+96170555218' }] }),
    );
    expect(await searchClients('96170555218')).toEqual([
      { id: 'c1', name: 'Maya', phone: '+96170555218', noShows: 0, visits: undefined },
    ]);
    vi.stubGlobal('fetch', reply(200, { items: [{ id: 'c2', name: 'Omar', phone: '+9611', noShows: 3 }] }));
    expect((await searchClients('9611'))[0]!.noShows).toBe(3);
  });
});

describe('reminders client', () => {
  it('parses the due list', async () => {
    vi.stubGlobal('fetch', reply(200, { count: 0, items: [] }));
    expect(await getWhatsappDue()).toEqual({ count: 0, items: [] });
  });

  it('mark-sent POSTs to the item and 409 exposes who sent it', async () => {
    const f = reply(409, {
      error: {
        code: 'ALREADY_SENT',
        message: 'x',
        data: { sentBy: { id: 'u1', name: 'Rana' }, sentAt: '2026-10-29T07:14:00.000Z' },
      },
    });
    vi.stubGlobal('fetch', f);
    const error = await markReminderSent('r1').catch((e: unknown) => e);
    expect(f.mock.calls[0]![0]).toBe('/api/reminders/r1/mark-sent');
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect(alreadySentFrom(error)).toEqual({
      sentBy: { id: 'u1', name: 'Rana' },
      sentAt: '2026-10-29T07:14:00.000Z',
    });
  });

  it('alreadySentFrom ignores other errors and malformed data', () => {
    expect(alreadySentFrom(new Error('x'))).toBeNull();
    expect(alreadySentFrom(new ApiError(500, 'X', 'x', {}, { sentBy: { id: 1 } }))).toBeNull();
    expect(alreadySentFrom(new ApiError(409, 'ALREADY_SENT', 'x', {}, { nope: 1 }))).toBeNull();
  });
});
