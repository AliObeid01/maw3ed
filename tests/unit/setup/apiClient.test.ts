import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import {
  createService,
  deleteTimeOff,
  getBusiness,
  listServices,
  putStaffHours,
  updateBusiness,
} from '@/lib/api/setup';
import { errorKey, invalidFields } from '@/lib/setup/errors';

const business = {
  id: 'b1',
  slug: 'studio-nour',
  name: 'Studio Nour',
  timezone: 'Asia/Beirut',
  locale: 'en',
  slotStepMin: 15,
  bookingWindowDays: 30,
  minNoticeMin: 60,
  cancelCutoffMin: 1440,
  category: null,
  address: null,
  setup: { hasServices: true, hasBookableStaff: false, hasHours: false },
  extraIgnored: 1,
};

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('setup API client', () => {
  it('parses a valid business and ignores unknown keys', async () => {
    mockFetch(200, business);
    const result = await getBusiness();
    expect(result.setup.hasServices).toBe(true);
    expect('extraIgnored' in result).toBe(false);
  });

  it('rejects a response that does not match the contract with BAD_RESPONSE', async () => {
    mockFetch(200, { ...business, slotStepMin: 'fifteen' });
    await expect(getBusiness()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('sends JSON with the right method, header and same-origin credentials', async () => {
    const fn = mockFetch(200, business);
    await updateBusiness({ name: 'New' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/business');
    expect(init.method).toBe('PATCH');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"name":"New"}');
  });

  it('does not set Content-Type on bodiless requests and handles 204', async () => {
    const fn = mockFetch(204);
    await expect(deleteTimeOff('s 1', 't/1')).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/staff/s%201/time-off/t%2F1');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toBeUndefined();
  });

  it('unwraps list envelopes', async () => {
    mockFetch(200, {
      services: [
        {
          id: 's1',
          name: 'Haircut',
          durationMin: 30,
          bufferMin: 10,
          price: 15,
          active: true,
          sortOrder: 0,
        },
      ],
    });
    const services = await listServices();
    expect(services).toHaveLength(1);
    expect(services[0]!.price).toBe(15);
  });

  it('maps the error envelope, keeping field messages', async () => {
    mockFetch(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'raw',
        fields: { name: 'Required', price: ['Too low', 'x'] },
      },
    });
    const error = await createService({ name: '', durationMin: 30, bufferMin: 0, price: 1 }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.fields).toEqual({ name: 'Required', price: 'Too low' });
  });

  it('turns a network failure into NETWORK and an unknown body into HTTP_<status>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('boom'))),
    );
    await expect(getBusiness()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    mockFetch(502, '<html>');
    await expect(getBusiness()).rejects.toMatchObject({ code: 'HTTP_502', status: 502 });
  });

  it('surfaces fields.intervals on a hours 400', async () => {
    mockFetch(400, { error: { code: 'VALIDATION_ERROR', fields: { intervals: 'Overlap' } } });
    const error = await putStaffHours('s1', []).catch((e) => e);
    expect(invalidFields(error)).toEqual(['intervals']);
  });
});

describe('errorKey', () => {
  const e = (status: number, code: string) => new ApiError(status, code, code);
  it('maps statuses and codes to translation keys, never to server text', () => {
    expect(errorKey(e(0, 'NETWORK'))).toBe('network');
    expect(errorKey(e(401, 'UNAUTHENTICATED'))).toBe('unauthorized');
    expect(errorKey(e(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(errorKey(e(404, 'NOT_FOUND'))).toBe('notFound');
    expect(errorKey(e(409, 'HAS_FUTURE_APPOINTMENTS'))).toBe('hasFutureAppointments');
    expect(errorKey(e(400, 'VALIDATION_ERROR'))).toBe('validation');
    expect(errorKey(e(429, 'RATE_LIMITED'))).toBe('rateLimited');
    expect(errorKey(e(500, 'INTERNAL'))).toBe('server');
    expect(errorKey(e(200, 'BAD_RESPONSE'))).toBe('server');
    expect(errorKey(e(418, 'TEAPOT'))).toBe('generic');
    expect(errorKey(new Error('x'))).toBe('generic');
  });
});
