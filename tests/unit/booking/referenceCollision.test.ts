import { describe, expect, it } from 'vitest';
import { isReferenceCollision } from '@/server/repositories/appointment.repo';
import { violatedNames } from '@/server/http/errors';

// Error shapes as the Prisma driver adapter for pg raises them.
const adapter = (constraint: unknown, code = 'P2002') => ({
  code,
  meta: {
    modelName: 'Appointment',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint },
    },
  },
});

describe('violatedNames', () => {
  it('reads the adapter constraint as { index }, as { fields }, a plain string, and a target array', () => {
    expect(violatedNames(adapter({ index: 'Appointment_reference_key' }))).toContain(
      'Appointment_reference_key',
    );
    expect(violatedNames(adapter({ fields: ['reference'] }))).toContain('reference');
    expect(violatedNames({ code: '23505', constraint: 'Appointment_reference_key' })).toEqual([
      'Appointment_reference_key',
    ]);
    expect(violatedNames({ code: 'P2002', meta: { target: ['reference'] } })).toEqual([
      'reference',
    ]);
  });
  it('is safe on junk', () => {
    expect(violatedNames(null)).toEqual([]);
    expect(violatedNames('x')).toEqual([]);
  });
});

describe('isReferenceCollision', () => {
  it('matches only the reference index', () => {
    expect(isReferenceCollision(adapter({ index: 'Appointment_reference_key' }))).toBe(true);
    expect(isReferenceCollision(adapter({ fields: ['reference'] }))).toBe(true);
    expect(isReferenceCollision({ code: '23505', constraint: 'Appointment_reference_key' })).toBe(
      true,
    );
    expect(isReferenceCollision({ code: 'P2002', meta: { target: ['reference'] } })).toBe(true);
  });
  it('does NOT match the idempotency key, the slot constraint or other errors', () => {
    expect(isReferenceCollision(adapter({ fields: ['businessId', 'idempotencyKey'] }))).toBe(false);
    expect(
      isReferenceCollision(adapter({ index: 'Appointment_businessId_idempotencyKey_key' })),
    ).toBe(false);
    expect(
      isReferenceCollision({ code: 'P2002', meta: { target: ['businessId', 'idempotencyKey'] } }),
    ).toBe(false);
    expect(isReferenceCollision({ code: '23P01', constraint: 'appointment_no_overlap' })).toBe(
      false,
    );
    expect(isReferenceCollision(new Error('boom'))).toBe(false);
    expect(isReferenceCollision(null)).toBe(false);
  });
});
