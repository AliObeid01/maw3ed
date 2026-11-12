'use client';

import { useEffect, useRef } from 'react';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { buildDirectoryUrl } from '@/lib/home/search';

/** At sm and up the chips wrap onto at most this many rows; the rest are hidden whole. */
export const CHIP_ROWS = 2;

/**
 * Hide every chip that would start a row after `maxRows`, never half cutting one. Hidden chips get
 * `visibility: hidden` (not display: none): they stay in the layout, so hiding changes no size, the fit is idempotent
 * and the chips can be observed too, yet they are out of the tab order and the accessibility tree. Measured from the
 * real layout, so it runs again whenever the box OR any chip changes size (a web font arriving does not resize the box)
 * and when the fonts are ready. Below sm the row is a one-line scroller, where this does nothing (nothing wraps).
 */
function useFitRows(maxRows: number, names: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const chips = Array.from(box.querySelectorAll<HTMLElement>('[data-chip]'));
    const fit = () => {
      const wraps = getComputedStyle(box).flexWrap === 'wrap';
      // Rows are told apart by the vertical CENTER of every child, the label included: a label that fills a row on
      // its own is a row, and items centred in one row share a center whatever their height.
      const centers: number[] = [];
      const note = (el: HTMLElement) => {
        const center = Math.round(el.offsetTop + el.offsetHeight / 2);
        if (!centers.some((c) => Math.abs(c - center) < 4)) centers.push(center);
      };
      for (const child of Array.from(box.children) as HTMLElement[]) {
        note(child);
        if (!child.hasAttribute('data-chip')) continue;
        const hide = wraps && centers.length > maxRows;
        if (hide !== child.hasAttribute('data-fit-hidden')) child.toggleAttribute('data-fit-hidden', hide);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    for (const chip of chips) observer.observe(chip);
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [maxRows, names]);
  return ref;
}

/**
 * The hero's "Popular" row. Phones: ONE line that scrolls sideways with the scrollbar hidden and a soft fade on the
 * scrolling side (the end, so the right in LTR and the left in RTL). sm and up: no scroller, the chips wrap onto at
 * most two rows of reserved height (nothing shifts when the live names arrive); a chip that does not fit is hidden whole.
 * Every chip is shortened with an ellipsis past 220 px on phones (280 px from sm up) and carries its full name in `title`.
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
          className="inline-flex min-h-11 max-w-[220px] shrink-0 items-center rounded-pill sm:max-w-[280px] border border-white/35 px-4 font-medium text-white no-underline transition-colors duration-200 ease-out hover:bg-white/15 aria-busy:opacity-70 data-fit-hidden:invisible motion-reduce:transition-none"
        >
          <span dir="auto" className="truncate">{name}</span>
        </Link>
      ))}
    </div>
  );
}
