import { BellRing, Check, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Decorative, generic sample of the product for the home hero (desktop only, F54): a booking confirmation with a
 * reminder chip and a freed-slot offer. Made-up content, labelled "Example"; built from HTML, CSS and icons only
 * (no images, no script). The real copy of the page stays the accessible content, so this is hidden from
 * assistive tech and is not rendered below `lg`.
 */
export async function HeroPreview() {
  const t = await getTranslations('home');
  return (
    <div aria-hidden="true" className="relative hidden w-full max-w-[340px] justify-self-center lg:block" data-testid="hero-preview">
      <div className="flex flex-col gap-3 rounded-card border border-white/20 bg-white/10 p-3 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_4px_12px_rgb(0_0_0/0.08)]">
        <div className="flex flex-col gap-4 rounded-card bg-surface p-5 text-ink">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-chip bg-canvas px-2.5 py-1 text-xs font-semibold text-muted">{t('preview.label')}</span>
            <span className="flex size-8 items-center justify-center rounded-pill bg-success-soft text-success">
              <Check size={18} strokeWidth={3} />
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-lg font-semibold">{t('preview.confirmed')}</p>
            <p className="m-0 text-[15px] text-muted">{t('preview.service')}</p>
            <p className="m-0 text-[15px] font-medium">
              <bdi>{t('preview.when')}</bdi>
            </p>
          </div>
          <span className="inline-flex items-center gap-2 self-start rounded-chip bg-brand-soft px-3 py-1.5 text-[13px] font-semibold text-brand">
            <BellRing size={15} />
            {t('preview.reminder')}
          </span>
        </div>
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4 text-ink">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-brand">
            <Sparkles size={15} />
            {t('preview.freedTitle')}
          </div>
          <p className="m-0 text-[15px] text-muted">
            <bdi>{t('preview.freedBody')}</bdi>
          </p>
          <span className="flex h-11 items-center justify-center rounded-btn bg-electric text-[15px] font-semibold text-white">
            {t('preview.freedAction')}
          </span>
        </div>
      </div>
    </div>
  );
}
