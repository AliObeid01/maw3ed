import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSendError } from '@/server/providers/email/EmailProvider';
import { ResendEmailProvider } from '@/server/providers/email/ResendEmailProvider';
import { getEmailProvider, setEmailProviderOverride } from '@/server/providers/email';

const KEY = 're_SECRET_test_key_123';
const message = {
  to: 'client@example.test',
  subject: 'Hello',
  text: 'plain',
  html: '<p>html</p>',
  idempotencyKey: 'job_abc123',
};

function provider(fetchImpl: typeof fetch) {
  return new ResendEmailProvider({
    apiKey: KEY,
    from: 'Maw3ed <reminders@example.test>',
    fetch: fetchImpl,
  });
}
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllEnvs();
  setEmailProviderOverride(undefined);
});

describe('ResendEmailProvider', () => {
  it('posts to the Resend API with the idempotency key header and returns the message id', async () => {
    const fetchMock = vi.fn(() => reply(200, { id: 'msg_1' }));
    const res = await provider(fetchMock as unknown as typeof fetch).send(message);
    expect(res).toEqual({ providerMessageId: 'msg_1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('job_abc123');
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Maw3ed <reminders@example.test>',
      to: ['client@example.test'],
      subject: 'Hello',
      text: 'plain',
      html: '<p>html</p>',
    });
  });

  it('sends attachments as base64 content', async () => {
    const fetchMock = vi.fn(() => reply(200, { id: 'msg_2' }));
    await provider(fetchMock as unknown as typeof fetch).send({
      ...message,
      attachments: [{ filename: 'a.ics', content: 'BEGIN:VCALENDAR\r\n', contentType: 'text/calendar' }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual([
      {
        filename: 'a.ics',
        content: Buffer.from('BEGIN:VCALENDAR\r\n').toString('base64'),
        content_type: 'text/calendar',
      },
    ]);
  });

  it.each([
    [400, true],
    [401, true],
    [403, true],
    [422, true],
    [429, false],
    [409, false],
    [408, false],
    [500, false],
    [503, false],
  ])('HTTP %i -> permanent=%s', async (status, permanent) => {
    const p = provider((() => reply(status, { message: 'provider text', name: 'x' })) as typeof fetch);
    const err = await p.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).permanent).toBe(permanent);
    expect((err as EmailSendError).code).toBe(`resend_http_${status}`);
  });

  it('a network failure is transient', async () => {
    const p = provider((() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch);
    const err = (await p.send(message).catch((e: unknown) => e)) as EmailSendError;
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.permanent).toBe(false);
    expect(err.code).toBe('resend_network');
  });

  it('a success response without an id is a transient error', async () => {
    const p = provider((() => reply(200, {})) as typeof fetch);
    const err = (await p.send(message).catch((e: unknown) => e)) as EmailSendError;
    expect(err.permanent).toBe(false);
    expect(err.code).toBe('resend_bad_response');
  });

  it('never leaks the API key, provider text or recipient in errors', async () => {
    const leaky = (() =>
      reply(401, { message: `Invalid key ${KEY} for client@example.test` })) as typeof fetch;
    const err = (await provider(leaky).send(message).catch((e: unknown) => e)) as EmailSendError;
    const dump = JSON.stringify({ m: err.message, c: err.code, s: String(err), st: err.stack });
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain('client@example.test');
    expect(dump).not.toContain('Invalid key');
    const network = (() => Promise.reject(new Error(`boom ${KEY}`))) as typeof fetch;
    const err2 = (await provider(network).send(message).catch((e: unknown) => e)) as EmailSendError;
    expect(JSON.stringify({ m: err2.message, s: String(err2), st: err2.stack })).not.toContain(KEY);
  });

  it('aborts a hung request (transient timeout)', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'TimeoutError')));
      })) as unknown as typeof fetch;
    const p = new ResendEmailProvider({ apiKey: KEY, from: 'a@b.test', fetch: hang, timeoutMs: 20 });
    const err = (await p.send(message).catch((e: unknown) => e)) as EmailSendError;
    expect(err.permanent).toBe(false);
    expect(err.code).toBe('resend_network');
  });
});

describe('getEmailProvider with EMAIL_PROVIDER=resend', () => {
  it('builds the Resend provider from env, in production too', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', KEY);
    vi.stubEnv('EMAIL_FROM', 'Maw3ed <reminders@example.test>');
    expect(getEmailProvider()).toBeInstanceOf(ResendEmailProvider);
  });
  it('is a configuration error without the key or sender, and never names the value', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', 'x@y.test');
    expect(() => getEmailProvider()).toThrow(/RESEND_API_KEY/);
    vi.stubEnv('RESEND_API_KEY', KEY);
    vi.stubEnv('EMAIL_FROM', '');
    expect(() => getEmailProvider()).toThrow(/EMAIL_FROM/);
    try {
      getEmailProvider();
    } catch (e) {
      expect(String(e)).not.toContain(KEY);
    }
  });
});
