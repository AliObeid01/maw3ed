export const DEFAULT_TIMEZONE = 'Asia/Beirut';

export const CURATED_TIMEZONES = [
  'Asia/Beirut',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Africa/Cairo',
  'Asia/Amman',
  'Europe/Istanbul',
  'Europe/Paris',
  'Europe/London',
  'America/New_York',
] as const;

/** `Intl.supportedValuesOf` is missing on older runtimes; fall back to the curated list. */
export function allTimezones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const list = intl.supportedValuesOf?.('timeZone');
    if (list && list.length > 0) return list;
  } catch {
    // older runtime
  }
  return [...CURATED_TIMEZONES];
}

/** Curated zones first, then every other zone alphabetically with no duplicates. */
export function timezoneGroups(all: readonly string[] = allTimezones()) {
  const curated = new Set<string>(CURATED_TIMEZONES);
  const rest = [...new Set(all)].filter((z) => !curated.has(z)).sort();
  return { common: [...CURATED_TIMEZONES] as string[], rest };
}

export function timezoneLabel(zone: string): string {
  return zone.replace(/_/g, ' ');
}
