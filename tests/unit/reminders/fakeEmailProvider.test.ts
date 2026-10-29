import { describe, expect, it } from 'vitest';
import { EmailSendError, FakeEmailProvider, IDEMPOTENT_MISMATCH } from '@/server/providers/email';

const msg = {
  to: 'a@example.test',
  subject: 's',
  text: 't',
  html: 'h',
  idempotencyKey: 'job1',
  attachments: [{ filename: 'a.ics', content: 'X', contentType: 'text/calendar' }],
};

describe('FakeEmailProvider strict idempotency (like Resend)', () => {
  it('dedupes an identical request', async () => {
    const f = new FakeEmailProvider();
    const a = await f.send(msg);
    expect(await f.send({ ...msg })).toBe(a);
    expect(f.delivered.size).toBe(1);
  });
  it('rejects the same key with a different payload (body or attachment)', async () => {
    const f = new FakeEmailProvider();
    await f.send(msg);
    const err = await f.send({ ...msg, text: 'changed' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).code).toBe(IDEMPOTENT_MISMATCH);
    const err2 = await f
      .send({ ...msg, attachments: [{ ...msg.attachments[0]!, content: 'Y' }] })
      .catch((e: unknown) => e);
    expect((err2 as EmailSendError).code).toBe(IDEMPOTENT_MISMATCH);
  });
  it('can be switched to lenient dedupe', async () => {
    const f = new FakeEmailProvider();
    f.strictIdempotency = false;
    await f.send(msg);
    await expect(f.send({ ...msg, text: 'changed' })).resolves.toBeTruthy();
  });
});
