import { describe, expect, it } from 'vitest';
import { bookableStaffHours } from '@/server/services/directoryLive';

const h = (weekday: number) => ({ weekday, startLocal: '09:00', endLocal: '17:00' });

describe('bookableStaffHours (open status counts only staff who can be booked for a live service)', () => {
  const services = [{ id: 's1' }, { id: 's2' }];

  it('keeps the hours of staff offering at least one active service', () => {
    const staff = [
      { serviceIds: ['s1'], hours: [h(1)] },
      { serviceIds: ['s2', 'gone'], hours: [h(2)] },
    ];
    expect(bookableStaffHours(staff, services)).toEqual([h(1), h(2)]);
  });

  it('drops staff with no services, or only services that are not active', () => {
    const staff = [
      { serviceIds: [], hours: [h(1)] },
      { serviceIds: ['inactive'], hours: [h(2)] },
    ];
    expect(bookableStaffHours(staff, services)).toEqual([]);
  });

  it('is empty when the business has no active service at all', () => {
    expect(bookableStaffHours([{ serviceIds: ['s1'], hours: [h(1)] }], [])).toEqual([]);
  });
});
