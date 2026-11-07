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
  it('shows up to 4 service chips with price lines', () => {
    const services = Array.from({ length: 6 }, (_, i) => ({
      name: `S${i}`,
      durationMin: 30,
      price: i + 1,
    }));
    const m = cardModel({ ...base, services }, NOW, 'en');
    expect(m.services).toHaveLength(4);
    expect(m.services[0]).toEqual({ name: 'S0', price: '1 USD' });
  });
  it('no services key (older response) gives no chips', () => {
    const rest: DirectoryBusiness = { ...base };
    delete rest.services;
    expect(cardModel(rest, NOW, 'en').services).toEqual([]);
  });
  it('free times: HH:mm in the business zone, at most 4, day label today', () => {
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
    expect(m.times.map((x) => x.text)).toEqual(['11:00', '11:30', '12:00', '12:30']);
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
  it('keeps the address, or null', () => {
    expect(cardModel(base, NOW, 'en').address).toBe('Hamra Street');
    expect(cardModel({ ...base, address: null }, NOW, 'en').address).toBeNull();
  });
});
