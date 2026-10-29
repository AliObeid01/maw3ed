import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Phone-only save bar that stays above the tab bar. The end margin leaves room for the floating
 * "New booking" button so the two never overlap. Hidden from `md` (the header or card has the button).
 */
export function StickySaveBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] z-20 me-[72px] md:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}
