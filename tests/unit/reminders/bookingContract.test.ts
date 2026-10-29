import { describe, expect, it } from 'vitest';
import { BookingBody } from '@/server/contracts/booking';

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
