import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { claimOffer, getOffer, joinWaitlist } from '@/lib/api/waitlist';
import { classifyJoinError, validateJoin } from '@/lib/waitlist/errors';
import {
  clockSaysEnded,
  classifyOfferError,
  createClaimRunner,
  isExpired,
  minutesLeft,
  offerScreen,
} from '@/lib/waitlist/offer';
import { defaultRange, followStart, validateRange } from '@/lib/waitlist/range';

const TZ = 'Asia/Beirut';

describe('range defaults and validation', () => {
  it('defaults to today..today+13 and clips to a shorter booking window', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(defaultRange(now, TZ)).toEqual({ from: '2026-10-29', to: '2026-11-11' });
    expect(defaultRange(now, TZ, 7)).toEqual({ from: '2026-10-29', to: '2026-11-04' });
    expect(defaultRange(now, TZ, 0)).toEqual({ from: '2026-10-29', to: '2026-10-29' });
  });

  it('uses the business day, not the UTC day (late evening UTC is already tomorrow in Beirut)', () => {
    expect(defaultRange(new Date('2026-10-29T22:30:00Z'), TZ).from).toBe('2026-10-30');
  });

  it('counts calendar days across the DST change in Beirut (25 Oct 2026)', () => {
    const now = new Date('2026-10-20T08:00:00Z');
    expect(defaultRange(now, TZ).to).toBe('2026-11-02');
    expect(validateRange({ from: '2026-10-20', to: '2026-11-19' }, now, TZ)).toEqual({});
    expect(validateRange({ from: '2026-10-20', to: '2026-11-20' }, now, TZ)).toEqual({ to: 'tooLong' });
  });

  it('flags past, inverted and missing dates', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(validateRange({ from: '2026-10-28', to: '2026-10-30' }, now, TZ)).toEqual({ from: 'fromPast' });
    expect(validateRange({ from: '2026-10-30', to: '2026-10-29' }, now, TZ)).toEqual({ to: 'toBeforeFrom' });
    expect(validateRange({ from: '', to: '2026-02-31' }, now, TZ)).toEqual({ from: 'fromRequired', to: 'toRequired' });
  });

  it('moves the end along when the start passes it', () => {
    expect(followStart({ from: '2026-10-29', to: '2026-10-31' }, '2026-11-03')).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
    });
    expect(followStart({ from: '2026-10-29', to: '2026-10-31' }, '2026-10-30').to).toBe('2026-10-31');
  });
});

describe('join validation and error mapping', () => {
  const base = {
    serviceId: 'svc',
    from: '2026-10-29',
    to: '2026-11-05',
    name: 'Maya',
    dial: '+961',
    phone: '71 234 567',
    email: 'maya@example.com',
  };
  const now = new Date('2026-10-29T10:00:00Z');

  it('requires the email (offers are sent by email)', () => {
    expect(validateJoin(base, now, TZ)).toEqual({});
    expect(validateJoin({ ...base, email: '  ' }, now, TZ)).toEqual({ email: 'emailRequired' });
    expect(validateJoin({ ...base, email: 'nope' }, now, TZ)).toEqual({ email: 'emailInvalid' });
    expect(validateJoin({ ...base, serviceId: '' }, now, TZ).service).toBe('serviceRequired');
  });

  it('maps 409 WAITLIST_LIMIT, 429, 404, network and field errors', () => {
    expect(classifyJoinError(new ApiError(409, 'WAITLIST_LIMIT', 'x'))).toEqual({ kind: 'limit' });
    expect(classifyJoinError(new ApiError(429, 'TOO_MANY', 'x'))).toMatchObject({ banner: 'tooMany' });
    expect(classifyJoinError(new ApiError(404, 'NOT_FOUND', 'x'))).toMatchObject({ banner: 'notFound' });
    expect(classifyJoinError(new ApiError(0, 'NETWORK', 'x'))).toMatchObject({ banner: 'network' });
    expect(classifyJoinError(new ApiError(500, 'INTERNAL', 'x'))).toMatchObject({ banner: 'generic' });
    expect(
      classifyJoinError(new ApiError(400, 'VALIDATION_FAILED', 'x', { 'client.email': 'Invalid email address' })),
    ).toEqual({ kind: 'failed', fields: { email: 'emailInvalid' }, banner: 'fixFields' });
    expect(
      classifyJoinError(
        new ApiError(400, 'VALIDATION_FAILED', 'x', { 'client.email': 'Too small: expected string to have >=1 characters' }),
      ),
    ).toMatchObject({ fields: { email: 'emailRequired' } });
    expect(
      classifyJoinError(new ApiError(400, 'VALIDATION_FAILED', 'x', { fromDate: 'x', unknown: 'y' })),
    ).toMatchObject({ banner: 'generic' });
  });
});

