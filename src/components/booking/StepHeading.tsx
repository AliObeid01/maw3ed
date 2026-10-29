'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { IconButton } from '@/components/ui/IconButton';

/**
 * Step title. It takes focus when the step changes so screen readers announce the new step. On phones the back
 * button lives in the step rail's progress bar, so the inline one only shows from `lg`.
 */
export function StepHeading({
  title,
  onBack,
  headingRef,
}: {
  title: string;
  onBack?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const t = useTranslations('public.steps');
  return (
    <div className="flex items-center gap-3.5">
      {onBack ? (
        <IconButton label={t('back')} onClick={onBack} className="max-lg:hidden">
          <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
        </IconButton>
      ) : null}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-[22px] font-semibold outline-none md:text-2xl"
      >
        {title}
      </h2>
    </div>
  );
}
