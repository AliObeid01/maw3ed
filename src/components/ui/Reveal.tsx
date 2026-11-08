'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { clampStep, initialRevealState, nextRevealState } from '@/lib/motion/reveal';

/**
 * Fade + 12 px rise, once, when a block below the fold scrolls into view (CSS in globals.css, `data-revealed`).
 *
 * No flash, no layout shift, no JS needed to read the page: the server HTML has no hidden state at all. After mount
 * the block is hidden only if it starts below the fold (so nothing the visitor can see ever flickers), and
 * IntersectionObserver reveals it. Reduced motion, a missing IntersectionObserver, and anything already on screen
 * stay visible and never animate. Only `opacity` and `transform` change. The stagger is the `data-step` attribute
 * (CSS custom property in globals.css), never an inline style.
 */
export function Reveal({
  as,
  step,
  className,
  children,
}: {
  as?: ElementType;
  /** Stagger position inside a group, 0 to 6 (60 ms each). */
  step?: number;
  className?: string;
  children: ReactNode;
}) {
  const Tag: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = initialRevealState({
      reducedMotion: media.matches,
      hasObserver: 'IntersectionObserver' in window,
      top: el.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    });
    if (start === 'visible') {
      el.dataset.revealed = 'true';
      return;
    }
    el.dataset.revealed = 'false';
    let io: IntersectionObserver | undefined;
    const show = (event: 'intersect' | 'reduced') => {
      if (nextRevealState('hidden', event) === 'revealed') el.dataset.revealed = 'true';
      io?.disconnect();
      media.removeEventListener('change', onMedia);
    };
    const onMedia = () => {
      if (media.matches) show('reduced');
    };
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) show('intersect');
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    media.addEventListener('change', onMedia);
    return () => {
      io?.disconnect();
      media.removeEventListener('change', onMedia);
    };
  }, []);

  const n = clampStep(step);
  return (
    <Tag ref={ref} data-step={n > 0 ? n : undefined} className={className}>
      {children}
    </Tag>
  );
}