describe('offer countdown and screen', () => {
  const expiresAt = '2026-10-29T12:30:00.000Z';
  const at = Date.parse(expiresAt);
  const view = (
    status: 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'TAKEN' | 'UNAVAILABLE' | 'ALREADY_BOOKED' | 'HOLD_LAPSED',
    canClaim = true,
  ) => ({
    offer: { status, expiresAt } as never,
    canClaim,
  });

  it('rounds minutes up and treats exactly-at-expiry as over', () => {
    expect(minutesLeft(expiresAt, at - 28 * 60_000 - 1)).toBe(29);
    expect(minutesLeft(expiresAt, at - 1_000)).toBe(1);
    expect(isExpired(expiresAt, at - 1)).toBe(false);
    expect(isExpired(expiresAt, at)).toBe(true);
    expect(minutesLeft(expiresAt, at + 5_000)).toBe(0);
  });

  it('derives the screen from status, canClaim and the clock', () => {
    expect(offerScreen(view('OPEN'), at - 60_000)).toBe('open');
    // The clock alone never ends an offer the server says can be claimed.
    expect(offerScreen(view('OPEN'), at)).toBe('open');
    expect(offerScreen(view('OPEN'), at + 3_600_000)).toBe('open');
    expect(clockSaysEnded(expiresAt, at)).toBe(true);
    // Once the server says it cannot be claimed, the clock tells expired from unavailable.
    expect(offerScreen(view('OPEN', false), at)).toBe('expired');
    expect(offerScreen(view('OPEN', false), at - 60_000)).toBe('unavailable');
    expect(offerScreen(view('EXPIRED'), at - 60_000)).toBe('expired');
    expect(offerScreen(view('TAKEN'), at - 60_000)).toBe('taken');
    expect(offerScreen(view('CLAIMED', false), at + 60_000)).toBe('claimed');
    expect(offerScreen(view('UNAVAILABLE', false), at - 60_000)).toBe('unavailable');
    expect(offerScreen(view('ALREADY_BOOKED', false), at - 60_000)).toBe('alreadyBooked');
    expect(offerScreen(view('HOLD_LAPSED', false), at - 60_000)).toBe('holdLapsed');
  });

  it('maps claim failures', () => {
    expect(classifyOfferError(new ApiError(404, 'NOT_FOUND', ''))).toBe('invalid');
    expect(classifyOfferError(new ApiError(410, 'OFFER_EXPIRED', ''))).toBe('expired');
    expect(classifyOfferError(new ApiError(409, 'SLOT_TAKEN', ''))).toBe('taken');
    expect(classifyOfferError(new ApiError(409, 'CONFLICT', ''))).toBe('unavailable');
    expect(classifyOfferError(new ApiError(409, 'WAITLIST_INACTIVE', ''))).toBe('unavailable');
    expect(classifyOfferError(new ApiError(409, 'ALREADY_BOOKED', ''))).toBe('alreadyBooked');
    expect(classifyOfferError(new ApiError(409, 'HOLD_LAPSED', ''))).toBe('holdLapsed');
    expect(classifyOfferError(new ApiError(0, 'NETWORK', ''))).toBe('network');
    expect(classifyOfferError(new ApiError(429, 'X', ''))).toBe('tooMany');
  });
});

describe('claim runner', () => {
  it('sends one request for a double click and allows a retry after it settles', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const runner = createClaimRunner(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          release = resolve;
        }),
    );
    const a = runner.run();
    const b = runner.run();
    expect(a).toBe(b);
    expect(calls).toBe(1);
    release('ok');
    await a;
    expect(runner.isRunning()).toBe(false);
    void runner.run();
    expect(calls).toBe(2);
  });
});

describe('api client (mocked fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('posts the join body and parses the entry', async () => {
    const fetchMock = reply(201, {
      entry: { id: 'e1', status: 'OPEN', serviceId: 's', staffId: null, fromDate: '2026-10-29', toDate: '2026-11-05' },
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      serviceId: 's',
      staffId: null,
      fromDate: '2026-10-29',
      toDate: '2026-11-05',
      client: { name: 'M', phone: '+96171234567', email: 'm@x.co' },
    };
    const r = await joinWaitlist('studio-nour', body);
    expect(r.entry.id).toBe('e1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/public/studio-nour/waitlist');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('surfaces the error envelope with fields', async () => {
    vi.stubGlobal('fetch', reply(400, { error: { code: 'VALIDATION_FAILED', fields: { 'client.email': 'bad' } } }));
    await expect(
      joinWaitlist('s', { serviceId: 'a', staffId: null, fromDate: 'x', toDate: 'y', client: { name: 'a', phone: 'b', email: 'c' } }),
    ).rejects.toMatchObject({ status: 400, fields: { 'client.email': 'bad' } });
  });

  it('claims with an empty JSON object and maps 409/410', async () => {
    const fetchMock = reply(409, { error: { code: 'SLOT_TAKEN', data: { slots: [] } } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(claimOffer('tok.en')).rejects.toMatchObject({ status: 409, code: 'SLOT_TAKEN' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/offers/tok.en/claim');
    expect(fetchMock.mock.calls[0]![1].body).toBe('{}');
    vi.stubGlobal('fetch', reply(410, { error: { code: 'OFFER_EXPIRED' } }));
    await expect(getOffer('t')).rejects.toMatchObject({ status: 410, code: 'OFFER_EXPIRED' });
  });
});
