import type { ChipTone } from '@/components/ui/Chip';
import type { ApptTone } from '@/lib/dashboard/agenda';

/** Calendar block tints per status (board 22): booked grey, confirmed brand-soft, attended green, no-show red, waitlist amber. */
export const blockTint: Record<ApptTone, string> = {
  booked: 'bg-divider text-ink',
  confirmed: 'bg-brand-soft text-brand-deep',
  attended: 'bg-success-soft text-success-deep',
  noShow: 'bg-danger-soft text-danger',
  lateCancel: 'bg-warning-soft text-warning-deep',
  cancelled: 'bg-divider text-muted line-through',
  waitlist: 'bg-amber-soft text-brand-deep',
  pendingPayment: 'bg-amber-soft text-amber',
};

export const chipTone: Record<ApptTone, ChipTone> = {
  booked: 'neutral',
  confirmed: 'brand',
  attended: 'success',
  noShow: 'danger',
  lateCancel: 'warning',
  cancelled: 'muted',
  waitlist: 'amber',
  pendingPayment: 'amber',
};

/** Keys under `ui.status`. */
export const toneLabelKey: Record<ApptTone, string> = {
  booked: 'booked',
  confirmed: 'confirmed',
  attended: 'attended',
  noShow: 'noShow',
  lateCancel: 'lateCancel',
  cancelled: 'cancelled',
  waitlist: 'waitlist',
  pendingPayment: 'pendingPayment',
};
