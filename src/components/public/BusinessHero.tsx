import type { ReactNode } from 'react';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import { cn } from '@/lib/cn';

export type BusinessHeroProps = {
  name: string;
  /** e.g. "Hair salon · Hamra, Beirut · Open today 9:00 – 19:00" (already formatted in the business timezone). */
  meta: ReactNode;
  /** Pill facts, e.g. "Reminders 24 h and 2 h before". */
  facts?: string[];
  /** Versioned public logo url; null or absent shows the cyan monogram tile. */
  logoUrl?: string | null | undefined;
  /** An optional control in the same group as the facts (the "Book with Claude" button). */
  action?: ReactNode;
  className?: string;
};

/** Navy hero band with the cyan monogram tile (board 02, palette v2). */
export function BusinessHero({ name, meta, facts = [], logoUrl, action, className }: BusinessHeroProps) {
  return (
    // Named, so it is a region landmark and its content is not orphaned outside <main>.
    <section aria-label={name} className={cn('bg-hero text-white', className)}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-4 px-4 py-5 md:px-8 md:py-[26px]">
        <BusinessAvatar name={name} logoUrl={logoUrl} size="hero" tone="cyan" priority />
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
          <h1 className="text-[22px] leading-tight font-semibold md:text-[26px]">{name}</h1>
          <div className="text-[15px] text-hero-muted">{meta}</div>
        </div>
        {facts.length > 0 || action ? (
          // The pills and the control share ONE wrapping group, so the control never costs a row of its own.
          <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
            {facts.map((fact) => (
              <li key={fact} className="rounded-btn bg-white/10 px-3.5 py-2 text-sm text-hero-ink">
                {fact}
              </li>
            ))}
            {action ? <li className="max-lg:-my-1">{action}</li> : null}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
