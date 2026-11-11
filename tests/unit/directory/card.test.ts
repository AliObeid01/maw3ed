import { describe, expect, it } from 'vitest';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { cardModel } from '@/lib/directory/card';

const NOW = new Date('2026-11-07T08:00:00Z'); // 10:00 in Beirut

const base: DirectoryBusiness = {
  slug: 'nour',
  name: 'Studio Nour',
  category: 'hair-salons',
  area: 'beirut',
  address: 'Hamra Street',
  logoUrl: null,
  serviceCount: 6,
  fromPrice: 12.5,
  timezone: 'Asia/Beirut',
  nextFree: {
    startAt: '2026-11-07T09:00:00.000Z',
    service: { id: 's1', name: 'Haircut', durationMin: 30 },
  },
  freeTimes: ['2026-11-07T09:00:00.000Z', '2026-11-07T09:30:00.000Z'],
  services: [{ name: 'Haircut', durationMin: 30, price: 15 }],
};

describe('cardModel', () => {
  it('initials from Latin and Arabic names', () => {
    expect(cardModel(base, NOW, 'en').initials).toBe('SN');
    expect(cardModel({ ...base, name: 'صالون نور' }, NOW, 'ar').initials.length).toBeGreaterThan(0);
  });
  it('price line: X USD, a decimal only when needed; null without a price', () => {
    expect(cardModel(base, NOW, 'en').fromPrice).toBe('12.50 USD');
    expect(cardModel({ ...base, fromPrice: 8 }, NOW, 'en').fromPrice).toBe('8 USD');
    expect(cardModel({ ...base, fromPrice: null }, NOW, 'en').fromPrice).toBeNull();
  });
  it('shows up to 3 service rows with price lines and durations', () => {
    const services = Array.from({ length: 6 }, (_, i) => ({
      name: `S${i}`,
      durationMin: 30,
      price: i + 1,
    }));
    const m = cardModel({ ...base, services }, NOW, 'en');
    expect(m.services).toHaveLength(3);
    expect(m.services[0]).toEqual({ name: 'S0', price: '1 USD', durationMin: 30 });
  });
  it('moreCount: services the business has beyond the rows shown (+N more)', () => {
    const three = Array.from({ length: 3 }, (_, i) => ({ name: `S${i}`, durationMin: 30, price: 5 }));
    const four = [...three, { name: 'S3', durationMin: 30, price: 5 }];
    expect(cardModel({ ...base, services: four, serviceCount: 6 }, NOW, 'en').moreCount).toBe(3);
    expect(cardModel({ ...base, services: four, serviceCount: 4 }, NOW, 'en').moreCount).toBe(1);
    expect(cardModel({ ...base, services: three, serviceCount: 3 }, NOW, 'en').moreCount).toBe(0);
    expect(cardModel({ ...base, services: three, serviceCount: 2 }, NOW, 'en').moreCount).toBe(0);
  });
  it('moreCount is 0 when the response has no services key', () => {
    const rest: DirectoryBusiness = { ...base, serviceCount: 9 };
    delete rest.services;
    expect(cardModel(rest, NOW, 'en').moreCount).toBe(0);
  });
  it('no services key (older response) gives no chips', () => {
    const rest: DirectoryBusiness = { ...base };
    delete rest.services;
    expect(cardModel(rest, NOW, 'en').services).toEqual([]);
  });
  it('free times: HH:mm in the business zone, at most 3, day label today', () => {
    const m = cardModel(
      {
        ...base,
        freeTimes: [
          '2026-11-07T09:00:00.000Z',
          '2026-11-07T09:30:00.000Z',
          '2026-11-07T10:00:00.000Z',
          '2026-11-07T10:30:00.000Z',
          '2026-11-07T11:00:00.000Z',
        ],
      },
      NOW,
      'en',
    );
    expect(m.times.map((x) => x.text)).toEqual(['11:00', '11:30', '12:00']);
    expect(m.day).toEqual({ kind: 'today' });
    expect(m.freeService).toBe('Haircut');
  });
  it('day label tomorrow and a dated day; the business zone decides the day', () => {
    const tomorrow = cardModel({ ...base, freeTimes: ['2026-11-08T09:00:00.000Z'] }, NOW, 'en');
    expect(tomorrow.day).toEqual({ kind: 'tomorrow' });
    const dated = cardModel({ ...base, freeTimes: ['2026-11-10T09:00:00.000Z'] }, NOW, 'en');
    expect(dated.day).toEqual({ kind: 'date', text: 'Tue 10 Nov' });
    // 22:30Z is already 00:30 on the next day in Beirut
    const late = cardModel({ ...base, freeTimes: ['2026-11-07T22:30:00.000Z'] }, NOW, 'en');
    expect(late.day).toEqual({ kind: 'tomorrow' });
    expect(late.times[0]?.text).toBe('00:30');
  });
  it('no free times soon: no times, no day, flagged quietly', () => {
    const m = cardModel({ ...base, nextFree: null, freeTimes: [] }, NOW, 'en');
    expect(m.times).toEqual([]);
    expect(m.day).toBeNull();
    expect(m.noFree).toBe(true);
    const old: DirectoryBusiness = { ...base, nextFree: undefined, freeTimes: undefined };
    expect(cardModel(old, NOW, 'en').noFree).toBe(true);
  });
  it('passes the open status through, or null when the response has none', () => {
    expect(cardModel(base, NOW, 'en').open).toBeNull();
    expect(cardModel({ ...base, openStatus: { open: true, until: '19:00' } }, NOW, 'en').open).toEqual({ open: true, until: '19:00' });
  });
  it('keeps the address, or null', () => {
    expect(cardModel(base, NOW, 'en').address).toBe('Hamra Street');
    expect(cardModel({ ...base, address: null }, NOW, 'en').address).toBeNull();
  });
});
