import type { BusinessCategory } from '@/lib/business/profile';
import { formatFreeTime } from './freeTimes';

/** The six categories the home page shows ("other" is never listed). Order is the design's. */
export const HOME_CATEGORIES = [
  'barbers',
  'hair-salons',
  'dental-clinics',
  'beauty-clinics',
  'spa-massage',
  'physiotherapy',
] as const satisfies readonly BusinessCategory[];
export type HomeCategory = (typeof HOME_CATEGORIES)[number];

export const isHomeCategory = (value: unknown): value is HomeCategory =>
  typeof value === 'string' && (HOME_CATEGORIES as readonly string[]).includes(value);

/** The selected category: the wanted one when it is a home category, else the first. */
export function resolveSelected(
  _list: readonly { category: string }[],
  wanted: string | null | undefined,
): HomeCategory {
  return isHomeCategory(wanted) ? wanted : HOME_CATEGORIES[0];
}

/** A category with no places gets the honest empty state instead of a blank panel. */
export const panelState = (entry: { places: number }): 'empty' | 'full' => (entry.places > 0 ? 'full' : 'empty');

/**
 * The "Next free" tile: HH:mm in the business zone, or null (tile omitted). "Next free" only considers each
 * business's shortest service, so the page never claims "no availability".
 */
export function nextFreeTile(
  next: { startAt: string; business: { timezone: string } } | null | undefined,
): string | null {
  return next ? formatFreeTime(next.startAt, next.business.timezone) : null;
}

/** "8 USD" / "12.50 USD". The API returns prices without a currency field: USD is the product default. */
export function priceLine(price: number | null | undefined): string | null {
  if (price === null || price === undefined) return null;
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `${amount} USD`;
}
