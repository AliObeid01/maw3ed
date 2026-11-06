import { isAreaKey, isCategoryKey, type BusinessArea, type BusinessCategory } from '@/lib/business/profile';
import { cutoffFromDisplay, cutoffToDisplay, parseWhole } from './duration';

export type CutoffUnit = 'hours' | 'min';

export type SettingsSource = {
  name: string;
  timezone: string;
  slotStepMin: number;
  bookingWindowDays: number;
  minNoticeMin: number;
  cancelCutoffMin: number;
  category?: string | null;
  area?: string | null;
  address?: string | null;
};

export type SettingsValues = {
  name: string;
  timezone: string;
  slotStepMin: number;
  window: string;
  notice: string;
  cutoff: string;
  /** Category key or legacy free text; '' when not set. */
  category: string;
  /** Area key; '' when not set. */
  area: string;
  address: string;
};

/**
 * Field values for the settings form. The cutoff `unit` is chosen ONCE when the form first loads and then
 * kept in state: re-deriving it from a freshly saved value would flip 120 min to "2 hours" while the field
 * still reads 120, and the next save would send 7200 minutes.
 */
export function toSettingsValues(business: SettingsSource, unit: CutoffUnit): SettingsValues {
  return {
    name: business.name,
    timezone: business.timezone,
    slotStepMin: business.slotStepMin,
    window: String(business.bookingWindowDays),
    notice: String(business.minNoticeMin),
    cutoff: String(cutoffToDisplay(business.cancelCutoffMin, unit)),
    category: business.category ?? '',
    area: business.area ?? '',
    address: business.address ?? '',
  };
}

/**
 * Category and area for the PATCH body. They are sent only when changed, so a legacy free-text category is never
 * written back; "Not set" (empty) sends null, which clears the field (the API accepts null and never unlists).
 */
export function profilePatch(
  values: { category: string; area: string },
  baseline: { category: string; area: string },
): { category?: BusinessCategory | null; area?: BusinessArea | null } {
  const patch: { category?: BusinessCategory | null; area?: BusinessArea | null } = {};
  if (values.category !== baseline.category) {
    if (values.category === '') patch.category = null;
    else if (isCategoryKey(values.category)) patch.category = values.category;
  }
  if (values.area !== baseline.area) {
    if (values.area === '') patch.area = null;
    else if (isAreaKey(values.area)) patch.area = values.area;
  }
  return patch;
}

/** Cutoff in minutes from the typed field and its unit; null when not a whole number. */
export function cutoffMinutes(value: string, unit: CutoffUnit): number | null {
  const n = parseWhole(value);
  return n === null ? null : cutoffFromDisplay(n, unit);
}
