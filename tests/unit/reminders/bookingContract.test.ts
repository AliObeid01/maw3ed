import { describe, expect, it } from 'vitest';
import { BookingBody, PublicBookingBody } from '@/server/contracts/booking';

const body = (client: Record<string, unknown>) => ({
  serviceId: 'ckx7k2n0a0000qzrmn831i7rn',
  staffId: 'anyone',
  startAt: '2026-11-04T07:00:00Z',
  client: { name: 'Rana', phone: '71123456', ...client },
});

describe('booking client field caps (they end up in mail and WhatsApp text)', () => {
  it('caps the name at 80 and the email at 254 characters', () => {
    expect(BookingBody.safeParse(body({ name: 'a'.repeat(80) })).success).toBe(true);
    expect(BookingBody.safeParse(body({ name: 'a'.repeat(81) })).success).toBe(false);
    const longEmail = `${'a'.repeat(250)}@example.test`;
    expect(BookingBody.safeParse(body({ email: longEmail })).success).toBe(false);
  });
});

describe('F68 public booking requires an email, the staff booking does not', () => {
  const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    (r.error?.issues ?? []).map((i) => i.path.join('.'));

  it('rejects a missing, blank or invalid email on the public body with a client.email issue', () => {
    for (const client of [{}, { email: '' }, { email: '   ' }, { email: 'not-an-email' }]) {
      const r = PublicBookingBody.safeParse(body(client));
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toContain('client.email');
    }
  });

  it('accepts a valid email (trimmed, lower-cased) and still rejects unknown fields', () => {
    const ok = PublicBookingBody.safeParse(body({ email: '  Rana@Example.TEST ' }));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.client.email).toBe('rana@example.test');
    expect(PublicBookingBody.safeParse(body({ email: 'a@b.test', notes: 'x' })).success).toBe(false);
  });

  it('the staff body keeps the email optional', () => {
    expect(BookingBody.safeParse(body({})).success).toBe(true);
    expect(BookingBody.safeParse(body({ email: 'bad' })).success).toBe(false);
  });
});
