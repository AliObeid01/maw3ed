import { describe, expect, it } from 'vitest';
import { isCents, toCents } from '@/server/domain/money';
import { isValidTimezone } from '@/server/contracts/slug';
import { CreateServiceBody, UpdateBusinessBody } from '@/server/contracts/setup';
import type { SessionContext } from '@/server/http/withRoute';
import { businessService } from '@/server/services/businessService';
import { catalogService } from '@/server/services/catalogService';
import { hoursService } from '@/server/services/hoursService';
import { invitesService } from '@/server/services/invites';
import { staffService } from '@/server/services/staffService';
import { timeOffService } from '@/server/services/timeOffService';

// Role is checked first in every write, so no repository (database) is reached with a STAFF context.
const staffCtx = {
  businessId: 'b1',
  userId: 'u1',
  role: 'STAFF',
  sessionId: 's1',
  requestId: 'r1',
} as unknown as SessionContext;
const id = 'abcdefghijklmnopqrstuvwx';

describe('every setup write is OWNER only (service layer)', () => {
  const cases: [string, () => Promise<unknown>][] = [
    ['business.update', () => businessService.update(staffCtx, { name: 'x' })],
    [
      'catalog.create',
      () => catalogService.create(staffCtx, { name: 'x', durationMin: 30, bufferMin: 0, price: 1 }),
    ],
    ['catalog.update', () => catalogService.update(staffCtx, id, { active: false })],
    [
      'staff.create',
      () => staffService.create(staffCtx, { displayName: 'x', bookable: true, serviceIds: [] }),
    ],
    ['staff.update', () => staffService.update(staffCtx, id, { active: false })],
    ['staff.setServices', () => staffService.setServices(staffCtx, id, { serviceIds: [] })],
    ['hours.replace', () => hoursService.replace(staffCtx, id, { intervals: [] })],
    [
      'timeOff.create',
      () =>
        timeOffService.create(staffCtx, id, {
          startAt: '2030-01-01T00:00:00Z',
          endAt: '2030-01-02T00:00:00Z',
          reason: 'OTHER',
        }),
    ],
    ['timeOff.remove', () => timeOffService.remove(staffCtx, id, id)],
    ['invites.listPending', () => invitesService.listPending(staffCtx)],
  ];
  it.each(cases)('%s throws forbidden for STAFF', async (_name, fn) => {
    await expect(fn()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('price validation', () => {
  it('isCents', () => {
    for (const ok of [0, -0, 0.01, 1, 12.5, 19.99, 0.1 + 0.2, 100000])
      expect(isCents(ok), String(ok)).toBe(true);
    for (const bad of [1e-9, 0.001, 1.005, -1, NaN, Infinity, -Infinity, 0.009])
      expect(isCents(bad), String(bad)).toBe(false);
  });
  it('toCents rounds and turns -0 into 0', () => {
    expect(Object.is(toCents(-0), 0)).toBe(true);
    expect(toCents(0.1 + 0.2)).toBe(0.3);
  });
  it('schema accepts 0.1+0.2 and rejects 1e-9 and 1.005', () => {
    const base = { name: 'x', durationMin: 30 };
    expect(CreateServiceBody.safeParse({ ...base, price: 0.1 + 0.2 }).success).toBe(true);
    expect(CreateServiceBody.safeParse({ ...base, price: 1e-9 }).success).toBe(false);
    expect(CreateServiceBody.safeParse({ ...base, price: 1.005 }).success).toBe(false);
    expect(CreateServiceBody.safeParse({ ...base, price: Infinity }).success).toBe(false);
  });
});

describe('timezone canonicalisation', () => {
  it('accepts canonical names and UTC', () => {
    for (const tz of ['Asia/Beirut', 'Europe/Paris', 'America/New_York', 'UTC'])
      expect(isValidTimezone(tz), tz).toBe(true);
  });
  it('rejects case variants, offsets and junk', () => {
    for (const tz of [
      'asia/beirut',
      'ASIA/BEIRUT',
      '+03:00',
      'UTC+3',
      'Etc/GMT+3x',
      'EST5EDT ',
      'Mars/Phobos',
    ])
      expect(isValidTimezone(tz), tz).toBe(false);
    expect(UpdateBusinessBody.safeParse({ timezone: 'asia/beirut' }).success).toBe(false);
    expect(UpdateBusinessBody.safeParse({ timezone: '+03:00' }).success).toBe(false);
    expect(UpdateBusinessBody.safeParse({ timezone: 'Asia/Beirut' }).success).toBe(true);
  });
});
