import { DateTime } from 'luxon';
import { todayIn } from './agenda';

export interface HeaderDay {
  /** The viewed local date, `yyyy-MM-dd` in the business timezone. */
  day: string;
  /** Is the viewed day the real current day in the business timezone? Only then the header greets. */
  isToday: boolean;
  /**
   * An instant at noon of `day` in the business timezone, for formatting with `timeZone: <business zone>`. Built
   * with Luxon from the string, never `new Date('yyyy-MM-dd')` (that parses in UTC / the browser zone and can show
   * the neighbouring day). Noon is never inside a DST gap.
   */
  instant: Date;
}

/**
 * What the Today header shows. `viewed` is the day chosen in the agenda, or null while it follows the real today
 * (so a tab left open past midnight moves on by itself). Pure: `now` is injected.
 */
export function headerDayFor(viewed: string | null, timezone: string, now: Date): HeaderDay {
  const today = todayIn(timezone, now);
  const day = viewed ?? today;
  const instant = DateTime.fromISO(day, { zone: timezone }).set({ hour: 12 }).toJSDate();
  return { day, isToday: day === today, instant };
}
