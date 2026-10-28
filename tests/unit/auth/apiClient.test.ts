import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  acceptInvite,
  checkSlug,
  getInvite,
  login,
  parseErrorBody,
  signup,
} from '@/lib/api/auth';

const session = {
  user: { id: 'u1', name: 'Lina', email: 'lina@example.com' },
  business: { id: 'b1', slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' },
  role: 'OWNER',
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseErrorBody', () => {
  it('reads code, message and the first message per field', () => {
    const error = parseErrorBody(400, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Bad',
        fields: { a: 'one', b: ['two', 'three'] },
      },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Bad',
      fields: { a: 'one', b: 'two' },
    });
  });

  it('survives bodies that are not an error envelope', () => {
    expect(parseErrorBody(502, '<html>').code).toBe('HTTP_502');
    expect(parseErrorBody(500, undefined).code).toBe('HTTP_500');
    expect(parseErrorBody(500, { error: 'nope' }).code).toBe('HTTP_500');
  });
});

describe('requests', () => {
  it('posts JSON with same-origin credentials and returns the validated session', async () => {
    const fn = mockFetch(201, session);
    const body = {
      businessName: 'Studio Nour',
      slug: 'studio-nour',
      timezone: 'Asia/Beirut',
      ownerName: 'Lina',
      email: 'lina@example.com',
      password: 'correct horse',
    };
    await expect(signup(body)).resolves.toEqual(session);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/signup');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('throws the server error envelope for a non-2xx response', async () => {
    mockFetch(401, { error: { code: 'INVALID_CREDENTIALS', message: 'No' } });
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects a 2xx response that does not match the contract', async () => {
    mockFetch(200, { user: { id: 'u1' } });
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('maps a failed fetch to a NETWORK error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
  });

  it('url-encodes the slug and parses the availability reply', async () => {
    const fn = mockFetch(200, { available: false, reason: 'taken' });
    await expect(checkSlug('a b')).resolves.toEqual({ available: false, reason: 'taken' });
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('/api/auth/slug-check?slug=a%20b');
  });

  it('rejects an unknown availability reason', async () => {
    mockFetch(200, { available: false, reason: 'weird' });
    await expect(checkSlug('abc')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('gives a 404 for an unknown invite and encodes the token', async () => {
    const fn = mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    await expect(getInvite('a/b')).rejects.toMatchObject({ status: 404 });
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('/api/invites/a%2Fb');
  });

  it('posts the accept body to the token route', async () => {
    const fn = mockFetch(200, { ...session, role: 'STAFF' });
    await acceptInvite('tok', { name: 'Rana', password: 'correct horse' });
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('/api/invites/tok/accept');
  });
});
