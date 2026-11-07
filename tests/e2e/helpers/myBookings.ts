import type { Page } from '@playwright/test';
import { clockNow } from './clock';

/** localStorage key of the saved bookings (src/lib/myBookings/storage.ts). */
export const STORAGE_KEY = 'maw3ed:myBookings:v1';

export type Saved = {
  token: string;
  slug: string;
  businessName: string;
  serviceName: string;
  staffName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  reference: string | null;
  savedAt: string;
  ended?: 'cancelled' | 'closed';
};

/** Beirut wall time `days` from the virtual now. */
const beirutAt = (days: number, hour: number, minute: number) =>
  clockNow().setZone('Asia/Beirut').plus({ days }).set({ hour, minute, second: 0, millisecond: 0 });

/** A saved booking that starts `days` from now at hh:mm Beirut time. Fake values only. */
export function saved(over: Partial<Saved> = {}, days = 2, hour = 10, minute = 30): Saved {
  const start = beirutAt(days, hour, minute);
  return {
    token: 'tok-upcoming-1',
    slug: 'studio-nour',
    businessName: 'Studio Nour',
    serviceName: 'Haircut',
    staffName: 'Karim',
    startAt: start.toUTC().toISO()!,
    endAt: start.plus({ minutes: 30 }).toUTC().toISO()!,
    timezone: 'Asia/Beirut',
    reference: 'ABC234',
    savedAt: clockNow().minus({ hours: 1 }).toUTC().toISO()!,
    ...over,
  };
}

/** A previous visit (started `days` ago). */
export const savedPast = (over: Partial<Saved> = {}, days = 10) =>
  saved({ token: 'tok-past-1', reference: 'PST111', serviceName: 'Beard trim', ...over }, -days);

/** Put these entries into localStorage before the page scripts run (once per tab, so a later change is not undone by a reload). */
export async function seedBookings(page: Page, entries: Saved[]) {
  await seedRaw(page, JSON.stringify({ v: 1, entries }));
}

export async function seedRaw(page: Page, raw: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem(key!, value!);
    },
    [STORAGE_KEY, raw],
  );
}

/** localStorage that refuses every access, like a browser with storage blocked. */
export async function blockStorage(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
}

export const readStored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
