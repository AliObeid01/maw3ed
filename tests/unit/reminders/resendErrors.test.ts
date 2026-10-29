import { describe, expect, it } from 'vitest';
import { EmailSendError, IDEMPOTENT_MISMATCH } from '@/server/providers/email';
import { ResendEmailProvider } from '@/server/providers/email/ResendEmailProvider';

const message = {
  to: 'client@example.test',
  subject: 'Hello',
  text: 'plain',
  html: '<p>html</p>',
  idempotencyKey: 'job_abc123',
};
const provider = (impl: () => Promise<Response>) =>
  new ResendEmailProvider({
    apiKey: 'k',
    from: 'a@b.test',
    fetch: impl as unknown as typeof fetch,
  });
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
const failure = async (p: ResendEmailProvider): Promise<EmailSendError> => {
  try {
    await p.send(message);
  } catch (e) {
    return e as EmailSendError;
  }
  throw new Error('expected the send to fail');
};

describe('ResendEmailProvider idempotency and rate limits', () => {
  it('409 invalid_idempotent_request means the key was already accepted', async () => {
    const err = await failure(provider(() => reply(409, { name: IDEMPOTENT_MISMATCH })));
    expect(err.code).toBe(IDEMPOTENT_MISMATCH);
    expect(err.permanent).toBe(true);
  });
  it('409 concurrent_idempotent_requests stays transient', async () => {
    const err = await failure(
      provider(() => reply(409, { name: 'concurrent_idempotent_requests' })),
    );
    expect(err.code).toBe('resend_http_409');
    expect(err.permanent).toBe(false);
  });
  it('429 is rate limited and carries Retry-After', async () => {
    const e1 = await failure(provider(() => reply(429, {}, { 'retry-after': '90' })));
    expect(e1.rateLimited).toBe(true);
    expect(e1.retryAfterMs).toBe(90_000);
    const e2 = await failure(provider(() => reply(429, {})));
    expect(e2.rateLimited).toBe(true);
    expect(e2.retryAfterMs).toBeUndefined();
  });
});
