'use client';

import { useEffect, useRef } from 'react';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { buildDirectoryUrl } from '@/lib/home/search';

/** At sm and up the chips wrap onto at most this many rows; the rest are hidden whole. */
export const CHIP_ROWS = 2;

/**
 * Hide (display: none, so also out of the tab order) every chip that would start a row after `maxRows`, never half
 * cutting one. Measured from the real layout: first show all, then hide those whose top is below the second row.
 * Runs again whenever the box changes size or the chips change. Below sm the row is a one-line scroller, where this
 * does nothing (nothing wraps).
 */
function useFitRows(maxRows: number, names: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const fit = () => {
      const chips = Array.from(box.querySelectorAll<HTMLElement>('[data-chip]'));
      for (const chip of chips) chip.removeAttribute('data-fit-hidden');
      if (getComputedStyle(box).flexWrap !== 'wrap') return;
      const tops: number[] = [];
      for (const chip of chips) {
        const top = Math.round(chip.offsetTop);
        if (!tops.includes(top)) tops.push(top);
        if (tops.length > maxRows) chip.setAttribute('data-fit-hidden', '');
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [maxRows, names]);
  return ref;
}

/**
 * The hero's "Popular" row. Phones: ONE line that scrolls sideways with the scrollbar hidden and a soft fade on the
 * scrolling side (the end, so the right in LTR and the left in RTL). sm and up: no scroller, the chips wrap onto at
 * most two rows of reserved height (nothing shifts when the live names arrive); a chip that does not fit is hidden whole.
 * Every chip is shortened with an ellipsis past 220 px and carries its full name in `title`.
 */
export function HeroChips({ label, names }: { label: string; names: readonly string[] }) {
  const ref = useFitRows(CHIP_ROWS, names);
  return (
    <div
      ref={ref}
      data-allow-overflow
      data-testid="hero-chips"
      className="mt-[18px] flex min-h-11 items-center gap-2 text-[15px] text-hero-muted max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:pe-6 max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] max-sm:[&::-webkit-scrollbar]:hidden max-sm:rtl:[mask-image:linear-gradient(to_left,#000_calc(100%-28px),transparent)] sm:-mx-1 sm:-my-1 sm:mt-3.5 sm:max-h-[104px] sm:min-h-[104px] sm:flex-wrap sm:content-start sm:overflow-hidden sm:p-1"
    >
      <span className="shrink-0">{label}</span>
      {names.map((name) => (
        <Link
          key={name.toLowerCase()}
          data-chip
          title={name}
          href={buildDirectoryUrl({ search: name })}
          className="inline-flex min-h-11 max-w-[220px] shrink-0 items-center rounded-pill border border-white/35 px-4 font-medium text-white no-underline transition-colors duration-200 ease-out hover:bg-white/15 aria-busy:opacity-70 data-fit-hidden:hidden motion-reduce:transition-none"
        >
          <span className="truncate">{name}</span>
        </Link>
      ))}
    </div>
  );
}
