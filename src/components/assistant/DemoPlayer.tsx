'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Plays the demo chat once, when it scrolls into view. The server HTML is the finished, fully visible conversation
 * (no hidden state, so it is complete without JavaScript). After mount, and only when motion is allowed and the
 * browser has IntersectionObserver, the block is "armed" (every step hidden) and switched to "play" the first time it
 * is visible; globals.css then fades each `data-demo-step` in with an 8 px rise, one after another (about 6 s in all,
 * once, no loop). With reduced motion nothing is armed, so everything stays static and visible. Only attributes
 * change, never an inline style.
 */
export function DemoPlayer({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    el.dataset.demo = 'armed';
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.demo = 'play';
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden="true" data-testid="demo-chat" className={className}>
      {children}
    </div>
  );
}
