'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { activeSection, TOC_OFFSET_PX } from '@/lib/legalToc';

export type TocItem = { id: string; title: string };

const linkBase =
  'inline-flex min-h-11 items-center text-ink no-underline transition-colors duration-200 ease-out hover:text-brand hover:underline motion-reduce:transition-none aria-[current=location]:font-semibold aria-[current=location]:text-brand';

/** The id of the section being read: updated from an IntersectionObserver, with a static fallback (no highlight) without JS. */
function useActiveSection(ids: readonly string[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const headings = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const update = () =>
      setActive(activeSection(headings.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })), TOC_OFFSET_PX));
    update();
    const observer = new IntersectionObserver(update, {
      rootMargin: `-${TOC_OFFSET_PX}px 0px -55% 0px`,
      threshold: [0, 1],
    });
    for (const el of headings) observer.observe(el);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
    };
  }, [ids]);
  return [active, setActive];
}

function TocList({
  idPrefix,
  items,
  active,
  onPick,
  closeDetails,
}: {
  idPrefix: string;
  items: TocItem[];
  active: string | null;
  onPick: (id: string) => void;
  closeDetails?: boolean;
}) {
  return (
    <ol className="m-0 grid list-none gap-0.5 p-0 text-[15px]">
      {items.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            id={`${idPrefix}-${s.id}`}
            aria-current={active === s.id ? 'location' : undefined}
            onClick={(e) => {
              onPick(s.id);
              // On phones the disclosure closes after a choice, before the browser scrolls to the heading.
              if (closeDetails) e.currentTarget.closest('details')?.removeAttribute('open');
            }}
            className={linkBase}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The table of contents of a legal page. Phones: a collapsed `<details>` "On this page" above the content that closes
 * again after a choice. lg and up: the sticky sidebar, always open. Both lists are the same links; the one that is not
 * displayed is `display: none`, so assistive technology reads one.
 */
export function LegalToc({ title, items }: { title: string; items: TocItem[] }) {
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const [active, setActive] = useActiveSection(ids);

  return (
    <>
      <details data-testid="toc-mobile" className="group rounded-card-sm border border-divider bg-surface px-4 lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDown
            size={20}
            aria-hidden="true"
            className="shrink-0 text-brand transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <nav aria-label={title} className="pb-2">
          <TocList idPrefix="toc-m" items={items} active={active} onPick={setActive} closeDetails />
        </nav>
      </details>
      <nav aria-label={title} data-testid="toc-desktop" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <h2 className="m-0 mb-2 text-sm font-semibold text-muted">{title}</h2>
        <TocList idPrefix="toc-d" items={items} active={active} onPick={setActive} />
      </nav>
    </>
  );
}
