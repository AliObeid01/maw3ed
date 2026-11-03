import type { ReactNode } from 'react';
import { monogram } from './monogram';
import { cn } from '@/lib/cn';

export type BusinessHeroProps = {
  name: string;
  /** e.g. "Hair salon · Hamra, Beirut · Open today 9:00 – 19:00" (already formatted in the business timezone). */
  meta: ReactNode;
  /** Pill facts, e.g. "Reminders 24 h and 2 h before". */
  facts?: string[];
  className?: string;
};

/** Teal hero band with the gold monogram (board 02). */
export function BusinessHero({ name, meta, facts = [], className }: BusinessHeroProps) {
  return (
    // Named, so it is a region landmark and its content is not orphaned outside <main>.
    <section aria-label={name} className={cn('bg-hero text-white', className)}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-4 px-4 py-5 md:px-8 md:py-[26px]">
        <div
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-accent text-lg font-bold text-ink md:size-16 md:rounded-tile md:text-[22px]"
        >
          {monogram(name)}
        </div>
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
          <h1 className="text-[22px] leading-tight font-semibold md:text-[26px]">{name}</h1>
          <div className="text-[15px] text-hero-muted">{meta}</div>
        </div>
        {facts.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {facts.map((fact) => (
              <li key={fact} className="rounded-btn bg-white/10 px-3.5 py-2 text-sm text-hero-ink">
                {fact}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
