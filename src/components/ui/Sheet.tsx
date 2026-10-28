'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  /** Hide the visible title (it stays available to screen readers). */
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Bottom sheet below `md`, centred dialog from `md`. Radix provides the focus trap, Esc,
 * scroll lock, aria-modal and focus return.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  hideTitle,
  children,
  className,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          aria-modal="true"
          className={cn(
            'animate-sheet-in fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-card bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.06)] outline-none',
            'md:inset-0 md:m-auto md:h-fit md:max-h-[85dvh] md:w-[calc(100%-48px)] md:max-w-md md:animate-dialog-in md:rounded-card',
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-pill bg-line md:hidden"
          />
          <div className="flex items-center gap-3 px-5 pt-3 pb-2 md:px-6 md:pt-5">
            <Dialog.Title className={cn('flex-1 text-lg font-semibold', hideTitle && 'sr-only')}>
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="-me-2 ms-auto inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-muted transition-colors duration-200 ease-out hover:bg-canvas"
            >
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description
            className={description ? 'px-5 pb-2 text-sm text-muted md:px-6' : 'sr-only'}
          >
            {description ?? title}
          </Dialog.Description>
          <div className="overflow-y-auto px-5 pt-1 pb-[max(20px,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
