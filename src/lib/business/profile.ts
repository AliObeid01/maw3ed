/**
 * Business profile lists: the single source of truth for what an owner may pick as category and area. The server
 * validates writes against these keys and the UI builds its pickers from them. Pure: no I/O.
 *
 * Legacy rows still hold the free-text category the owner once typed ("Hair salon"). Reads never change; only new
 * writes must use a key.
 */
export const CATEGORY_KEYS = [
  'barbers',
  'hair-salons',
  'dental-clinics',
  'beauty-clinics',
  'spa-massage',
  'physiotherapy',
  'other',
] as const;
export const AREA_KEYS = ['sidon', 'beirut', 'tripoli', 'jounieh', 'tyre', 'zahle', 'other'] as const;

export type BusinessCategory = (typeof CATEGORY_KEYS)[number];
export type BusinessArea = (typeof AREA_KEYS)[number];

export const ADDRESS_MAX = 120;

export const isCategoryKey = (value: unknown): value is BusinessCategory =>
  typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);
export const isAreaKey = (value: unknown): value is BusinessArea =>
  typeof value === 'string' && (AREA_KEYS as readonly string[]).includes(value);

/** Message key under `public.category` for a category key (`hair-salons` -> `hairsalons`, as categoryLabel derives it). */
export const categoryMessageKey = (key: BusinessCategory): string => key.replace(/-/g, '');

/** The stored free-text category when it is not one of the listed keys, else null. */
export function legacyCategory(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text && !isCategoryKey(text) ? text : null;
}

/** Profile fields a business still has to fill before it may be listed. Any non-empty category counts. */
export function profileMissing(profile: {
  category: string | null | undefined;
  area: string | null | undefined;
}): ('category' | 'area')[] {
  const out: ('category' | 'area')[] = [];
  if (!(profile.category ?? '').trim()) out.push('category');
  if (!isAreaKey(profile.area)) out.push('area');
  return out;
}
