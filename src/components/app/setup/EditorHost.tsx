'use client';

import type { ReactNode } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

/**
 * Edit form container: a side panel at `lg+` (always on screen, as on boards 3.5 and 3.6), a bottom sheet
 * below it. Only one is mounted at a time, so there is never a duplicate form in the DOM.
 */
export function EditorHost({
  desktop,
  open,
  onOpenChange,
  title,
  closeLabel,
  panelClassName,
  children,
}: {
  desktop: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  if (desktop) {
    return (
      <section
        aria-label={title}
        className={cn('flex flex-col gap-3.5 rounded-card bg-surface p-[22px]', panelClassName)}
      >
        <h2 className="m-0 text-xl font-semibold">{title}</h2>
        {children}
      </section>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={closeLabel}>
      {children}
    </Sheet>
  );
}
