import { describe, expect, it } from 'vitest';
import { clearBooked, loadBooked, saveBooked, type BookedState } from '@/lib/booking/bookedStore';

const memory = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const state = (startAt: string): BookedState => ({
  name: 'Maya',
  hasEmail: true,
  result: {
    appointment: {
      id: 'a1',
      reference: 'K7M2QX',
      startAt,
      endAt: startAt,
      status: 'BOOKED',
      service: { id: 's', name: 'Cut', durationMin: 30, price: 10 },
      staff: { id: 'p', displayName: 'Nour' },
    },
    links: { manage: '/l/token.sig' },
    reminders: { h24: true, h2: true, email: true },
  },
});

const now = new Date('2026-11-01T10:00:00Z');

describe('bookedStore (F17)', () => {
  it('round-trips the confirmation per business', () => {
    const s = memory();
    saveBooked('nour', state('2026-11-03T09:00:00Z'), s);
    expect(loadBooked('nour', now, s)?.result.links.manage).toBe('/l/token.sig');
    expect(loadBooked('other', now, s)).toBeUndefined();
    clearBooked('nour', s);
    expect(loadBooked('nour', now, s)).toBeUndefined();
  });

  it('drops the entry once the appointment has started, and on malformed data', () => {
    const s = memory();
    saveBooked('nour', state('2026-11-01T09:00:00Z'), s);
    expect(loadBooked('nour', now, s)).toBeUndefined();
    expect(s.m.size).toBe(0);
    s.setItem('maw3ed:booked:nour', '{nope');
    expect(loadBooked('nour', now, s)).toBeUndefined();
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => saveBooked('nour', state('2026-11-03T09:00:00Z'), broken)).not.toThrow();
    expect(loadBooked('nour', now, broken)).toBeUndefined();
  });
});
