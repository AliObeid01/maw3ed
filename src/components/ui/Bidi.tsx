import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bidi helpers. Times, prices, phones and Latin names inside Arabic text are reordered by the Unicode bidi
 * algorithm ("9:30 – 9:00", dangling dots). Isolating each run keeps it in its own order and stops it
 * from reshuffling its neighbours.
 */

const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';

/** Plain-string form for ICU message arguments: the run is always left-to-right ("9:00 – 9:30", "$15", "+961 …"). */
export const ltr = (text: string) => `${LRI}${text}${PDI}`;

/** Plain-string form for user text (service, staff and client names): direction follows its first strong letter. */
export const isolate = (text: string) => `${FSI}${text}${PDI}`;

/** "9:00 – 9:30" as one left-to-right unit. */
export const timeRangeText = (start: string, end: string) => ltr(`${start} – ${end}`);

/** Inline isolate. `dir="ltr"` for numbers, times and phones; `auto` (default) for names. */
export function Bidi({
  children,
  dir = 'auto',
  className,
}: {
  children: ReactNode;
  dir?: 'ltr' | 'auto';
  className?: string;
}) {
  return (
    <bdi dir={dir} className={cn(dir === 'ltr' && 'tabular-nums', className)}>
      {children}
    </bdi>
  );
}

/** "9:00 – 9:30", always read start to end, also in an Arabic line. */
export function TimeRange({ start, end, className }: { start: string; end?: string; className?: string }) {
  return (
    <Bidi dir="ltr" className={className}>
      {end ? `${start} – ${end}` : start}
    </Bidi>
  );
}

/**
 * A line of facts ("Tue 3 Nov · 9:00 – 9:30 · Haircut · Karim"). Each item is isolated and the separator is its
 * own inline item, so it never jumps to the wrong end of the line. Falsy items are dropped.
 */
export function MetaLine({
  items,
  separator = '·',
  className,
}: {
  items: Array<ReactNode | null | undefined | false>;
  separator?: string;
  className?: string;
}) {
  const shown = items.filter((i): i is ReactNode => i !== null && i !== undefined && i !== false && i !== '');
  return (
    <span className={className}>
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span aria-hidden="true" className="select-none">
              {` ${separator} `}
            </span>
          ) : null}
          {item}
        </Fragment>
      ))}
    </span>
  );
}
