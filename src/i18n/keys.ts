import type en from '../../messages/en.json';

/** The shape of messages/en.json: use it to type keys that are computed or come from a union. */
export type Messages = typeof en;
/** Keys under `ui.status`. */
export type StatusKey = keyof Messages['ui']['status'];
/** Keys under `public.category`. */
export type CategoryKey = keyof Messages['public']['category'];
