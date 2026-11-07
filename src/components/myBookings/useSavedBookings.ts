'use client';

import { useSyncExternalStore } from 'react';
import { EMPTY_BOOKINGS, myBookings, type Availability, type SavedBooking } from '@/lib/myBookings/storage';

const serverList = () => EMPTY_BOOKINGS;
const noopSubscribe = () => () => undefined;

/** The bookings saved on this device. Empty on the server and during hydration, so the markup always matches. */
export function useSavedBookings(): SavedBooking[] {
  return useSyncExternalStore(myBookings.subscribe, myBookings.getAll, serverList);
}

/** How many bookings are saved (0 on the server and during hydration). */
export function useSavedCount(): number {
  return useSyncExternalStore(myBookings.subscribe, myBookings.count, () => 0);
}

/** True once the page is in the browser (false on the server and during hydration). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Whether the browser lets us save at all ('ok' on the server so no warning is rendered into the HTML). */
export function useStorageAvailability(): Availability {
  return useSyncExternalStore(myBookings.subscribe, myBookings.availability, () => 'ok');
}
