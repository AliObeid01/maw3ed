/** Splits minutes into days, hours and minutes (for ICU message formatting). */
export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(total));
  return {
    days: Math.floor(safe / 1440),
    hours: Math.floor((safe % 1440) / 60),
    minutes: safe % 60,
  };
}

/** Option lists for the service form (the current value is always included, see `withCurrent`). */
export const DURATION_OPTIONS = [
  5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480, 600,
];
export const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

export function withCurrent(options: readonly number[], current: number | undefined): number[] {
  if (current === undefined || options.includes(current)) return [...options];
  return [...options, current].sort((a, b) => a - b);
}

/** Cancellation cutoff is edited in hours when it is a whole number of hours, otherwise in minutes. */
export function cutoffUnit(totalMin: number): 'hours' | 'min' {
  return totalMin % 60 === 0 ? 'hours' : 'min';
}

export function cutoffToDisplay(totalMin: number, unit: 'hours' | 'min'): number {
  return unit === 'hours' ? totalMin / 60 : totalMin;
}

export function cutoffFromDisplay(value: number, unit: 'hours' | 'min'): number {
  return unit === 'hours' ? value * 60 : value;
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Latin, and the Arabic decimal separator (٫) to a dot. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/** Parses a whole-number field; null for empty or non-numeric text. */
export function parseWhole(text: string): number | null {
  const trimmed = normaliseDigits(text).trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Parses a price typed with `.` or `,` as the decimal mark; null when invalid or negative. */
export function parsePrice(text: string): number | null {
  const normalised = normaliseDigits(text).trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalised)) return null;
  return Number(normalised);
}
