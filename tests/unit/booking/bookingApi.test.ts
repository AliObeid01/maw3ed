import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, parseErrorBody } from '@/lib/api/auth';
import {
  createBooking,
  getPublicBusiness,
  getSlots,
  slotsFromConflict,
  type BookingBody,
} from '@/lib/api/booking';
import { classifyBookingError, validateDetails } from '@/lib/booking/errors';
import { loadSlotWindow, readWindowLength, rememberWindowLength } from '@/lib/booking/window';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const body: BookingBody = {
  serviceId: 's1',
  staffId: 'anyone',
  startAt: '2026-11-03T08:30:00Z',
  client: { name: 'Maya', phone: '+96171234567' },
};
const result = {
  appointment: {
    id: 'a1',
    startAt: body.startAt,
    endAt: '2026-11-03T09:00:00Z',
    status: 'BOOKED',
    service: { id: 's1', name: 'Haircut', durationMin: 30, price: 15 },
    staff: { id: 'p1', displayName: 'Lina' },
  },
  links: { manage: '/l/tok' },
  reminders: { h24: true, h2: true },
};

describe('public booking client', () => {
  it('sends the Idempotency-Key header and a JSON body, and parses the result', async () => {
    const fetchMock = mockFetch(201, result);
    await expect(createBooking('studio-nour', body, 'bk-1234abcd')).resolves.toMatchObject({
      links: { manage: '/l/tok' },
      reminders: { h24: true, h2: true },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/public/studio-nour/bookings');
    expect(init!.method).toBe('POST');
    expect(init!.headers).toMatchObject({
      'Idempotency-Key': 'bk-1234abcd',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init!.body as string)).toEqual(body);
  });

  it('puts "anyone" requests on the wire without a staffId', async () => {
    const fetchMock = mockFetch(200, { slots: [] });
    await getSlots('studio-nour', { serviceId: 's1', from: '2026-11-02', to: '2026-11-15' });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/public/studio-nour/slots?serviceId=s1&from=2026-11-02&to=2026-11-15',
    );
    await getSlots('studio-nour', { serviceId: 's1', staffId: 'p2', from: 'a', to: 'b' });
    expect(fetchMock.mock.calls[1]![0]).toContain('staffId=p2');
  });

  it('rejects a response that breaks the contract', async () => {
    mockFetch(200, { business: { name: 'x' } });
    await expect(getPublicBusiness('studio-nour')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('keeps error.data on a 409 so the fresh slots are available', async () => {
    const slots = [{ startAt: '2026-11-03T09:00:00Z', endAt: '2026-11-03T09:30:00Z' }];
    mockFetch(409, { error: { code: 'SLOT_TAKEN', message: 'x', fields: {}, data: { slots } } });
    const error = await createBooking('studio-nour', body, 'bk-1234abcd').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(slotsFromConflict(error)).toEqual(slots);
  });

  it('treats a missing or malformed payload as no slots', () => {
    expect(slotsFromConflict(parseErrorBody(409, { error: { code: 'SLOT_TAKEN' } }))).toEqual([]);
    expect(
      slotsFromConflict(parseErrorBody(409, { error: { code: 'SLOT_TAKEN', data: { slots: 3 } } })),
    ).toEqual([]);
    expect(slotsFromConflict(new Error('x'))).toEqual([]);
  });
});

describe('classifyBookingError', () => {
  const api = (status: number, code: string, fields: Record<string, string> = {}, data?: unknown) =>
    parseErrorBody(status, { error: { code, message: code, fields, data } });

  it('turns a 409 SLOT_TAKEN into the slot-taken state with the payload slots', () => {
    const slots = [{ startAt: '2026-11-03T09:00:00Z', endAt: '2026-11-03T09:30:00Z' }];
    expect(classifyBookingError(api(409, 'SLOT_TAKEN', {}, { slots }))).toEqual({
      kind: 'slotTaken',
      slots,
    });
  });

  it('maps 400 client.* fields to translated field errors, never the server text', () => {
    expect(
      classifyBookingError(api(400, 'VALIDATION_FAILED', { 'client.phone': 'Enter a valid phone' })),
    ).toEqual({ kind: 'failed', fields: { phone: 'phoneInvalid' }, banner: 'fixFields', newAttempt: false });
    expect(
      classifyBookingError(
        api(400, 'VALIDATION_FAILED', { 'client.name': 'x', 'client.email': 'y' }),
      ),
    ).toMatchObject({ fields: { name: 'nameRequired', email: 'emailInvalid' } });
  });

  it('treats a 400 about anything else as a spent attempt with a generic message', () => {
    expect(classifyBookingError(api(400, 'VALIDATION_FAILED', { 'idempotency-key': 'x' }))).toMatchObject({
      banner: 'generic',
      newAttempt: true,
    });
  });

  it('keeps the same attempt (same key) for network errors, 429 and 5xx', () => {
    expect(classifyBookingError(new ApiError(0, 'NETWORK', 'x'))).toMatchObject({
      banner: 'network',
      newAttempt: false,
    });
    expect(classifyBookingError(api(429, 'TOO_MANY_ATTEMPTS'))).toMatchObject({
      banner: 'tooMany',
      newAttempt: false,
    });
    expect(classifyBookingError(api(500, 'INTERNAL'))).toMatchObject({
      banner: 'generic',
      newAttempt: false,
    });
  });

  it('drops the key after 422 IDEMPOTENCY_KEY_REUSED and 404', () => {
    expect(classifyBookingError(api(422, 'IDEMPOTENCY_KEY_REUSED'))).toMatchObject({ newAttempt: true });
    expect(classifyBookingError(api(404, 'NOT_FOUND'))).toMatchObject({
      banner: 'notFound',
      newAttempt: true,
    });
  });
});

describe('name length', () => {
  const api = (fields: Record<string, string>) =>
    parseErrorBody(400, { error: { code: 'VALIDATION_FAILED', message: 'x', fields } });
  it('tells a too-long name from an empty one in a 400', () => {
    expect(
      classifyBookingError(api({ 'client.name': 'Too big: expected string to have <=80 characters' })),
    ).toMatchObject({ fields: { name: 'nameTooLong' } });
    expect(
      classifyBookingError(api({ 'client.name': 'Too small: expected string to have >=1 characters' })),
    ).toMatchObject({ fields: { name: 'nameRequired' } });
  });
  it('checks the length before sending', () => {
    const ok = { name: 'x'.repeat(80), dial: '+961', phone: '71 234 567', email: '' };
    expect(validateDetails(ok)).toEqual({});
    expect(validateDetails({ ...ok, name: 'x'.repeat(81) })).toEqual({ name: 'nameTooLong' });
  });
});

describe('validateDetails', () => {
  const ok = { name: 'Maya', dial: '+961', phone: '71 234 567', email: '' };
  it('accepts a complete form with no email', () => {
    expect(validateDetails(ok)).toEqual({});
  });
  it('flags a blank name, a short phone and a bad email', () => {
    expect(validateDetails({ ...ok, name: '  ', phone: '12', email: 'nope' })).toEqual({
      name: 'nameRequired',
      phone: 'phoneInvalid',
      email: 'emailInvalid',
    });
  });
});

describe('loadSlotWindow', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const slots = [{ startAt: '2026-11-03T08:30:00Z', endAt: '2026-11-03T09:00:00Z' }];

  it('asks once for 14 local days starting today in the business timezone and groups by local day', async () => {
    const fetchSlots = vi.fn<(slug: string, q: { from: string; to: string }) => Promise<typeof slots>>(async () => slots);
    const window = await loadSlotWindow(
      'studio-nour',
      { serviceId: 's1' },
      'Asia/Beirut',
      now,
      undefined,
      fetchSlots as never,
    );
    expect(fetchSlots).toHaveBeenCalledTimes(1);
    expect(fetchSlots.mock.calls[0]![1]).toEqual({ serviceId: 's1', from: '2026-11-01', to: '2026-11-14' });
    expect(window.coveredDays).toHaveLength(14);
    expect(Object.keys(window.byDay)).toEqual(['2026-11-03']);
  });

  it('retries with a shorter range when the booking window is shorter than 14 days', async () => {
    const outOfWindow = new ApiError(400, 'VALIDATION_FAILED', 'x', { to: 'Bookings open up to 5 days ahead.' });
    const fetchSlots = vi.fn(async (_slug: string, q: { to: string }) => {
      if (q.to > '2026-11-06') throw outOfWindow;
      return slots;
    });
    const window = await loadSlotWindow(
      'studio-nour',
      { serviceId: 's1' },
      'Asia/Beirut',
      now,
      undefined,
      fetchSlots as never,
    );
    expect(fetchSlots.mock.calls.map((c) => c[1].to)).toEqual(['2026-11-14', '2026-11-07', '2026-11-03']);
    expect(window.coveredDays).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('starts at the remembered window length instead of probing 14 again', async () => {
    const fetchSlots = vi.fn<(slug: string, q: { from: string; to: string }) => Promise<typeof slots>>(async () => slots);
    await loadSlotWindow('s', { serviceId: 's1' }, 'Asia/Beirut', now, undefined, fetchSlots as never, 3);
    expect(fetchSlots).toHaveBeenCalledTimes(1);
    expect(fetchSlots.mock.calls[0]![1]).toMatchObject({ from: '2026-11-01', to: '2026-11-03' });
  });

  it('asks for exactly the published booking window (F13): one request, no probe', async () => {
    const fetchSlots = vi.fn<(slug: string, q: { from: string; to: string }) => Promise<typeof slots>>(async () => slots);
    const w = await loadSlotWindow('s', { serviceId: 's1' }, 'Asia/Beirut', now, undefined, fetchSlots as never, 10);
    expect(fetchSlots).toHaveBeenCalledTimes(1);
    expect(fetchSlots.mock.calls[0]![1]).toMatchObject({ from: '2026-11-01', to: '2026-11-10' });
    expect(w.coveredDays).toHaveLength(10);
  });

  it('remembers a short window per business and ignores a full one', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readWindowLength('a', storage)).toBe(14);
    rememberWindowLength('a', 3, storage);
    expect(readWindowLength('a', storage)).toBe(3);
    expect(readWindowLength('b', storage)).toBe(14);
    rememberWindowLength('b', 14, storage);
    expect(store.size).toBe(1);
    store.set([...store.keys()][0]!, 'garbage');
    expect(readWindowLength('a', storage)).toBe(14);
  });

  it('does not retry other failures', async () => {
    const fetchSlots = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    await expect(
      loadSlotWindow('s', { serviceId: 's1' }, 'Asia/Beirut', now, undefined, fetchSlots as never),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchSlots).toHaveBeenCalledTimes(1);
  });
});
