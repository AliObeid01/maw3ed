'use client';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';

/**
 * A confirmation that says exactly what will happen. The confirm button is the danger action; Cancel is
 * equally easy to reach (both are full-width, 50 px, stacked on a phone).
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  pending = false,
  confirmVariant = 'danger',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  pending?: boolean;
  /** Danger (default) for a destructive action; primary for one that only changes a record. */
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeLabel={closeLabel}
    >
      <div className="flex flex-col gap-2.5 pt-2">
        <Button variant={confirmVariant} size="lg" block loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="lg" block onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
      </div>
    </Sheet>
  );
}
