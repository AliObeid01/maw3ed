import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FakeEmailProvider,
  fakeEmailProvider,
  getEmailProvider,
  isFakeEmail,
} from '@/server/providers/email';

afterEach(() => vi.unstubAllEnvs());

describe('email provider selection fails closed in production', () => {
  it('production + unset -> configuration error', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', '');
    expect(() => getEmailProvider()).toThrow(/EMAIL_PROVIDER must be set/);
    expect(() => isFakeEmail()).toThrow();
  });

  it('production + fake -> configuration error', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'fake');
    expect(() => getEmailProvider()).toThrow(/EMAIL_PROVIDER must be set/);
    expect(() => isFakeEmail()).toThrow();
  });

  it('production + resend gets past the guard (and is then not-implemented)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    expect(() => getEmailProvider()).toThrow(/not implemented/);
  });

  it('development + unset -> the fake', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', '');
    expect(getEmailProvider()).toBe(fakeEmailProvider);
    expect(isFakeEmail()).toBe(true);
  });

  it('unknown names throw', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', 'sendgrid');
    expect(() => getEmailProvider()).toThrow(/Unknown/);
  });
});

describe('FakeEmailProvider', () => {
  const msg = (key: string) => ({
    to: 'a@b.test',
    subject: 's',
    text: 't',
    html: 'h',
    idempotencyKey: key,
  });

  it('keeps only the last 100 calls and resets', async () => {
    const fake = new FakeEmailProvider();
    for (let i = 0; i < 150; i++) await fake.send(msg(`k${i}`));
    expect(fake.calls).toHaveLength(100);
    expect(fake.calls[0]!.idempotencyKey).toBe('k50');
    expect(fake.delivered.size).toBeLessThanOrEqual(100);
    fake.reset();
    expect(fake.calls).toHaveLength(0);
    expect(fake.delivered.size).toBe(0);
  });

  it('does not redeliver the same idempotency key', async () => {
    const fake = new FakeEmailProvider();
    const a = await fake.send(msg('same'));
    const b = await fake.send(msg('same'));
    expect(b).toEqual(a);
    expect(fake.delivered.size).toBe(1);
  });
});
