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

type Entry = { category: string; places: number };

/** The categories that have at least one place, in the design order ("other" is never listed). Empty ones are hidden on the home. */
export function listedCategories(list: readonly Entry[]): HomeCategory[] {
  return HOME_CATEGORIES.filter((key) => (list.find((c) => c.category === key)?.places ?? 0) > 0);
}

/**
 * The selected category. With data: the wanted one when it has places, else the first category with places.
 * Without data (loading or failed): a known wanted category, else the first.
 */
export function resolveSelected(list: readonly Entry[], wanted: string | null | undefined): HomeCategory {
  if (list.length === 0) return isHomeCategory(wanted) ? wanted : HOME_CATEGORIES[0];
  const listed = listedCategories(list);
  if (isHomeCategory(wanted) && listed.includes(wanted)) return wanted;
  return listed[0] ?? HOME_CATEGORIES[0];
}

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
